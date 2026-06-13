// src/engine/skills/制衡.ts
// 制衡(孙权):出牌阶段限一次,可以弃一张手牌并摸两张牌
import type { GameState, FrontendAPI, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '制衡',
    description: '出牌阶段限一次:弃一张手牌,摸两张牌',
  };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      const frame = pushFrame(state, '制衡', from, { ...params });
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '弃置', player: from, cardIds: [cardId] });
      await applyAtom(state, { type: '摸牌', player: from, count: 2 });
      popFrame(state);
    }, );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '制衡',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '制衡：选择要弃置的牌',
      cardFilter: { min: 1, max: 1 },
    },
  });
  return () => {};
}

export default { createSkill, onInit, onMount };
