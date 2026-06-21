// src/engine/atoms/摸牌.ts
// 摸牌:从牌堆顶抽 count 张到手牌。
// 牌堆不足时,合并弃牌堆重洗补充(标准三国杀规则);牌堆+弃牌堆总数仍不足时,
// 才算不合法(validate 报错)。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { createRng } from '../../shared/rng';

interface DrawPlan {
  /** 实际将要摸入的 cardIds(已倒序:末尾对应最先摸) */
  drawn: string[];
  /** 重洗后的新牌堆(不含已摸的牌);reshuffled=false 时为 undefined */
  newDeck?: string[];
  /** 是否触发了重洗 */
  reshuffled: boolean;
  /** 重洗后写回的新 rngSeed;reshuffled=false 时为 undefined */
  newSeed?: number;
}

/**
 * 规划一次摸牌:计算将要摸入的牌,以及(必要时)重洗后的新牌堆。
 * 纯函数,不修改 state——apply 与 toViewEvents 共用此逻辑,保证两边一致。
 * 调用方需保证 deck+discardPile 总数 >= count(validate 已拦截)。
 */
function planDraw(state: { zones: { deck: string[]; discardPile: string[] }; rngSeed: number }, count: number): DrawPlan {
  if (state.zones.deck.length >= count) {
    return { drawn: state.zones.deck.slice(-count).reverse(), reshuffled: false };
  }
  // 牌堆不足:合并 deck + discardPile,Fisher–Yates 洗牌
  const combined = [...state.zones.deck, ...state.zones.discardPile];
  const rng = createRng(state.rngSeed);
  for (let i = combined.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return {
    drawn: combined.slice(-count).reverse(),
    newDeck: combined.slice(0, -count),
    reshuffled: true,
    newSeed: rng.getState(),
  };
}

export const 摸牌: AtomDefinition<{ player: number; count: number }> = {
  type: '摸牌',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (atom.count <= 0) return 'count must be > 0';
    // 牌堆 + 弃牌堆总数都不足以满足 count 时才真的无牌可摸
    const total = state.zones.deck.length + state.zones.discardPile.length;
    if (total < atom.count) return 'no cards available (deck + discardPile)';
    return null;
  },
  apply(state, atom) {
    const plan = planDraw(state, atom.count);
    if (plan.reshuffled) {
      state.zones.deck = plan.newDeck!;
      state.zones.discardPile = [];
      state.rngSeed = plan.newSeed!;
    } else {
      state.zones.deck = state.zones.deck.slice(0, -atom.count);
    }
    state.players[atom.player].hand.push(...plan.drawn);
  },
  effect: { sound: 'draw', animation: 'slide', duration: 200 },
  toViewEvents(state, atom): ViewEventSplit {
    const effect = { sound: 'draw' as const, animation: 'slide' as const, duration: 200 };
    const { drawn } = planDraw(state, atom.count);
    const cards = drawn.map(id => state.cardMap[id]).filter(Boolean);
    const ownerView: ViewEvent = {
      type: '摸牌',
      player: atom.player,
      count: atom.count,
      cards,
      effect,
    };
    // 其他人只看到数量
    const othersView: ViewEvent = {
      type: '摸牌',
      player: atom.player,
      count: atom.count,
      effect,
    };
    return {
      ownerViews: new Map([[atom.player, ownerView]]),
      othersView,
    };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    const count = (event.count as number) ?? 0;
    view.players[pi].handCount += count;
    // owner 有 cards 字段，加入手牌；others 没有
    if (event.cards && view.players[pi].hand) {
      view.players[pi].hand!.push(...(event.cards as any[]));
    }
  },
};

registerAtom(摸牌);
