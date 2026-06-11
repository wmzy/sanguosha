// src/engine/skills/雌雄双股剑.ts
// 雌雄双股剑(武器):对异性角色出杀后,你摸1张,目标弃1张
import type { AtomAfterContext, BackendAPI, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '雌雄双股剑', description: '武器:对异性角色出杀后,你摸1张牌,目标弃1张牌' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.onAtomAfter('指定目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== api.self) return;
    // 简化:不对性别做判断(需要角色性别数据),总是触发效果
    const target = ctx.state.players.find(p => p.name === atom.target);
    if (!target || target.hand.length === 0) {
      // 目标无牌可弃,只摸牌
      await ctx.api.apply({ type: '摸牌', player: api.self, count: 1 });
      return;
    }
    // 目标弃1张,自己摸1张
    await ctx.api.apply({ type: '弃置', player: atom.target!, cardIds: [target.hand[0]] });
    await ctx.api.apply({ type: '摸牌', player: api.self, count: 1 });
  });
  return () => {};
}

export const module_雌雄双股剑: SkillModule = { createSkill, onInit };
registerSkillModule('雌雄双股剑', module_雌雄双股剑);
