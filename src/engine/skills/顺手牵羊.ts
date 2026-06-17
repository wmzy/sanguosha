// 顺手牵羊(普通锦囊):
//   出牌阶段,对距离 1 内的一名其他角色使用,获得其一张牌。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';
import { effectiveDistance } from '../distance';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '顺手牵羊', description: '锦囊:获得目标一张牌' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
    const myTurn = state.currentPlayerIndex === ownerId;
    const inActPhase = state.phase === '出牌';
    const free = state.pendingSlots.size === 0
    const self = state.players[ownerId];
    const selfAlive = self?.alive === true;
    if (typeof params.cardId !== 'string') return 'cardId required';
    if (typeof params.target !== 'number') return 'target required';
    const cardInHand = !!self?.hand.includes(params.cardId);
    const cardNameOk = state.cardMap[params.cardId]?.name === '顺手牵羊';
    const notSelf = params.target !== ownerId;
    // 距离检查:目标必须在距离 1 以内(委托 distance.ts,含 进攻马/防御马 修正)
    const inRange = effectiveDistance(state, ownerId, params.target as number) <= 1;
    const target = state.players[params.target];
    const targetAlive = target?.alive === true;
    const targetHasHand = !!target && target.hand.length > 0;
    const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk && notSelf && inRange && targetAlive && targetHasHand;
    return ok ? null : '顺手牵羊使用条件不满足';
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      pushFrame(state, '顺手牵羊', from, { ...params });
      const cardId = params.cardId as string;
      const target = params.target as number;
      // 移锦囊到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 询问无懈可击
      delete state.localVars['无懈/被抵消'];
      await applyAtom(state, { type: '请求回应', requestType: '无懈可击', target: -2, prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } }, timeout: 10 });
      if (!state.localVars['无懈/被抵消']) {
        // 获得目标一张牌(简化:手牌第一张)
        const targetPlayer = state.players[target];
        if (targetPlayer && targetPlayer.hand.length > 0) {
          await applyAtom(state, { type: '获得', player: from, cardId: targetPlayer.hand[0], from: target });
        }
      }
      // 移锦囊到弃牌堆
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '顺手牵羊',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '顺手牵羊',
      cardFilter: { filter: (c) => c.name === '顺手牵羊', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
  });
}

