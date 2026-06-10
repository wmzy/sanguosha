// src/engine/skills/方天画戟.ts
// 方天画戟(武器):出牌阶段最后一张手牌为杀时可指定最多3个目标
import type { AtomBeforeContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '方天画戟', description: '武器:最后一张手牌为杀时可指定最多3个目标' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  // 在指定目标 before 钩子中标记多目标
  api.onAtomBefore('指定目标', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { source?: string };
    if (atom.source !== api.self) return;
    const self = ctx.state.players.find(p => p.name === api.self);
    if (!self || self.hand.length !== 1) return; // 不是最后一张
    const lastCard = ctx.state.cardMap[self.hand[0]];
    if (!lastCard || lastCard.name !== '杀') return; // 最后一张不是杀
    ctx.modifyParams({ __方天多目标: true });
  });
  return () => {};
}

export const module_方天画戟: SkillModule = { createSkill, onInit };
registerSkillModule('方天画戟', module_方天画戟);
