// src/engine/atoms/给予.ts
// 给予:从 from 玩家手牌将 cardId 给予 to 玩家
//
// 模块 F 迁移(出牌流程重设计.md):afterApply 发出「移动到目标区域后」时机标记(reason='给予')。
// 给予.validate 保证 cardId 在 from 手牌,from/to 均为手牌区域(ZoneLoc 可表达),标记 from/to 准确。
// 本 atom 的 apply + view 事件保持不变(含信息分级)。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { requirePlayer, viewPlayer } from './_helpers';
import { applyAtom } from '../core/apply';

export const 给予: AtomDefinition<{ cardId: string; from: number; to: number }> = {
  type: '给予',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    const fromErr = requirePlayer(state, atom.from, 'from');
    if (fromErr) return fromErr;
    if (!state.players[atom.from].hand.includes(atom.cardId)) return `card not in from's hand`;
    return requirePlayer(state, atom.to, 'to');
  },
  apply(state, atom) {
    const fromIdx = atom.from;
    const toIdx = atom.to;
    state.players[fromIdx].hand = state.players[fromIdx].hand.filter((id) => id !== atom.cardId);
    state.players[toIdx].hand.push(atom.cardId);
  },
  effect: { sound: 'flip', animation: 'slide', duration: 600 },
  /** 模块 F:发出「移动到目标区域后」时机标记(reason='给予',手牌→手牌)。 */
  async afterApply(state, atom) {
    await applyAtom(state, {
      type: '移动到目标区域后',
      cardId: atom.cardId,
      from: { zone: '手牌', player: atom.from },
      to: { zone: '手牌', player: atom.to },
      reason: '给予',
    });
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const effect = { sound: 'flip' as const, animation: 'slide' as const, duration: 600 };
    // toViewEvents 在 apply 之前调用,此时 cardId 还在 from 手牌里。
    // ownerView (from+to):都应看到 cardId 和牌名(从谁给到谁,什么牌)
    const ownerView: ViewEvent = {
      type: '给予',
      cardId: atom.cardId,
      cardName: _state.cardMap[atom.cardId]?.name,
      from: atom.from,
      to: atom.to,
      effect,
    };
    // othersView:第三方只看到「谁给了谁一张牌」,不暴露 cardId
    const othersView: ViewEvent = {
      type: '给予',
      from: atom.from,
      to: atom.to,
      effect,
    };
    return {
      ownerViews: new Map([
        [atom.from, ownerView],
        [atom.to, ownerView],
      ]),
      othersView,
    };
  },
  applyView(view, event) {
    const cardId = event.cardId as string | undefined;
    const fromP = viewPlayer(view, event.from as number);
    if (fromP) {
      fromP.handCount = Math.max(0, fromP.handCount - 1);
      if (cardId && fromP.hand) {
        fromP.hand = fromP.hand.filter((c) => c.id !== cardId);
      }
    }
    const toP = viewPlayer(view, event.to as number);
    if (toP) {
      toP.handCount += 1;
      if (cardId && toP.hand) {
        const card = view.cardMap[cardId];
        if (card) toP.hand.push(card);
      }
    }
  },
  toViewLog(event, viewer, resolveName) {
    const from = event.from as number;
    const to = event.to as number;
    const cardName = event.cardName as string | undefined;
    const toName = resolveName?.(to) ?? `P${to}`;
    // owner 视角(from+to)能看到具体牌面
    const isOwner = from === viewer || to === viewer;
    if (isOwner && cardName) {
      return { player: from, text: `将 ${cardName} 给予了 ${toName}` };
    }
    return { player: from, text: `给 ${toName} 一张牌` };
  },
};

