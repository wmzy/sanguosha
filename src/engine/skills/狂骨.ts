// 狂骨(魏延·锁定技):当你对距离1以内的一名角色造成1点伤害时,你回复1点体力。
//
// 实现(被动触发,反馈同构):
//   造成伤害 after hook(source===ownerId, amount>0):
//     若 effectiveDistance(owner, target) <= 1 → 回复体力 1(不超过上限)。
//
// 距离1以内:effectiveDistance 最小为 1(座位相邻或自己),<= 1 即满足。
// 装备 -1 马(进攻修正)通过 player.vars['距离/进攻修正'] 进一步缩短距离——自动支持。
// 锁定技:不询问,条件满足自动回复。
import type { AtomAfterContext, FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';
import { effectiveDistance } from '../distance';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '狂骨',
    description: '对距离1以内的角色造成伤害时,回复1点体力',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number; amount?: number };
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.target === undefined) return;
    const target = atom.target;
    if (!ctx.state.players[target]?.alive) return;

    // 距离1以内(含自己):effectiveDistance 最小为 1
    if (effectiveDistance(ctx.state, ownerId, target) > 1) return;

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 已满血不回复(避免无意义的回复事件)
    if (self.health >= self.maxHealth) return;

    await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): void {
  // 锁定技,无主动 action
  return;
}
