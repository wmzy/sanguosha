// 桃园结义(普通锦囊):出牌阶段,对所有存活角色使用,每名目标回复 1 点体力。
//
// 结算逻辑已迁移到 card-effects/桃园结义.ts (CardEffect.resolve)。
// execute 委托 runUseFlow 编排完整使用结算流程（文档 use.md）。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, validateUseCard } from '../skill';
import { runUseFlow } from '../card-effect/use-card';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '桃园结义', description: '锦囊:所有角色各回复1点体力' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '桃园结义' });
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      // 所有存活角色（含使用者），按座次顺序
      const targets = state.players.filter((p) => p.alive).map((p) => p.index);
      await runUseFlow(state, ownerId, cardId, targets, '桃园结义');
    },
  );
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
