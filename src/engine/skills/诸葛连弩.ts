// src/engine/skills/诸葛连弩.ts
// 诸葛连弩(武器):出杀无次数限制
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '诸葛连弩', description: '武器:出杀无次数限制' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  // 出牌阶段开始时:添加"诸葛连弩=无限出杀"标记
  registerAfterHook(_skill.id, ownerId, '设阶段', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { phase?: string };
    if (atom.phase !== '出牌') return;
    const me = ctx.state.players.find(p => p.name === ownerId);
    if (!me) return;
    // 检查是否装备了诸葛连弩
    const weaponId = me.equipment?.['武器'];
    if (!weaponId) return;
    const card = ctx.state.cardMap[weaponId];
    if (card?.name !== '诸葛连弩') return;
    await applyAtom(ctx.state, {
      type: '加标记',
      player: ownerId,
      mark: { id: '诸葛连弩/无限出杀', scope: -1, payload: 1, duration: 'turn' },
    });
  });
  return () => {};
}

export default { createSkill, onInit };
