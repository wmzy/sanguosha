// 无中生有(普通锦囊):出牌阶段对自己使用,摸两张牌。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';
import { askWuxie } from '../wuxie';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '无中生有', description: '锦囊:摸两张牌' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      if (typeof params.cardId !== 'string') return 'cardId required';
      const cardInHand = !!self?.hand.includes(params.cardId);
      const cardNameOk = state.cardMap[params.cardId]?.name === '无中生有';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk;
      return ok ? null : '无中生有使用条件不满足';
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      pushFrame(state, '无中生有', from, { ...params });
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 询问无懈可击(close-reopen:askWuxie 循环管理窗口)
      try {
        const cancelled = await askWuxie(state, from);
        if (!cancelled) {
          await applyAtom(state, { type: '摸牌', player: from, count: 2 });
        }
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
        if (state.zones.processing.includes(cardId)) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
        popFrame(state);
      }
    }, );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '无中生有',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '无中生有',
      cardFilter: { filter: (c) => c.name === '无中生有', min: 1, max: 1 },
    },
  });
}
