// src/engine/skills/白银狮子.ts
// 白银狮子(防具):每次受到伤害最多1点;装备时回复1点体力
import type { AtomAfterContext, AtomBeforeContext, Skill } from '../types';
import { applyAtom, dropAtom } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '白银狮子', description: '防具:每次受伤最多1点' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  // 受到伤害时:如果 amount > 1,替换为 amount = 1
  // 实现:通过标记让造成伤害后判断(简化:用 before 钩子 drop 原始伤害并 apply 修正后的)
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { target?: string; amount?: number; source?: string; cardId?: string };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 1) return;
    // 检查是否装备了白银狮子
    const me = ctx.state.players.find(p => p.name === ownerId);
    const armorId = me?.equipment?.['防具'];
    if (!armorId) return;
    const card = ctx.state.cardMap[armorId];
    if (card?.name !== '白银狮子') return;
    // drop 原始伤害,apply 修正后的(最多1点)
    dropAtom(ctx.state);
    await applyAtom(ctx.state, { type: '造成伤害', target: atom.target!, amount: 1, source: atom.source ?? '', cardId: atom.cardId });
  });
  return () => {};
}

export default { createSkill, onInit };
