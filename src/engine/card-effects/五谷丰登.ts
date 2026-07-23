// 五谷丰登 CardEffect — 普通锦囊·五谷丰登的使用结算。
//
// resolve（全体）：翻 X 张到处理区 → 逐目标无懈 → 选牌。
//
// 注意：五谷丰登的选牌发生在逐目标循环中。runUseFlow 逐目标调用 resolve，
// 但五谷丰登需要先翻牌（仅一次）再逐目标选牌。
// 实现方式：在 resolve 第一次调用时翻牌（通过 localVars 标记），
// 之后每次调用处理一个目标。清理（剩余牌入弃牌堆）在 onSettle 中完成。

import type { Card, SettlementFrame } from '../types';
import type { ActionPrompt } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { 询问无懈可击 } from '../无懈可击';
import { registerCardEffect, type CardEffect, type ResolveCtx } from '../card-effect/registry';

/** 从使用者开始,按座次旋转的所有存活玩家 */
function alivePlayersFrom(state: import('../types').GameState, from: number): number[] {
  const alive = state.players.filter((p) => p.alive);
  const n = alive.length;
  if (n === 0) return [];
  const fromPos = alive.findIndex((p) => p.index === from);
  if (fromPos < 0) return alive.map((p) => p.index);
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    result.push(alive[(fromPos + i) % n].index);
  }
  return result;
}

/** 选牌面板：弹 pickProcessingCard pending，超时兜底选候选列表第一张 */
async function runPickProcessingCard(
  state: import('../types').GameState,
  target: number,
  revealedIds: string[],
  frame: SettlementFrame,
): Promise<void> {
  const available = revealedIds.filter((id) => frameCards(state).includes(id));
  if (available.length === 0) return;

  const cards = available
    .map((id) => {
      const c = state.cardMap[id];
      if (!c) return null;
      return { cardId: id, cardName: c.name, suit: c.suit, rank: c.rank };
    })
    .filter(
      (c): c is { cardId: string; cardName: string; suit: Card['suit']; rank: string } =>
        c !== null,
    );

  await applyAtom(state, {
    type: '请求回应',
    requestType: '五谷丰登/select',
    target,
    prompt: {
      type: 'pickProcessingCard',
      title: '五谷丰登:选择 1 张牌',
      cards,
    },
    timeout: 20,
  });

  const pickedId = state.localVars['五谷丰登/选择'] as string | undefined;
  delete state.localVars['五谷丰登/选择'];
  const stillAvailable = revealedIds.filter((id) => frameCards(state).includes(id));
  const cardId = pickedId && stillAvailable.includes(pickedId) ? pickedId : stillAvailable[0];
  if (cardId) {
    await applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '处理区' },
      to: { zone: '手牌', player: target },
    });
    const pickerName = state.players[target]?.name ?? `P${target}`;
    const cur = (frame.params.pickedBy as Record<string, string> | undefined) ?? {};
    await applyAtom(state, {
      type: '帧参数赋值',
      key: 'pickedBy',
      value: { ...cur, [cardId]: pickerName },
    });
  }
}

/** 五谷丰登的逐目标结算：首轮翻牌 → 无懈 → 选牌 */
async function resolveBountifulHarvest(ctx: ResolveCtx): Promise<void> {
  const { state, source, target } = ctx;

  // 仅首次调用时翻牌：将 X 张牌从牌堆移到处理区
  if (!state.localVars['五谷丰登/已翻牌']) {
    state.localVars['五谷丰登/已翻牌'] = true;
    const allTargets = alivePlayersFrom(state, source);
    const cardCount = allTargets.length;
    const revealedIds: string[] = [];
    for (let i = 0; i < cardCount; i++) {
      if (state.zones.deck.length === 0) break;
      const topId = state.zones.deck[0];
      await applyAtom(state, {
        type: '移动牌',
        cardId: topId,
        from: { zone: '牌堆' },
        to: { zone: '处理区' },
      });
      revealedIds.push(topId);
    }
    state.localVars['五谷丰登/亮牌'] = revealedIds;
  }

  const revealedIds = state.localVars['五谷丰登/亮牌'] as string[] | undefined;
  if (!revealedIds) return;
  if (!revealedIds.some((id) => frameCards(state).includes(id))) return;

  const cancelled = await 询问无懈可击(state, target);
  if (cancelled) return;

  // 取当前帧（五谷丰登结算帧）记录 pickedBy
  const frame = state.settlementStack[state.settlementStack.length - 1];
  if (!revealedIds.some((id) => frameCards(state).includes(id))) return;
  await runPickProcessingCard(state, target, revealedIds, frame);
}

/** 五谷丰登的结算后回调：剩余亮出的牌入弃牌堆 + 清理 localVars */
async function onSettleBountifulHarvest(
  state: import('../types').GameState,
  _source: number,
  _cardId: string,
): Promise<void> {
  // 将所有非锦囊的处理区牌（亮出的剩余牌）移入弃牌堆
  // 锦囊本身由 runUseFlow 的 finally 处理
  const revealedIds = state.localVars['五谷丰登/亮牌'] as string[] | undefined;
  if (revealedIds) {
    for (const id of revealedIds) {
      if (frameCards(state).includes(id)) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: id,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    }
  }
  delete state.localVars['五谷丰登/亮牌'];
  delete state.localVars['五谷丰登/已翻牌'];
  delete state.localVars['五谷丰登/选择'];
}

const bountifulHarvestEffect: CardEffect = {
  timing: '出牌阶段',
  target: { kind: 'allPlayers' },
  resolve: resolveBountifulHarvest,
  onSettle: onSettleBountifulHarvest,
  // respond：玩家从处理区亮的牌中选 1 张（requestType='五谷丰登/select'）。
  // 原逻辑来自 src/engine/skills/五谷丰登.ts 的 respond registerAction。
  respond: {
    validate: (state, ownerId, params) => {
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
    execute: async (state, _ownerId, params) => {
      const cardId = params.cardId as string;
      state.localVars['五谷丰登/选择'] = cardId;
    },
  },
  prompt: {
    type: 'useCard',
    title: '五谷丰登',
    cardFilter: { filter: (c: Card) => c.name === '五谷丰登', min: 1, max: 1 },
  } as ActionPrompt,
  label: '五谷丰登',
  style: 'primary',
};

registerCardEffect('五谷丰登', bountifulHarvestEffect);
