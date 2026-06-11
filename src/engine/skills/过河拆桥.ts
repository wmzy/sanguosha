// src/engine/skills/过河拆桥.ts
// 过河拆桥(锦囊):弃置目标一张牌
import type { BackendAPI, GameView, Json, EngineApi, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '过河拆桥', description: '锦囊:弃置目标一张牌' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (_view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'string') return 'target required';
      return null;
    },
    async (api: EngineApi) => {
      const from = api.self;
      const params = api.params;
      api.pushFrame('过河拆桥', from, { ...params });
      const cardId = params.cardId as string;
      const target = params.target as string;
      // 移锦囊到处理区
      await api.apply({ type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 弃目标一张牌(简化:弃手牌第一张)
      const targetPlayer = api.state.players.find(p => p.name === target);
      if (targetPlayer && targetPlayer.hand.length > 0) {
        await api.apply({ type: '弃置', player: target, cardIds: [targetPlayer.hand[0]] });
      }
      // 移锦囊到弃牌堆
      await api.apply({ type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      api.popFrame();
    },
  );
  return () => {};
}

export const module_过河拆桥: SkillModule = { createSkill, onInit };
registerSkillModule('过河拆桥', module_过河拆桥);
