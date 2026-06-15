// 桃(基本牌):
//   use:出牌阶段对已受伤角色使用,回复 1 体力。
//   respond:濒死求桃时出桃救援——设 state.localVars['求桃/已救'] = true,
//   runDyingFlow 检查此标志判断是否有人救援。
import type { GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '桃', description: '出牌阶段对已受伤角色使用,回复 1 体力(濒死时可对濒死角色使用)' };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      const target = (params.target ?? (params.targets as number[] | undefined)?.[0]) as number | undefined;
      if (typeof target !== 'number') return 'target required';
      const player = state.players[target];
      if (!player) return 'target 不存在';
      if (player.health >= player.maxHealth) return '目标未受伤,无法使用桃';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = (params.target ?? (params.targets as number[] | undefined)?.[0]) as number;
      pushFrame(state, '桃', from, { ...params });
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      await applyAtom(state, { type: '回复体力', target, amount: 1, source: from });
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    },
  );

  // respond:濒死求桃时出桃救援
  registerAction(skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      if (state.pendingSlot?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (state.pendingSlot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '求桃') return '当前不是求桃';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const self = state.players[ownerId];
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      const card = state.cardMap[cardId];
      if (card.name !== '桃') return '只能用桃救援';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: ownerId }, to: { zone: '弃牌堆' } });
      state.localVars['求桃/已救'] = true;
    },
  );

  return () => {};
}

