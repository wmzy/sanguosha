// src/engine/skills/青釭剑.ts
// 青釭剑(武器):杀造成伤害时无视目标防具
import type { AtomBeforeContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '青釭剑', description: '武器:杀无视目标防具' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.onAtomBefore('造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== api.self) return;
    ctx.modifyParams({ penetrateArmor: true });
  });
  return () => {};
}

export const module_青釭剑: SkillModule = { createSkill, onInit };
registerSkillModule('青釭剑', module_青釭剑);
