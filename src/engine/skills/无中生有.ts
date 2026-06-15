// 无中生有(普通锦囊):出牌阶段对自己使用,摸两张牌。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '无中生有', description: '锦囊:摸两张牌' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {

      const from = ownerId;
      pushFrame(state, '无中生有', from, { ...params });
      const cardId = params.cardId as string;
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 询问无懈可击
      delete state.localVars['无懈/被抵消'];
      await applyAtom(state, { type: '请求回应', requestType: '无懈可击', target: -2, prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: (c) => c.name === '无懈可击', min: 1, max: 1 } }, timeout: 10 });
      if (!state.localVars['无懈/被抵消']) {
        await applyAtom(state, { type: '摸牌', player: from, count: 2 });
      }
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    }, );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
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
