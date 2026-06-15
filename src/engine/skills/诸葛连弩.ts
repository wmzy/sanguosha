// src/engine/skills/诸葛连弩.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   诸葛连弩(武器,攻击范围 1,♠A):
//     - 出牌阶段,你可以使用任意数量的【杀】
//     - 移除了每回合只能使用 1 张【杀】的限制
//
// 关键原子操作:
//   before 钩子(阶段开始):
//     若 atom.player===ownerId ∧ atom.phase==='出牌' ∧ ownerId 装备的武器 name==='诸葛连弩'
//     → 加标签 '诸葛连弩/无限出杀'
//   消费:杀技能的 validate 检查此标签来突破每回合限杀
//
// 关键时机:
//   - 标签的添加时机:出牌阶段开始(每回合重置)
//   - 标签的清理:回合结束('清过期标记' 会清 duration='turn' 的标签)
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
    await applyAtom(ctx.state, {
      type: '加标签',
      player: ownerId,
      tag: '诸葛连弩/无限出杀',
    });
  });
  return () => {};
}

export default { createSkill, onInit };
