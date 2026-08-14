// 咆哮(张飞·锁定技):出牌阶段,你使用【杀】无次数限制。
//
// 实现机制(与诸葛连弩完全一致,出杀上限模型见 slash-quota.ts):
//   onInit 注册一个无限出杀提供者,返回 true → slashMax 返回 ∞ → 可无限出杀。
//   提供者随技能实例生命周期注册/卸载:武将技能开局即实例化(注册),整局常驻。
//
// 与诸葛连弩的区别:诸葛连弩是装备技能(装备/换装/弃装时实例化/销毁),
//   咆哮是武将锁定技(开局即生效,整局常驻)。机制本身完全相同。
import type { Skill, GameState } from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';
import { registerSlashUnlimitedProvider } from '../rules/slash-quota';
import { slashUnlimitedKey } from '../rules/vars-keys';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '咆哮', description: '锁定技:出牌阶段使用【杀】无次数限制', isLocked: true };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  // 后端权威:注册无限出杀提供者,返回 true → slashMax = ∞ → 可无限出杀。
  const unregMax = registerSlashUnlimitedProvider(state, ownerId, () => true);
  // view 同步:咆哮是锁定技整局常驻,在拥有者每个出牌阶段开始时把 '杀/unlimited/咆哮'
  // 投影到 view.turnUsage(回合结束自动清空)。前端/MCP 客户端的 viewSlashMax 据此推断
  // 无限出杀;缺失则首次出杀后(usedCount=1 ≥ max 1)viewCanSlash 误判为 false,
  // 【杀】从 availableActions 消失(与诸葛连弩经武器元数据、界父魂经同款同步的区别)。
  const unregHook = registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    await applyAtom(ctx.state, {
      type: '回合用量',
      player: ownerId,
      key: slashUnlimitedKey('咆哮'),
      value: true,
    });
  });
  return () => {
    unregMax();
    unregHook();
  };
}
