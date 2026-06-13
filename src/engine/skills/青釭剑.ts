// src/engine/skills/青釭剑.ts
// 青釭剑(武器):杀造成伤害时无视目标防具
import type { AtomBeforeContext, Skill } from '../types';
import { registerAction, registerBeforeHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '青釭剑', description: '武器:杀无视目标防具' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerBeforeHook(_skill.id, ownerId, '造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== ownerId) return;
    ;
  });
  return () => {};
}

export default { createSkill, onInit };
