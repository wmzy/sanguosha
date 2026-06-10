// src/engine/skills/酒.ts
// 酒:出牌阶段对自己使用,本回合下一张杀的伤害+1
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '酒', description: '出牌阶段对自己使用,本回合下一张杀的伤害+1' };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (apiSelf(view, params) === false) return '酒只能对自己使用';
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;
      await frame.apply({
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      await frame.apply({
        type: '加标记',
        player: from,
        mark: { id: '酒/nextKillDamageBonus', scope: -1, payload: 1, duration: 'turn' },
      });
      await frame.apply({
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    },
  );
  return () => {};
}

function apiSelf(view: GameView, params: Record<string, Json>): boolean {
  // 简化:酒只能自己用(target === ownerId)
  const ownerId = params.__ownerId as string | undefined;
  if (ownerId === undefined) return true;  // 由 spec 调用方传 ownerId
  const target = params.target as string | undefined;
  return target === ownerId;
}

export const module_酒: SkillModule = { createSkill, onInit };
registerSkillModule('酒', module_酒);
