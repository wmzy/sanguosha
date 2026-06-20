// 桃(基本牌):
//   use:出牌阶段对已受伤角色使用,回复 1 体力。
//   respond:濒死求桃时出桃救援——设 state.localVars['求桃/已救'] = true,
//   runDyingFlow 检查此标志判断是否有人救援。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '桃', description: '出牌阶段对已受伤角色使用,回复 1 体力(濒死时可对濒死角色使用)' };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAction(skill.id, ownerId, 'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 手牌 + 牌名 + 目标合法
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardIdOk = typeof params.cardId === 'string';
      const cardInHand = cardIdOk && self?.hand.includes(params.cardId as string);
      const cardNameOk = cardIdOk && state.cardMap[params.cardId as string]?.name === '桃';
      const target = (params.target ?? (params.targets as number[] | undefined)?.[0]) as number | undefined;
      const targetExists = typeof target === 'number' && !!state.players[target];
      const targetAlive = targetExists && state.players[target as number]?.alive === true;
      const targetInjured = targetExists && state.players[target as number]!.health < state.players[target as number]!.maxHealth;
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && targetAlive && targetInjured;
      return ok ? null : '现在不能使用桃';
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
      // pending 必须是 请求回应 且 requestType='求桃'
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
      if (slot.atom.type !== '请求回应') return '当前不是求桃';
      const requestType = (slot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '桃/求桃') return '当前不是求桃';
      const cardId = params.cardId as string | undefined;
      if (cardId) {
        const self = state.players[ownerId];
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        const card = state.cardMap[cardId];
        if (card.name !== '桃') return '只能用桃救援';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return;
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: ownerId }, to: { zone: '弃牌堆' } });
      state.localVars['求桃/已救'] = true;
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '桃',
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '使用桃',
      cardFilter: { filter: (c) => c.name === '桃', min: 1, max: 1 },
      // 自疗:前端无需选目标,自动以自己为目标提交
      selfTarget: true,
      targetFilter: { min: 1, max: 1 },
    },
  });
  api.defineAction('respond', {
    label: '出桃',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '出桃救援',
      cardFilter: { filter: (c) => c.name === '桃', min: 1, max: 1 },
    },
  });
}

