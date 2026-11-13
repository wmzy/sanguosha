// 界咆哮(界张飞·锁定技):出牌阶段,你使用【杀】无次数限制;你使用的【杀】被【闪】抵消时,摸一张牌。
//
// 实现机制:
//   1. 无次数限制:registerAlwaysUnlimitedWithProjection 一体注册「无限出杀提供者 +
//      view 投影」(与诸葛连弩/咆哮完全一致,出杀上限模型见 slash-quota.ts):
//      提供者返回 true → slashMax = ∞;拥有者每个出牌阶段开始时把
//      '杀/unlimited/界咆哮' 投影到 view.turnUsage(回合结束自动清空),
//      前端/MCP 客户端 viewSlashMax 据此推断无限出杀。
//
//   2. 杀被闪抵消→摸牌:在"被抵消" atom after hook 注册,
//      检测自己使用的杀被闪抵消 → 摸一张牌。
//      挂载点与贯石斧/青龙偃月刀相同(被抵消 after),通过 ctx.frame.skillId==='杀'
//      + atom.source===ownerId 精准定位"自己主动使用的杀被闪抵消"。
import type { Skill, GameState } from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';
import { registerAlwaysUnlimitedWithProjection } from '../rules/slash-quota';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界咆哮',
    description: '锁定技:出牌阶段使用【杀】无次数限制;杀被【闪】抵消时摸一张牌',
    isLocked: true,
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // 无限出杀 + view 投影一体注册(投影键 '杀/unlimited/界咆哮')
  const unregUnlimited = registerAlwaysUnlimitedWithProjection(state, skill.id, ownerId);

  // 杀被闪抵消后摸一张牌(无次数限制,每次被闪都摸)。
  const unregHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '被抵消',
    async (ctx) => {
      // 只对杀生效:万箭齐发等锦囊被闪抵消不触发(贯石斧/青龙同款判断)
      if (ctx.frame.skillId !== '杀') return;
      const atom = ctx.atom;
      // 只在"自己使用的杀"被抵消时触发
      if (atom.source !== ownerId) return;
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    },
  );

  return () => {
    unregUnlimited();
    unregHook();
  };
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
