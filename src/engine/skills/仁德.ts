// src/engine/skills/仁德.ts
// 仁德(刘备):出牌阶段,可以将任意数量手牌给其他角色;给出 ≥2 张后回复 1 体力
import type { GameState, FrontendAPI, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '仁德',
    description: '出牌阶段,可以将任意数量手牌给其他角色;给出 ≥2 张后回复 1 体力',
  };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const targets = params.targets as Array<{ target: string; cardIds: string[] }> | undefined;
      if (!Array.isArray(targets) || targets.length === 0) return 'targets required';
      const total = targets.reduce((n, t) => n + (Array.isArray(t.cardIds) ? t.cardIds.length : 0), 0);
      if (total === 0) return 'no cards to give';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const frame = pushFrame(state, '仁德', from, { ...params });
      const targets = params.targets as Array<{ target: string; cardIds: string[] }>;
      for (const t of targets) {
        for (const cardId of t.cardIds) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '手牌', player: t.target } });
        }
      }
      const total = targets.reduce((n, t) => n + t.cardIds.length, 0);
      if (total >= 2) {
        const healed = frame.params['仁德/healedThisTurn'] as boolean | undefined;
        if (!healed) {
          await applyAtom(state, { type: '回复体力', target: from, amount: 1 });
          frame.params['仁德/healedThisTurn'] = true;
        }
      }
      popFrame(state);
    }, );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '仁德',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '仁德：选择要送出的手牌和目标角色',
      cardFilter: { min: 1, max: 99 },
      targetFilter: { min: 1, max: 1 },
    },
  });
  return () => {};
}

export default { createSkill, onInit, onMount };
