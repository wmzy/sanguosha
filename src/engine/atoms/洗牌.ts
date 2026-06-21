// src/engine/atoms/洗牌.ts
// 洗牌:重新随机化当前牌堆顺序。
// 用 state.rngSeed 派生 RNG(推进后写回),保证重放确定性。
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';
import { createRng } from '../../shared/rng';

export const 洗牌: AtomDefinition<Record<string, never>> = {
  type: '洗牌',
  validate(state) {
    if (state.zones.deck.length <= 1) return 'deck has fewer than 2 cards';
    return null;
  },
  apply(state) {
    const rng = createRng(state.rngSeed);
    const deck = [...state.zones.deck];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    state.zones.deck = deck;
    state.rngSeed = rng.getState();
  },
};

registerAtom(洗牌);
