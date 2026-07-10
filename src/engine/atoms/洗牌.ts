// src/engine/atoms/洗牌.ts
// 洗牌:重新随机化当前牌堆顺序。
// 用 state.rngSeed 派生 RNG(推进后写回),保证重放确定性。
//
// 视图通信:牌堆数量不变(applyView 不改 zones),但洗牌动效是公开的——
// 前端需要展示洗牌动画。event 只含 type(不暴露顺序)。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
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
  effect: { sound: 'shuffle', animation: 'flip', duration: 400 },
  toViewEvents(): ViewEventSplit {
    const view: ViewEvent = { type: '洗牌' };
    // 洗牌是公开事件:所有玩家看到相同动效(不含牌序)
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 牌堆数量不变,无需更新 zones
  },
  toViewLog() {
    return { player: -1, text: '洗牌' };
  },
};

registerAtom(洗牌);
