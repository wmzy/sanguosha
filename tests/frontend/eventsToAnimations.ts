import type { PlayerEvent } from '@engine/types';
import type { Animation } from './types';

export function eventsToAnimations(playerId: string, events: PlayerEvent[]): Animation[] {
  const result: Animation[] = [];

  for (const event of events) {
    const p = event.payload as Record<string, unknown>;
    const anim = mapEvent(event.type, p);
    if (anim) {
      result.push(anim);
    }
  }

  return result;
}

function mapEvent(type: string, p: Record<string, unknown>): Animation | null {
  switch (type) {
    case 'damage':
      return {
        type: 'damagePopup',
        target: (p.target ?? '') as string,
        amount: (p.amount ?? 0) as number,
      };

    case 'heal':
      return {
        type: 'healGlow',
        target: (p.target ?? '') as string,
        amount: (p.amount ?? 0) as number,
      };

    case 'draw':
      return {
        type: 'drawCards',
        player: (p.player ?? '') as string,
        count: (p.count ?? 0) as number,
      };

    case 'discard':
      return {
        type: 'discardCards',
        player: (p.player ?? '') as string,
        cardIds: (p.cardIds ?? []) as string[],
      };

    case 'gainCard':
      return {
        type: 'cardMove',
        cardId: ((p.cardId ?? (p.card as Record<string, unknown> | undefined)?.id) ?? '') as string,
        from: (p.from ?? { zone: 'discardPile' }) as { zone: string; player?: string },
        to: { zone: 'hand', player: (p.player ?? '') as string },
        duration: 300,
      };

    case 'equip':
      return {
        type: 'equipItem',
        player: (p.player ?? '') as string,
        cardId: (p.cardId ?? '') as string,
        slot: (p.slot ?? '') as string,
      };

    case 'kill':
      return {
        type: 'death',
        player: ((p.player ?? p.target) ?? '') as string,
      };

    case 'pushPending':
      return {
        type: 'pendingPrompt',
        actionType: ((p.type ?? '') as string),
      };

    case 'judge':
      return {
        type: 'cardFlip',
        cardId: ((p.cardId ?? '') as string),
      };

    case 'moveCard':
      return {
        type: 'cardMove',
        cardId: (p.cardId ?? '') as string,
        from: p.from as { zone: string; player?: string },
        to: p.to as { zone: string; player?: string },
        duration: 300,
      };

    case 'setPhase':
      return null;

    case 'nextPlayer':
      return {
        type: 'nextPlayer',
        player: (p.player ?? '') as string,
      };

    case 'addPendingTrick':
      return {
        type: 'pendingPrompt',
        actionType: 'addPendingTrick',
      };

    case 'removePendingTrick':
      return {
        type: 'trickReveal',
        cardId: ((p.cardId ?? '') as string),
        result: ((p.result ?? 'success') as 'success' | 'fail'),
      };

    default:
      return null;
  }
}
