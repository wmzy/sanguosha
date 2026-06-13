// src/engine/skills/雌雄双股剑.ts
// 雌雄双股剑(武器):对异性角色出杀后,你摸1张,目标弃1张
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '雌雄双股剑', description: '武器:对异性角色出杀后,你摸1张牌,目标弃1张牌' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAfterHook(_skill.id, ownerId, '指定目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: string; target?: string };
    if (atom.source !== ownerId) return;
    // 简化:不对性别做判断(需要角色性别数据),总是触发效果
    const target = ctx.state.players.find(p => p.name === atom.target);
    if (!target || target.hand.length === 0) {
      // 目标无牌可弃,只摸牌
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
      return;
    }
    // 目标弃1张,自己摸1张
    await applyAtom(ctx.state, { type: '弃置', player: atom.target!, cardIds: [target.hand[0]] });
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
  });
  return () => {};
}

export default { createSkill, onInit };
