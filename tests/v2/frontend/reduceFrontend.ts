import type { FrontendState, Animation, PlayerView, CardInfo } from './types';
import type { PlayerEvent } from '@engine/v2/types';
import { cloneFrontend } from './helpers';

type P = Record<string, unknown>;

export function reduceFrontend(fe: FrontendState, events: PlayerEvent[]): FrontendState {
  const state = cloneFrontend(fe);
  for (const event of events) {
    applyEvent(state, event);
  }
  return state;
}

function applyEvent(fe: FrontendState, event: PlayerEvent): void {
  const { type, payload } = event;
  const p = (payload ?? {}) as P;
  const myId = fe.myPlayerId;
  const view = fe.views[myId];
  if (!view) return;

  switch (type) {
    // ─── damage ───────────────────────────────────────────
    case 'damage': {
      const target = p.target as string;
      const amount = p.amount as number;
      if (target === myId) {
        view.self.health -= amount;
      } else if (view.others[target]) {
        view.others[target].health -= amount;
      }
      fe.animationQueue.push({ type: 'damagePopup', target, amount });
      break;
    }

    // ─── heal ─────────────────────────────────────────────
    case 'heal': {
      const target = p.target as string;
      const amount = p.amount as number;
      if (target === myId) {
        view.self.health = Math.min(view.self.health + amount, view.self.maxHealth);
      } else if (view.others[target]) {
        view.others[target].health = Math.min(
          view.others[target].health + amount,
          view.others[target].maxHealth,
        );
      }
      fe.animationQueue.push({ type: 'healGlow', target, amount });
      break;
    }

    // ─── draw ─────────────────────────────────────────────
    case 'draw': {
      const player = p.player as string;
      const count = p.count as number;
      if (player === myId) {
        const cards = p.cards as CardInfo[] | undefined;
        if (cards) {
          view.self.hand.push(...cards);
        }
      } else if (view.others[player]) {
        view.others[player].handCount += count;
      }
      fe.animationQueue.push({ type: 'drawCards', player, count });
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
        view.self.hand = view.self.hand.filter(c => !idSet.has(c.id));
      } else if (player === myId && count != null) {
        view.self.hand = view.self.hand.slice(0, view.self.hand.length - count);
      } else if (view.others[player]) {
        view.others[player].handCount -= (count ?? cardIds?.length ?? 0);
      }
      fe.animationQueue.push({
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
        if (card) view.self.hand.push(card);
      } else if (view.others[player]) {
        view.others[player].handCount++;
      }
      fe.animationQueue.push({
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
        const cardIdx = view.self.hand.findIndex(c => c.id === cardId);
        if (cardIdx !== -1) {
          const [card] = view.self.hand.splice(cardIdx, 1);
          const eq = view.self.equipment as unknown as Record<string, CardInfo | null>;
          const oldEquip = eq[slot];
          if (oldEquip) {
            view.table.discardPileCount++;
          }
          eq[slot] = card;
        }
      } else if (view.others[player]) {
        (view.others[player].equipment as unknown as Record<string, string | null>)[slot] = cardId;
      }
      fe.animationQueue.push({ type: 'equipItem', player, cardId, slot });
      break;
    }

    // ─── kill ─────────────────────────────────────────────
    case 'kill': {
      const player = p.player as string;
      if (player === myId) {
        view.self.health = 0;
        view.self.alive = false;
        view.self.equipment = { weapon: null, armor: null, mount: null };
      } else if (view.others[player]) {
        view.others[player].health = 0;
        view.others[player].alive = false;
        view.others[player].equipment = { weapon: null, armor: null, mount: null };
      }
      fe.animationQueue.push({ type: 'death', player });
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
      fe.animationQueue.push({ type: 'nextPlayer', player });
      break;
    }

    // ─── pushPending ──────────────────────────────────────
    case 'pushPending': {
      (fe as unknown as Record<string, unknown>).pending = event;
      const actionType = (p.actionType ?? p.type ?? 'pushPending') as string;
      fe.animationQueue.push({ type: 'pendingPrompt', actionType });
      break;
    }

    // ─── popPending ───────────────────────────────────────
    case 'popPending': {
      fe.pending = null;
      break;
    }

    // ─── judge ────────────────────────────────────────────
    case 'judge': {
      view.table.discardPileCount++;
      fe.animationQueue.push({ type: 'cardFlip', cardId: (p.cardId ?? '') as string });
      break;
    }

    // ─── moveCard / cardMoved ─────────────────────────────
    case 'moveCard':
    case 'cardMoved': {
      const to = p.to as P | undefined;
      const from = p.from as P | undefined;
      if (to?.zone === 'discardPile') {
        view.table.discardPileCount++;
      }
      if (from?.zone === 'discardPile') {
        view.table.discardPileCount = Math.max(0, view.table.discardPileCount - 1);
      }
      fe.animationQueue.push({
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
      if (player === myId) {
        view.self.tags.push(p.tag as string);
      }
      break;
    }

    // ─── removeTag ────────────────────────────────────────
    case 'removeTag': {
      const player = p.player as string;
      if (player === myId) {
        view.self.tags = view.self.tags.filter(t => t !== (p.tag as string));
      }
      break;
    }

    // ─── setVar ───────────────────────────────────────────
    case 'setVar': {
      const player = p.player as string;
      if (player === myId) {
        view.self.vars[p.key as string] = p.value;
      }
      break;
    }

    // ─── addPendingTrick ──────────────────────────────────
    case 'addPendingTrick': {
      const player = p.player as string;
      if (player === myId) {
        view.self.pendingTricks.push(p.trick as FrontendState['views'][string]['self']['pendingTricks'][number]);
      }
      fe.animationQueue.push({ type: 'pendingPrompt', actionType: 'addPendingTrick' });
      break;
    }

    // ─── removePendingTrick ───────────────────────────────
    case 'removePendingTrick': {
      const player = p.player as string;
      const index = p.index as number;
      let removedCardId = p.cardId as string | undefined;
      if (player === myId && index >= 0 && index < view.self.pendingTricks.length) {
        if (!removedCardId) {
          removedCardId = view.self.pendingTricks[index].cardId;
        }
        view.self.pendingTricks.splice(index, 1);
      }
      fe.animationQueue.push({
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
      fe.animationQueue.push({
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
