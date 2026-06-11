// src/engine/skills/仁王盾.ts
// 仁王盾(防具):黑色杀无效
import type { AtomBeforeContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '仁王盾', description: '防具:黑色杀对你无效' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.onAtomBefore('造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { target?: string; source?: string; cardId?: string };
    if (atom.target !== api.self) return;
    // 检查杀的颜色
    if (!atom.cardId) return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!card) return;
    if (card.suit === '♠' || card.suit === '♣') {
      ;
      ctx.api.drop(); // 阻止伤害
    }
  });
  return () => {};
}

export const module_仁王盾: SkillModule = { createSkill, onInit };
registerSkillModule('仁王盾', module_仁王盾);
