// src/engine/skills/装备通用.ts
// 通用装备技能:所有装备牌的 use action — 装备到对应栏位
import type { BackendAPI, GameView, Json, EngineApi, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '装备', description: '装备到对应栏位' };
}

export function onInit(_skill: Skill, api: BackendAPI): () => void {
  api.registerAction(
    'use',
    (view: GameView, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    },
    async (api: EngineApi) => {
      const from = api.self;
      const params = api.params;
      api.pushFrame('装备通用', from, { ...params });
      const cardId = params.cardId as string;
      // 先卸下同栏位装备(如果有)
      const card = api.state.cardMap[cardId];
      if (card?.subtype) {
        const slot = card.subtype as '武器' | '防具' | '进攻马' | '防御马' | '宝物';
        const currentEquip = api.state.players.find(p => p.name === from)?.equipment?.[slot];
        if (currentEquip) {
          await api.apply({ type: '卸下', player: from, slot });
          await api.apply({ type: '移动牌', cardId: currentEquip, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
      }
      // 装备
      await api.apply({ type: '装备', player: from, cardId });
      api.popFrame();
    },
  );
  return () => {};
}

export const module_装备通用: SkillModule = { createSkill, onInit };
registerSkillModule('装备通用', module_装备通用);
