// src/engine/skills/顺手牵羊.ts
// 顺手牵羊(锦囊):获得目标一张牌
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '顺手牵羊', description: '锦囊:获得目标一张牌' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (_view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'string') return 'target required';
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;
      const target = params.target as string;
      // 移锦囊到处理区
      await api.apply({ type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 获得目标一张牌(简化:手牌第一张)
      const targetPlayer = frame._executor?.state.players.find(p => p.name === target);
      if (targetPlayer && targetPlayer.hand.length > 0) {
        await api.apply({ type: '获得', player: from, cardId: targetPlayer.hand[0], from: target });
      }
      // 移锦囊到弃牌堆
      await api.apply({ type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
    },
  );
  return () => {};
}

export const module_顺手牵羊: SkillModule = { createSkill, onInit };
registerSkillModule('顺手牵羊', module_顺手牵羊);
