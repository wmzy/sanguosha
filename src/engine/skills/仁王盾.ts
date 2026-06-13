// src/engine/skills/仁王盾.ts
// 仁王盾(防具):黑色杀无效
import type { AtomBeforeContext, Skill } from '../types';
import { dropAtom } from '../create-engine';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '仁王盾', description: '防具:黑色杀对你无效' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { target?: string; source?: string; cardId?: string };
    if (atom.target !== ownerId) return;
    // 检查杀的颜色
    if (!atom.cardId) return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!card) return;
    if (card.suit === '♠' || card.suit === '♣') {
      ;
      dropAtom(ctx.state); // 阻止伤害
    }
  });
  return () => {};
}

export default { createSkill, onInit };
