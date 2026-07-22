// 若愚(刘禅·觉醒主公技):回合开始阶段,若你的体力是全场最少的(或之一),
// 你须增加1点体力上限并回复1点体力,然后永久获得技能"激将"。
//
// 分析(步骤1):
//   类型:主公技/觉醒技 | 时机:回合开始阶段(「回合开始」atom 的 after-hook)
//   触发条件:ownerId 是主公(ownerId===0) + 体力全场最少(或之一) + 未觉醒
//   流程(强制,无选择):
//     1. 增加1点体力上限(设上限 amount = maxHealth + 1)
//     2. 回复1点体力(此时上限已 +1,可回复)
//     3. 永久获得"激将"(添加技能 skillId='激将')
//   觉醒标记:player.vars['若愚/awakened']
//   主公判定: ownerId === 0(参考激将.ts 的 isLord 判断)
//
//   关键:增上限必须在回复前(先增加上限,再回复),否则回复被旧上限 clamp。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';

const AWAKENED_KEY = '若愚/awakened';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '若愚',
    description: '主公技/觉醒技:回合开始且体力全场最少时,增加1体力上限、回复1体力并永久获得"激将"',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    // 觉醒技:整局一次
    if (ctx.state.players[ownerId]?.vars[AWAKENED_KEY]) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 主公判定: ownerId === 0(参考激将.ts)
    if (ownerId !== 0) return;

    // 体力全场最少(或之一):与所有存活玩家比较
    const alivePlayers = ctx.state.players.filter((p) => p.alive);
    if (alivePlayers.length === 0) return;
    const minHealth = Math.min(...alivePlayers.map((p) => p.health));
    if (self.health > minHealth) return;

    // 标记已觉醒(在读条件后立即设,防重入)
    ctx.state.players[ownerId].vars[AWAKENED_KEY] = true;

    // 1. 增加1点体力上限
    await applyAtom(ctx.state, {
      type: '设上限',
      player: ownerId,
      amount: self.maxHealth + 1,
    });

    // 2. 回复1点体力(上限已 +1,可回复)
    await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });

    // 3. 永久获得"激将"
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '激将' });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 觉醒技,被动触发,无主动 action
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
