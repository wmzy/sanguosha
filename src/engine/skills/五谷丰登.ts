// 五谷丰登(普通锦囊):出牌阶段对所有存活角色使用。
//   流程:
//     1. 从牌堆顶翻 X 张到处理区亮出(X = 存活玩家数)
//     2. 从使用者开始,按座次顺序,每名目标:
//        a) 在该目标选牌前询问一次无懈可击(无懈抵消该目标的选牌效果)
//        b) 未被抵消 → 该目标从处理区选 1 张到手牌
//     3. 剩余牌置入弃牌堆
//
// 结算逻辑已迁移到 card-effects/五谷丰登.ts (CardEffect.resolve + onSettle)。
// execute 委托 runUseFlow 编排完整使用结算流程（文档 use.md）。
// respond action（选牌）保留在本技能。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { frameCards } from '../create-engine';
import { registerAction, validateUseCard } from '../skill';
import { runUseFlow } from '../card-effect/use-card';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '五谷丰登', description: '锦囊:从牌堆亮出N张,全体依次选1张' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // ── use:主动打出五谷丰登 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '五谷丰登' });
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      // 所有存活目标（含使用者），从使用者开始按座次顺序
      // card-effect resolve 内部按 targetIndex 处理，targets 顺序 = 从使用者开始
      const alive = state.players.filter((p) => p.alive);
      const n = alive.length;
      const fromPos = alive.findIndex((p) => p.index === ownerId);
      const targets: number[] = [];
      if (fromPos >= 0) {
        for (let i = 0; i < n; i++) {
          targets.push(alive[(fromPos + i) % n].index);
        }
      }
      await runUseFlow(state, ownerId, cardId, targets, '五谷丰登');
    },
  );

  // ── respond:玩家选1张牌(从处理区亮的牌中) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是五谷丰登选牌窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '五谷丰登/select') return '当前不是五谷丰登选牌窗口';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      if (!frameCards(state).includes(cardId)) return '该牌不在可选范围';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      state.localVars['五谷丰登/选择'] = cardId;
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '五谷丰登',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '五谷丰登',
      cardFilter: { filter: (c) => c.name === '五谷丰登', min: 1, max: 1 },
    },
  });
  api.defineAction('respond', {
    label: '五谷丰登',
    style: 'primary',
    prompt: {
      type: 'pickProcessingCard',
      title: '五谷丰登:选择 1 张牌',
      cards: [],
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
