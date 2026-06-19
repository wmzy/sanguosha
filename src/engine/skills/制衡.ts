// 制衡(孙权):
//   出牌阶段限一次:弃任意数量的牌(手牌或装备),然后摸等量的牌。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '制衡',
    description: '出牌阶段限一次:弃任意张牌(手牌/装备),摸等量的牌',
  };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      // 兼容 cardIds 数组和单数 cardId(前端 handlePlayCard 发 cardId)
      const cardIds = (params.cardIds as string[] | undefined)
        ?? (typeof params.cardId === 'string' ? [params.cardId as string] : undefined);
      if (!Array.isArray(cardIds) || cardIds.length === 0) return 'cardIds required (at least 1)';;
      if (state.players[ownerId]?.vars['制衡/usedThisTurn']) return '本回合已使用过制衡';
      const self = state.players[ownerId];
      if (!self) return 'player not found';
      // 检查所有 cardId 在手牌或装备区中
      for (const cardId of cardIds) {
        const inHand = self.hand.includes(cardId);
        const inEquip = Object.values(self.equipment).includes(cardId);
        if (!inHand && !inEquip) return '牌不在手牌或装备区中';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      pushFrame(state, '制衡', from, { ...params });
      const cardIds = params.cardIds as string[];
      // 弃置 N 张
      await applyAtom(state, { type: '弃置', player: from, cardIds });
      // 摸 N 张
      await applyAtom(state, { type: '摸牌', player: from, count: cardIds.length });
      state.players[from].vars['制衡/usedThisTurn'] = true;
      popFrame(state);
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): () => void {
  api.defineAction('use', {
    label: '制衡',
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'select',
      title: '制衡：选择要弃置的牌（可多选）',
      source: 'handAndEquip',
      minTotal: 1,
      maxTotal: 99,
    },
  });
  return () => {};
}

