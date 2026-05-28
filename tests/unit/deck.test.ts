// tests/unit/deck.test.ts
import { describe, it, expect } from 'vitest';
import { shuffle, drawCards, discardCards } from '@shared/deck';
import { createDeck } from '@shared/cards';
import { createRng } from '@shared/rng';

describe('牌组管理', () => {
  describe('洗牌', () => {
    it('应该返回相同数量的牌', () => {
      const original = createDeck();
      const shuffled = shuffle([...original], createRng(42));
      expect(shuffled.length).toBe(original.length);
    });

    it('应该包含所有原始牌', () => {
      const original = createDeck();
      const shuffled = shuffle([...original], createRng(42));
      const sorted = (cards: typeof original) =>
        [...cards].sort((a, b) => a.name.localeCompare(b.name) || a.suit.localeCompare(b.suit) || a.rank.localeCompare(b.rank));
      expect(sorted(shuffled)).toEqual(sorted(original));
    });
  });

  describe('摸牌', () => {
    it('应该从牌堆顶部摸指定数量的牌', () => {
      const original = createDeck();
      const shuffled = shuffle([...original], createRng(42));
      const { drawn, remaining } = drawCards(shuffled, 2);
      expect(drawn.length).toBe(2);
      expect(remaining.length).toBe(shuffled.length - 2);
      expect(drawn[0]).toBe(shuffled[0]);
      expect(drawn[1]).toBe(shuffled[1]);
    });

    it('牌堆不足时摸完所有牌', () => {
      const original = createDeck().slice(0, 1);
      const { drawn, remaining } = drawCards(original, 3);
      expect(drawn.length).toBe(1);
      expect(remaining.length).toBe(0);
    });
  });

  describe('弃牌', () => {
    it('应该将牌放入弃牌堆', () => {
      const original = createDeck();
      const discarded = [original[0], original[1]];
      const discardPile = discardCards([], discarded);
      expect(discardPile.length).toBe(2);
      expect(discardPile).toEqual(discarded);
    });
  });
});
