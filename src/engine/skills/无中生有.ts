// 无中生有(普通锦囊):出牌阶段对自己使用,摸两张牌。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, type SkillModule, validateUseCard } from '../skill';
import { askWuxie } from '../wuxie';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '无中生有', description: '锦囊:摸两张牌' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(state, skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '无中生有' });
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      await pushFrame(state, '无中生有', from, { ...params });
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
    label: '无中生有',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '无中生有',
      cardFilter: { filter: (c) => c.name === '无中生有', min: 1, max: 1 },
    },
  });
}
