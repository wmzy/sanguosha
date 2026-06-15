// 诸葛连弩(武器,攻击范围 1):出牌阶段使用【杀】无次数限制。
//   出牌阶段开始时设 turn.vars['杀/quota'] = Infinity(杀.ts 的 validate 读此变量)。
import type { AtomBeforeContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '诸葛连弩', description: '武器:出牌阶段使用【杀】无次数限制' };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  // 出牌阶段开始时:若 owner 装备了诸葛连弩 → 加标签,供杀技能 validate 突破限杀
  registerBeforeHook(skill.id, ownerId, '阶段开始', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { player?: number; phase?: string };
    if (atom.player !== ownerId) return;
    if (atom.phase !== '出牌') return;
    const me = ctx.state.players[ownerId];
    if (!me) return;
    const weaponId = me.equipment?.['武器'];
    if (!weaponId) return;
    const card = ctx.state.cardMap[weaponId];
    if (card?.name !== '诸葛连弩') return;
    // 设出杀次数为无限(通用机制,见 添加技能.md §1.6.1)
    ctx.state.turn.vars['杀/quota'] = Infinity;
  });
  return () => {};
}

