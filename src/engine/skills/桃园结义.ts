// 桃园结义(普通锦囊):出牌阶段,对所有存活角色使用,每名目标回复 1 点体力。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';
import { askWuxie } from '../wuxie';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '桃园结义', description: '锦囊:所有角色各回复1点体力' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = state.pendingSlots.size === 0
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      if (typeof params.cardId !== 'string') return 'cardId required';
      const cardInHand = !!self?.hand.includes(params.cardId);
      const cardNameOk = state.cardMap[params.cardId]?.name === '桃园结义';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardNameOk;
      return ok ? null : '桃园结义使用条件不满足';
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      pushFrame(state, '桃园结义', from, { ...params });
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 无懈可击对全体锦囊只抵消特定 1 名角色:逐目标询问无懈,被抵消的目标跳过回血。
      try {
        // 所有存活目标,按座次顺序逐个结算(含使用者自己)
        const targets = state.players.filter(p => p.alive).map(p => p.index);
        for (const t of targets) {
          if (!state.players[t]?.alive) continue;
          const cancelled = await askWuxie(state, t);
          if (cancelled) continue;
          // 未满血才回 1 点(跳过满血避免冗余 atom + 空 view event)
          const p = state.players[t];
          if (p && p.health < p.maxHealth) {
            await applyAtom(state, { type: '回复体力', target: t, amount: 1 });
          }
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

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '桃园结义',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '桃园结义',
      cardFilter: { filter: (c) => c.name === '桃园结义', min: 1, max: 1 },
    },
  });
}
