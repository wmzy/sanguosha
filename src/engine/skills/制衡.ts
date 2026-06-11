// src/engine/skills/制衡.ts
// 制衡(孙权):出牌阶段限一次,可以弃一张手牌并摸两张牌
import type { BackendAPI, FrontendAPI, GameView, Json, EngineApi, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return {
    id,
    ownerId,
    name: '制衡',
    description: '出牌阶段限一次:弃一张手牌,摸两张牌',
  };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    },
    async (api: EngineApi) => {
      const from = api.self;
      const params = api.params;
      const frame = api.pushFrame('制衡', from, { ...params });
      const cardId = params.cardId as string;
      await api.apply({ type: '弃置', player: from, cardIds: [cardId] });
      await api.apply({ type: '摸牌', player: from, count: 2 });
    },
  );
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

export const module_制衡: SkillModule = { createSkill, onInit, onMount };
registerSkillModule('制衡', module_制衡);
