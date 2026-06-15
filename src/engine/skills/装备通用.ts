// 装备通用(系统级):所有装备牌共用的 use action。
//   把装备牌装到对应栏位(根据 card.subtype),旧装备卸下进弃牌堆。
//   若装备牌自带技能(以 card.name 作 skillId),动态挂载技能实例。
import type { GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';
import { skillLoaders } from './index';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '装备', description: '装备到对应栏位' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      const self = state.players[ownerId];
      if (!self?.hand.includes(params.cardId)) return '牌不在手牌中';
      const card = state.cardMap[params.cardId];
      if (!card?.subtype) return '不是装备牌';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const from = ownerId;
      pushFrame(state, '装备通用', from, { ...params });
      const cardId = params.cardId as string;
      // 先卸下同栏位装备(如果有):卸下→手牌,再 移动牌→弃牌堆
      const card = state.cardMap[cardId];
      if (card?.subtype) {
        const slot = card.subtype as '武器' | '防具' | '进攻马' | '防御马' | '宝物';
        const currentEquip = state.players[from]?.equipment?.[slot];
        if (currentEquip) {
          await applyAtom(state, { type: '卸下', player: from, slot });
          await applyAtom(state, {
            type: '移动牌',
            cardId: currentEquip,
            from: { zone: '手牌', player: from },
            to: { zone: '弃牌堆' },
          });
        }
      }
      // 装备
      await applyAtom(state, { type: '装备', player: from, cardId });
      // 若装备牌自带技能(以 card.name 作 skillId),动态挂载技能实例
      if (card?.name && skillLoaders[card.name]) {
        await applyAtom(state, { type: '添加技能', player: from, skillId: card.name });
      }
      popFrame(state);
    }, );
  return () => {};
}

