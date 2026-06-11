// src/engine/skills/无中生有.ts
// 无中生有(锦囊):摸两张牌
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '无中生有', description: '锦囊:摸两张牌' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (_view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;
      await api.apply({ type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      await api.apply({ type: '摸牌', player: from, count: 2 });
      await api.apply({ type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
    },
  );
  return () => {};
}

export const module_无中生有: SkillModule = { createSkill, onInit };
registerSkillModule('无中生有', module_无中生有);
