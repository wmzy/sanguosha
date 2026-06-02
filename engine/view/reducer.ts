// engine/view/reducer.ts — FrontendState reducer
//
// 客户端把服务器推送的 events 序列应用到本地 FrontendState 上，得到最新视图。
// 这是事件溯源风格：初始快照 + 事件流 = 当前状态。

import type { PlayerEvent, PendingAction } from '../types';
import type { FrontendState, PlayerView, Animation, CardInfo } from './types';
import { clonePlayerView } from './buildView';

type P = Record<string, unknown>;

export function reduceFrontend(fe: FrontendState, events: PlayerEvent[]): FrontendState {
  const view = clonePlayerView(fe.view);
  const animationQueue = [...fe.animationQueue];
  for (const event of events) {
    applyEvent({ view, animationQueue, myPlayerId: fe.myPlayerId }, event);
  }
  return { view, myPlayerId: fe.myPlayerId, animationQueue };
}

/** 把 events 序列转换为动画队列（不修改 FrontendState）。 */
export function eventsToAnimations(myPlayerId: string, events: PlayerEvent[]): Animation[] {
  const result: Animation[] = [];
  for (const event of events) {
    const p = (event.payload ?? {}) as Record<string, unknown>;
    const anim = mapEvent(event.type, p);
    if (anim) result.push(anim);
  }
  return result;
}

function mapEvent(type: string, p: Record<string, unknown>): Animation | null {
  switch (type) {
    case 'damage':
      return { type: 'damagePopup', target: (p.target ?? '') as string, amount: (p.amount ?? 0) as number };
    case 'heal':
      return { type: 'healGlow', target: (p.target ?? '') as string, amount: (p.amount ?? 0) as number };
    case 'draw':
      return { type: 'drawCards', player: (p.player ?? '') as string, count: (p.count ?? 0) as number };
    case 'discard':
      return { type: 'discardCards', player: (p.player ?? '') as string, cardIds: (p.cardIds ?? []) as string[] };
    case 'gainCard':
      return {
        type: 'cardMove',
        cardId: ((p.cardId ?? (p.card as Record<string, unknown> | undefined)?.id) ?? '') as string,
        from: (p.from ?? { zone: 'discardPile' }) as { zone: string; player?: string },
        to: { zone: 'hand', player: (p.player ?? '') as string },
        duration: 300,
      };
    case 'equip':
      return { type: 'equipItem', player: (p.player ?? '') as string, cardId: (p.cardId ?? '') as string, slot: (p.slot ?? '') as string };
    case 'kill':
      return { type: 'death', player: ((p.player ?? p.target) ?? '') as string };
    case 'pushPending':
      return { type: 'pendingPrompt', actionType: ((p.type ?? '') as string) };
    case 'judge':
      return { type: 'cardFlip', cardId: ((p.cardId ?? '') as string) };
    case 'moveCard':
      return {
        type: 'cardMove',
        cardId: (p.cardId ?? '') as string,
        from: p.from as { zone: string; player?: string },
        to: p.to as { zone: string; player?: string },
        duration: 300,
      };
    case 'nextPlayer':
      return { type: 'nextPlayer', player: (p.player ?? '') as string };
    case 'addPendingTrick':
      return { type: 'pendingPrompt', actionType: 'addPendingTrick' };
    case 'removePendingTrick':
      return { type: 'trickReveal', cardId: ((p.cardId ?? '') as string), result: ((p.result ?? 'success') as 'success' | 'fail') };
    default:
      return null;
  }
}

interface ReducerCtx {
  view: PlayerView;
  animationQueue: Animation[];
  myPlayerId: string;
}

function applyEvent(ctx: ReducerCtx, event: PlayerEvent): void {
  const { type, payload } = event;
  const p = (payload ?? {}) as P;
  const myId = ctx.myPlayerId;
  const view = ctx.view;
  const self = view.self;
  const others = view.others;

  switch (type) {
    // ─── damage ───────────────────────────────────────────
    case 'damage': {
      const target = p.target as string;
      const amount = p.amount as number;
      if (target === myId) {
        self.health -= amount;
      } else if (others[target]) {
        others[target].health -= amount;
      }
      ctx.animationQueue.push({ type: 'damagePopup', target, amount });
      break;
    }

    // ─── heal ─────────────────────────────────────────────
    case 'heal': {
      const target = p.target as string;
      const amount = p.amount as number;
      if (target === myId) {
        self.health = Math.min(self.health + amount, self.maxHealth);
      } else if (others[target]) {
        others[target].health = Math.min(others[target].health + amount, others[target].maxHealth);
      }
      ctx.animationQueue.push({ type: 'healGlow', target, amount });
      break;
    }

    // ─── draw ─────────────────────────────────────────────
    case 'draw': {
      const player = p.player as string;
      const count = p.count as number;
      if (player === myId) {
        const cards = p.cards as CardInfo[] | undefined;
        if (cards) self.hand.push(...cards);
      } else if (others[player]) {
        others[player].handCount += count;
      }
      ctx.animationQueue.push({ type: 'drawCards', player, count });
      break;
    }

    // ─── discard ──────────────────────────────────────────
    case 'discard':
    case 'cardsDiscarded': {
      const player = p.player as string;
      const cardIds = p.cardIds as string[] | undefined;
      const count = p.count as number | undefined;
      if (player === myId && cardIds) {
        const idSet = new Set(cardIds);
        self.hand = self.hand.filter(c => !idSet.has(c.id));
      } else if (player === myId && count != null) {
        self.hand = self.hand.slice(0, self.hand.length - count);
      } else if (others[player]) {
        others[player].handCount -= (count ?? cardIds?.length ?? 0);
      }
      ctx.animationQueue.push({
        type: 'discardCards',
        player,
        cardIds: cardIds ?? [],
      });
      break;
    }

    // ─── gainCard ─────────────────────────────────────────
    case 'gainCard':
    case 'cardGained': {
      const player = p.player as string;
      const from = p.from as P | undefined;
      if (player === myId) {
        const card = p.card as CardInfo | undefined;
        if (card) self.hand.push(card);
      } else if (others[player]) {
        others[player].handCount++;
      }
      ctx.animationQueue.push({
        type: 'cardMove',
        cardId: (p.cardId ?? '') as string,
        from: (from ?? { zone: 'unknown' }) as Animation extends { type: 'cardMove' } ? Animation['from'] : never,
        to: { zone: 'hand', player },
        duration: 300,
      });
      break;
    }

    // ─── equip ────────────────────────────────────────────
    case 'equip': {
      const player = p.player as string;
      const cardId = p.cardId as string;
      const slot = p.slot as string;
      if (player === myId) {
        const cardIdx = self.hand.findIndex(c => c.id === cardId);
        if (cardIdx !== -1) {
          const [card] = self.hand.splice(cardIdx, 1);
          const eq = self.equipment as unknown as Record<string, CardInfo | null>;
          if (eq[slot]) view.table.discardPileCount++;
          eq[slot] = card;
        }
      } else if (others[player]) {
        (others[player].equipment as unknown as Record<string, string | null>)[slot] = cardId;
      }
      ctx.animationQueue.push({ type: 'equipItem', player, cardId, slot });
      break;
    }

    // ─── kill ─────────────────────────────────────────────
    case 'kill': {
      const player = p.player as string;
      if (player === myId) {
        self.health = 0;
        self.alive = false;
        self.equipment = { weapon: null, armor: null, mount: null };
      } else if (others[player]) {
        others[player].health = 0;
        others[player].alive = false;
        others[player].equipment = { weapon: null, armor: null, mount: null };
      }
      ctx.animationQueue.push({ type: 'death', player });
      break;
    }

    // ─── setPhase ─────────────────────────────────────────
    case 'setPhase': {
      view.turn.phase = p.phase as string;
      break;
    }

    // ─── nextPlayer ───────────────────────────────────────
    case 'nextPlayer': {
      const player = (p.player ?? p.to) as string;
      view.turn.currentPlayer = player;
      view.turn.phase = '准备';
      ctx.animationQueue.push({ type: 'nextPlayer', player });
      break;
    }

    // ─── pushPending ──────────────────────────────────────
    case 'pushPending': {
      const actionType = (p.actionType ?? p.type ?? 'pushPending') as string;
      ctx.animationQueue.push({ type: 'pendingPrompt', actionType });
      // 将完整的 PendingAction 同步到视图（服务端 pushPending atom 现在会在 payload 中携带完整 action）
      view.pending = event.payload as unknown as PendingAction;
      break;
    }

    // ─── popPending ───────────────────────────────────────
    case 'popPending': {
      view.pending = null;
      break;
    }

    // ─── judge ────────────────────────────────────────────
    case 'judge': {
      view.table.discardPileCount++;
      ctx.animationQueue.push({ type: 'cardFlip', cardId: (p.cardId ?? '') as string });
      break;
    }

    // ─── moveCard / cardMoved ─────────────────────────────
    case 'moveCard':
    case 'cardMoved': {
      const to = p.to as P | undefined;
      const from = p.from as P | undefined;
      if (to?.zone === 'discardPile') view.table.discardPileCount++;
      if (from?.zone === 'discardPile') {
        view.table.discardPileCount = Math.max(0, view.table.discardPileCount - 1);
      }
      ctx.animationQueue.push({
        type: 'cardMove',
        cardId: (p.cardId ?? '') as string,
        from: (from ?? { zone: 'unknown' }) as Animation extends { type: 'cardMove' } ? Animation['from'] : never,
        to: (to ?? { zone: 'unknown' }) as Animation extends { type: 'cardMove' } ? Animation['to'] : never,
        duration: 300,
      });
      break;
    }

    // ─── addTag ───────────────────────────────────────────
    case 'addTag': {
      const player = p.player as string;
      if (player === myId) self.tags.push(p.tag as string);
      break;
    }

    // ─── removeTag ────────────────────────────────────────
    case 'removeTag': {
      const player = p.player as string;
      if (player === myId) self.tags = self.tags.filter(t => t !== (p.tag as string));
      break;
    }

    // ─── setVar ───────────────────────────────────────────
    case 'setVar': {
      const player = p.player as string;
      if (player === myId) self.vars[p.key as string] = p.value;
      break;
    }

    // ─── addPendingTrick ──────────────────────────────────
    case 'addPendingTrick': {
      const player = p.player as string;
      if (player === myId) {
        self.pendingTricks.push(p.trick as PlayerView['self']['pendingTricks'][number]);
      }
      ctx.animationQueue.push({ type: 'pendingPrompt', actionType: 'addPendingTrick' });
      break;
    }

    // ─── removePendingTrick ───────────────────────────────
    case 'removePendingTrick': {
      const player = p.player as string;
      const index = p.index as number;
      let removedCardId = p.cardId as string | undefined;
      if (player === myId && index >= 0 && index < self.pendingTricks.length) {
        removedCardId ??= self.pendingTricks[index].cardId;
        self.pendingTricks.splice(index, 1);
      }
      ctx.animationQueue.push({
        type: 'trickReveal',
        cardId: removedCardId ?? '',
        result: (p.result ?? 'fail') as 'success' | 'fail',
      });
      break;
    }

    // ─── rearrangeDeck ────────────────────────────────────
    case 'rearrangeDeck': {
      break;
    }

    // ─── turnStart ────────────────────────────────────────
    case 'turnStart': {
      view.turn.currentPlayer = p.player as string;
      break;
    }

    // ─── skillActivate ────────────────────────────────────
    case 'skillActivate': {
      ctx.animationQueue.push({
        type: 'skillActivate',
        player: p.player as string,
        skillId: p.skillId as string,
      });
      break;
    }

    default:
      break;
  }
}
