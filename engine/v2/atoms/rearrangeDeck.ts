import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';

export function register() {
  registerAtom({
    type: 'rearrangeDeck',
    apply(state: GameState, atom: Atom & { type: 'rearrangeDeck' }): GameState {
      const player = atom.player as string;
      const topCardIds = atom.topCardIds as string[];
      const bottomCardIds = atom.bottomCardIds as string[];

      // 收集所有需要重排的牌
      const rearrangingSet = new Set([...topCardIds, ...bottomCardIds]);

      // 从牌堆中移除这些牌
      const remainingDeck = state.zones.deck.filter(id => !rearrangingSet.has(id));

      // 新牌堆：topCardIds（牌堆顶）+ 剩余牌 + bottomCardIds（牌堆底）
      const newDeck = [...topCardIds, ...remainingDeck, ...bottomCardIds];

      return { ...state, zones: { ...state.zones, deck: newDeck } };
    },
    toEvents(state: GameState, atom: Atom & { type: 'rearrangeDeck' }): AtomEventResult {
      const player = atom.player as string;
      const topCardIds = atom.topCardIds as string[];
      const bottomCardIds = atom.bottomCardIds as string[];

      // 服务端完整事件（包含牌的具体信息）
      const server = makeServerEvent('deckRearranged', {
        player,
        topCardIds,
        bottomCardIds,
      });

      // 发动者可以看到牌堆顶和牌堆底分别是什么牌
      const ownerEvent = makePlayerEvent('deckRearranged', {
        player,
        topCardIds,
        bottomCardIds,
      });

      // 其他玩家只知道牌堆被重排了，看不到具体牌
      const defaultEvent = makePlayerEvent('deckRearranged', {
        player,
        topCount: topCardIds.length,
        bottomCount: bottomCardIds.length,
      });

      return [server, new Map([[player, ownerEvent]]), defaultEvent];
    },
  });
}
