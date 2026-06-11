// src/engine/skills/桃园结义.ts
// 桃园结义(锦囊):所有角色各回复1点体力
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '桃园结义', description: '锦囊:所有角色各回复1点体力' };
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
      // 所有存活角色回复1点
      const players = frame._executor?.state.players.filter(p => p.alive) ?? [];
      for (const p of players) {
        await api.apply({ type: '回复体力', target: p.name, amount: 1 });
      }
      await api.apply({ type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
    },
  );
  return () => {};
}

export const module_桃园结义: SkillModule = { createSkill, onInit };
registerSkillModule('桃园结义', module_桃园结义);
