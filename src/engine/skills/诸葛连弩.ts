// src/engine/skills/诸葛连弩.ts
// 诸葛连弩(武器):出杀无次数限制
import type { AtomAfterContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '诸葛连弩', description: '武器:出杀无次数限制' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  // 出牌阶段开始时设杀次数上限为 Infinity
  api.onAtomAfter('设阶段', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { phase?: string };
    if (atom.phase !== '出牌') return;
    const self = ctx.state.players.find(p => p.name === api.self);
    if (self) self.vars.__杀次数上限 = Infinity;
  });
  // 回合结束时清除
  api.onAtomAfter('回合结束', async (ctx: AtomAfterContext) => {
    const self = ctx.state.players.find(p => p.name === api.self);
    if (self) delete self.vars.__杀次数上限;
  });
  return () => {};
}

export const module_诸葛连弩: SkillModule = { createSkill, onInit };
registerSkillModule('诸葛连弩', module_诸葛连弩);
