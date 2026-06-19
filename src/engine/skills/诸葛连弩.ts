// 诸葛连弩(武器,攻击范围 1):出牌阶段使用【杀】无次数限制。
//   出牌阶段开始时设 turn.vars['杀/quota'] = Infinity(杀.ts 的 validate 读此变量)。
//   中途装备时通过 after hook(装备) 补设 quota,防止换装后漏刷。
import type { AtomAfterContext, AtomBeforeContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook, registerBeforeHook, type SkillModule } from '../skill';

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

  // 中途装备诸葛连弩时:立即刷新杀次数为无限(修复换装不刷新 quota)
  registerAfterHook(skill.id, ownerId, '装备', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number };
    if (atom.player !== ownerId) return;
    const me = ctx.state.players[ownerId];
    if (!me) return;
    const weaponId = me.equipment?.['武器'];
    if (!weaponId) return;
    const card = ctx.state.cardMap[weaponId];
    if (card?.name !== '诸葛连弩') return;
    ctx.state.turn.vars['杀/quota'] = Infinity;
  });

  // 诸葛连弩实例被移除(换装/弃装)时:清除出杀次数配额,恢复默认 1。
  // 此 hook 在 系统规则 的 after 移除技能 hook 之前执行,此时本实例 hook 仍在全局表里。
  registerAfterHook(skill.id, ownerId, '移除技能', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number; skillId?: string };
    if (atom.player !== ownerId) return;
    if (atom.skillId !== '诸葛连弩') return;
    // 恢复默认出杀次数(1)。validate 读 quota 时 typeof === 'number' 时取 quota,否则取 1,
    // 这里直接重置为 1 让语义清晰(即便此后再经过 阶段开始 hook,也无诸葛连弩 → quota 仍是 1)。
    ctx.state.turn.vars['杀/quota'] = 1;
  });

  return () => {};
}

