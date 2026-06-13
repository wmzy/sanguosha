// src/engine/skills/装备通用.ts
// 通用装备技能:所有装备牌的 use action — 装备到对应栏位
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '装备', description: '装备到对应栏位' };
}

export function onInit(_skill: Skill, ownerId: string): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      pushFrame(state, '装备通用', from, { ...params });
      const cardId = params.cardId as string;
      // 先卸下同栏位装备(如果有)
      const card = state.cardMap[cardId];
      if (card?.subtype) {
        const slot = card.subtype as '武器' | '防具' | '进攻马' | '防御马' | '宝物';
        const currentEquip = state.players.find(p => p.name === from)?.equipment?.[slot];
        if (currentEquip) {
          await applyAtom(state, { type: '卸下', player: from, slot });
          await applyAtom(state, { type: '移动牌', cardId: currentEquip, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
      }
      // 装备
      await applyAtom(state, { type: '装备', player: from, cardId });
      popFrame(state);
    }, );
  return () => {};
}

export default { createSkill, onInit };
