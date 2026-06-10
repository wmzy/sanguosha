// src/engine/skills/藤甲.ts
// 藤甲(防具):普通杀伤害-1(最少0),火焰伤害+1
import type { AtomBeforeContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '藤甲', description: '防具:普通杀伤害-1,火焰伤害+1' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.onAtomBefore('造成伤害', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { target?: string; amount?: number; damageType?: string };
    if (atom.target !== api.self) return;
    const baseAmount = atom.amount ?? 1;
    if (atom.damageType === 'fire') {
      ctx.modifyParams({ amount: baseAmount + 1 });
    } else {
      ctx.modifyParams({ amount: Math.max(0, baseAmount - 1) });
    }
  });
  return () => {};
}

export const module_藤甲: SkillModule = { createSkill, onInit };
registerSkillModule('藤甲', module_藤甲);
