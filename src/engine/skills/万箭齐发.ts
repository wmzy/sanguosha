// 万箭齐发(普通锦囊):出牌阶段,对所有其他角色使用。
// 每名目标依次判定:若不打出【闪】,则受到使用者造成的 1 点伤害。
//
// 结算逻辑已迁移到 card-effects/万箭齐发.ts (CardEffect.resolve)。
// execute 委托 runUseFlow 编排完整使用结算流程（文档 use.md）。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, validateUseCard } from '../skill';
import { runUseFlow } from '../card-effect/use-card';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '万箭齐发',
    description: '对所有其他角色使用,每名目标需出闪,否则受 1 点伤害',
  };
}

/** 计算全体锦囊目标：从使用者下家开始,按座次顺序的所有其他存活角色 */
function allOtherTargets(state: GameState, from: number): number[] {
  const alivePlayers = state.players.filter((p) => p.alive);
  const n = alivePlayers.length;
  if (n <= 1) return [];
  const fromPos = alivePlayers.findIndex((p) => p.index === from);
  if (fromPos < 0) return [];
  const targets: number[] = [];
  for (let i = 1; i < n; i++) {
    targets.push(alivePlayers[(fromPos + i) % n].index);
  }
  return targets;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '万箭齐发' });
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const targets = allOtherTargets(state, ownerId);
      await runUseFlow(state, ownerId, cardId, targets, '万箭齐发');
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '万箭齐发',
    style: 'danger',
    prompt: {
      type: 'useCard',
      title: '万箭齐发',
      cardFilter: { filter: (c) => c.name === '万箭齐发', min: 1, max: 1 },
    },
  });
}
