// 界若愚(界刘禅·觉醒主公技):主公技,觉醒技,准备阶段,若你是全场体力值最小的角色,
// 你增加1点体力上限,回复至3点体力,然后获得"激将""思蜀"。
//
// 与标版若愚区别:
//   1. 回复量:标版「回复1点体力」;界版「回复至3点体力」(若当前<3 则补到 3,已≥3 不变)。
//   2. 获得技能:标版仅获「激将」;界版获「激将」+「思蜀」。
//
// 分析:
//   类型:主公技/觉醒技 | 时机:回合开始阶段(「回合开始」atom 的 after-hook)
//   触发条件:ownerId 是主公(ownerId===0) + 体力全场最少(或之一) + 未觉醒
//   流程(强制,无选择):
//     1. 增加1点体力上限(设上限 amount = maxHealth + 1)
//     2. 回复至3点体力(amount = max(0, 3 - 当前体力),上限已 +1 通常≥3 可容纳)
//     3. 永久获得"激将"(添加技能 skillId='激将')
//     4. 永久获得"思蜀"(添加技能 skillId='思蜀')
//   觉醒标记:player.vars['界若愚/awakened'](独立键,与标版若愚键隔离)
//   主公判定: ownerId === 0(参考激将.ts 的 isLord 判断)
//
//   关键:增上限必须在回复前(先增加上限,再回复),否则回复被旧上限 clamp。
//   独立界版文件,注册键 '界若愚'(与标版若愚键隔离,不修改标版)。
import type { AtomAfterContext, FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook } from '../skill';

const AWAKENED_KEY = '界若愚/awakened';
const TARGET_HEALTH = 3;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界若愚',
    description:
      '主公技/觉醒技:回合开始且体力全场最少时,增加1体力上限、回复至3点体力并永久获得"激将""思蜀"',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number };
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

    // 2. 回复至3点体力(上限已 +1,可容纳)
    const healAmount = Math.max(0, TARGET_HEALTH - self.health);
    if (healAmount > 0) {
      await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: healAmount });
    }

    // 3. 永久获得"激将"
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '激将' });

    // 4. 永久获得"思蜀"(界刘禅新增)
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '思蜀' });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 觉醒技,被动触发,无主动 action
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
