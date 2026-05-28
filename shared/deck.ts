import type { Card } from './types';
import type { Rng } from './rng';

export function shuffle(deck: Card[], rng: Rng): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function drawCards(deck: Card[], count: number): { drawn: Card[]; remaining: Card[] } {
  const drawn = deck.slice(0, count);
  const remaining = deck.slice(count);
  return { drawn, remaining };
}

export function discardCards(discardPile: Card[], cards: Card[]): Card[] {
  return [...discardPile, ...cards];
}
