// 界咆哮(界张飞·锁定技):出牌阶段,你使用【杀】无次数限制;你使用的【杀】被【闪】抵消时,摸一张牌。
//
// 实现机制:
//   1. 无次数限制:onInit 注册一个出杀上限提供者,返回 Infinity → slashMax 返回 ∞ → 可无限出杀。
//      提供者随技能实例生命周期注册/卸载:武将技能开局即实例化(注册),整局常驻。
//      (与诸葛连弩完全一致,出杀上限模型见 slash-quota.ts)
//
//   2. 杀被闪抵消→摸牌:在"被抵消" atom after hook 注册,
//      检测自己使用的杀被闪抵消 → 摸一张牌。
//      挂载点与贯石斧/青龙偃月刀相同(被抵消 after),通过 ctx.frame.skillId==='杀'
//      + atom.source===ownerId 精准定位"自己主动使用的杀被闪抵消"。
import type { AtomAfterContext, Skill, GameState } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';
import { registerSlashMaxProvider } from '../slash-quota';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界咆哮',
    description: '锁定技:出牌阶段使用【杀】无次数限制;杀被【闪】抵消时摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // 注册出杀上限提供者:返回 Infinity → slashMax = ∞ → 可无限出杀。
  const unregMax = registerSlashMaxProvider(state, ownerId, () => Infinity);

  // 杀被闪抵消后摸一张牌(无次数限制,每次被闪都摸)。
  const unregHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '被抵消',
    async (ctx: AtomAfterContext) => {
      // 只对杀生效:万箭齐发等锦囊被闪抵消不触发(贯石斧/青龙同款判断)
      if (ctx.frame.skillId !== '杀') return;
      const atom = ctx.atom as { source?: number; target?: number };
      // 只在"自己使用的杀"被抵消时触发
      if (atom.source !== ownerId) return;
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    },
  );

  return () => {
    unregMax();
    unregHook();
  };
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
