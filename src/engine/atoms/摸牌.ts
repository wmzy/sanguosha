// src/engine/atoms/摸牌.ts
// 摸牌:从牌堆顶抽 count 张到手牌。
// 牌堆不足时,合并弃牌堆重洗补充(标准三国杀规则);牌堆+弃牌堆总数仍不足时,
// 才算不合法(validate 报错)。
import type { AtomDefinition, Card, ViewEventSplit, ViewEvent } from '../types';
import { createRng } from '../util/rng';

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
function planDraw(
  state: { zones: { deck: string[]; discardPile: string[] }; rngSeed: number },
  count: number,
  fromBottom = false,
): DrawPlan {
  if (state.zones.deck.length >= count) {
    // 牌堆方向约定:deck[0]=牌堆底(最后摸),deck[末尾]=牌堆顶(最先摸)。
    // 从牌堆顶摸:取末尾 count 张并倒序(末尾最先摸)。
    // 从牌堆底摸(寸目):取开头 count 张并保持顺序(deck[0] 最先摸)。
    return {
      drawn: fromBottom ? state.zones.deck.slice(0, count) : state.zones.deck.slice(-count).reverse(),
      reshuffled: false,
    };
  }
  // 牌堆不足:合并 deck + discardPile,Fisher–Yates 洗牌
  const combined = [...state.zones.deck, ...state.zones.discardPile];
  const rng = createRng(state.rngSeed);
  for (let i = combined.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return {
    drawn: fromBottom ? combined.slice(0, count) : combined.slice(-count).reverse(),
    newDeck: fromBottom ? combined.slice(count) : combined.slice(0, -count),
    reshuffled: true,
    newSeed: rng.getState(),
  };
}

export const 摸牌: AtomDefinition<{ player: number; count: number; fromBottom?: boolean }> = {
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
    const fromBottom = !!atom.fromBottom;
    const plan = planDraw(state, atom.count, fromBottom);
    if (plan.reshuffled) {
      state.zones.deck = plan.newDeck!;
      state.zones.discardPile = [];
      state.rngSeed = plan.newSeed!;
    } else {
      state.zones.deck = fromBottom
        ? state.zones.deck.slice(atom.count)
        : state.zones.deck.slice(0, -atom.count);
    }
    state.players[atom.player].hand.push(...plan.drawn);
  },
  effect: { sound: 'flip', animation: 'slide', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    const effect = { sound: 'flip' as const, animation: 'slide' as const, duration: 600 };
    const plan = planDraw(state, atom.count, !!atom.fromBottom);
    const cards = plan.drawn.map((id) => state.cardMap[id]).filter(Boolean);
    const base = {
      type: '摸牌' as const,
      player: atom.player,
      count: atom.count,
      effect,
      reshuffled: plan.reshuffled,
      ...(plan.reshuffled ? { newDeckCount: plan.newDeck!.length, newDiscardPileCount: 0 } : {}),
    };
    const ownerView: ViewEvent = { ...base, cards };
    const othersView: ViewEvent = { ...base };
    return {
      ownerViews: new Map([[atom.player, ownerView]]),
      othersView,
    };
  },
  applyView(view, event) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    const count = (event.count as number) ?? 0;
    view.players[pi].handCount += count;
    // owner 有 cards 字段，加入手牌；others 没有
    if (event.cards && view.players[pi].hand) {
      view.players[pi].hand.push(...(event.cards as Card[]));
    }
    // zone 同步
    if (view.zones) {
      if (event.reshuffled) {
        view.zones.deckCount =
          (event.newDeckCount as number) ?? Math.max(0, view.zones.deckCount - count);
        view.zones.discardPileCount = (event.newDiscardPileCount as number) ?? 0;
      } else {
        view.zones.deckCount = Math.max(0, view.zones.deckCount - count);
      }
    }
  },
  toViewLog(event, viewer) {
    const count = event.count ?? 0;
    // owner 视角:展示具体牌面(摸牌 ownerevent 带 cards 字段)
    const cards = event.cards as Array<{ name: string; suit?: string; rank?: string }> | undefined;
    const isOwner = event.player === viewer || (cards && cards.length > 0);
    if (isOwner && cards && cards.length > 0) {
      const cardNames = cards.map((c) => `${c.suit ?? ''}${c.rank ?? ''}${c.name}`).join('、');
      return { player: event.player as number, text: `摸了 ${count} 张牌：${cardNames}` };
    }
    return { player: event.player as number, text: `摸了 ${count} 张牌` };
  },
};

