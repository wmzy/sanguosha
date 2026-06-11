// src/engine/skills/白银狮子.ts
// 白银狮子(防具):每次受到伤害最多1点;装备时回复1点体力
import type { AtomAfterContext, AtomBeforeContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '白银狮子', description: '防具:每次受伤最多1点' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  // 伤害上限1
  api.onAtomBefore('造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { target?: string; amount?: number };
    if (atom.target !== api.self) return;
    if ((atom.amount ?? 0) > 1) {
      ;
    }
  });
  // 受伤后回复1点(白银狮子特效)
  api.onAtomAfter('造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: string };
    if (atom.target !== api.self) return;
    await ctx.api.apply({ type: '回复体力', target: api.self, amount: 1 });
  });
  return () => {};
}

export const module_白银狮子: SkillModule = { createSkill, onInit };
registerSkillModule('白银狮子', module_白银狮子);
