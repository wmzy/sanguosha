// 无中生有(普通锦囊):出牌阶段对自己使用,摸两张牌。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, validateUseCard } from '../skill';
import { runUseFlow } from '../card-effect/use-card';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '无中生有', description: '锦囊:摸两张牌' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '无中生有' });
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      // 结算逻辑委托 runUseFlow → CardEffect['无中生有'].resolve
      // 无中生有无目标（kind='none'），targets=[]
      await runUseFlow(state, ownerId, cardId, [], '无中生有');
    },
  );
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
