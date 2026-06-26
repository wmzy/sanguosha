// 桃园结义(普通锦囊):出牌阶段,对所有存活角色使用,每名目标回复 1 点体力。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, type SkillModule, validateUseCard } from '../skill';
import { 询问无懈可击 } from '../无懈可击';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '桃园结义', description: '锦囊:所有角色各回复1点体力' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(state, skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '桃园结义' });
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      await pushFrame(state, '桃园结义', from, { ...params });
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 无懈可击对全体锦囊只抵消特定 1 名角色:逐目标询问无懈,被抵消的目标跳过回血。
      try {
        // 所有存活目标,按座次顺序逐个结算(含使用者自己)
        const targets = state.players.filter(p => p.alive).map(p => p.index);
        for (const t of targets) {
          const p = state.players[t];
          if (!p?.alive) continue;
          // 满血目标:桃园结义对其无效果(无可抵消的效果),不询问无懈可击也不回血。
          if (p.health >= p.maxHealth) continue;
          const cancelled = await 询问无懈可击(state, t);
          if (cancelled) continue;
          await applyAtom(state, { type: '回复体力', target: t, amount: 1 });
        }
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
        if (frameCards(state).includes(cardId)) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
        await popFrame(state);
      }
    }, );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
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
