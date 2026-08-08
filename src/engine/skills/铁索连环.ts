// 铁索连环(普通锦囊):
//   use:出牌阶段,横置或重置一至两名角色的连环状态(可被无懈可击)。
//   recast(重铸):弃此牌,摸一张牌。
//
// use 结算逻辑在 card-effects/铁索连环.ts (CardEffect.resolve)。
// 连环传导(属性伤害联动)已迁出至 face-down.ts 的 registerChainConductionHook,
//   由 index 的 bootstrap/registerSkillsFromState 作为伤害结算基础设施注册,
//   与铁索连环牌解耦——任何途径置入连环状态都受传导管辖。
//
// 本文件仅保留 recast action(重铸替代出牌):自定义 actionType,不走标准使用流程。
//   use 由「使用牌」按卡名注册路由到 CardEffect.resolve。
//   recast 实质效果(弃牌+摸一张)复用通用 recastCard helper。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { recastCard } from '../flows/recast';
import { registerAction, validateUseCard, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '铁索连环',
    description: '横置/重置一至两名角色;或重铸',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── recast:重铸(弃此牌,摸一张)──
  const recastUnload = registerAction(
    state,
    skill.id,
    ownerId,
    'recast',
    (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '铁索连环' });
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      await recastCard(state, ownerId, cardId);
    },
  );

  return () => {
    recastUnload();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('recast', {
    label: '铁索连环·重铸',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '铁索连环:重铸(弃此牌,摸一张)',
      cardFilter: { filter: (c) => c.name === '铁索连环', min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
