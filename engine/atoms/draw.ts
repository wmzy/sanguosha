import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom, applyAtoms } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

/**
 * 牌堆不足时调用 reshuffle atom 自动洗回弃牌堆。
 * 通过 applyAtoms 复用原子管线，确保 reshuffle 事件也会写入 serverLog（§4.7 修复）。
 * skipHooks/skipPlayerEvents 避免 reshuffle 触发技能钩子导致无限递归。
 */
function maybeReshuffle(state: GameState, needed: number): GameState {
  if (state.zones.deck.length >= needed) return state;
  if (state.zones.discardPile.length === 0) return state;
  return applyAtoms(
    state,
    [{ type: 'reshuffle' }],
    { skipHooks: true, skipPlayerEvents: true },
  ).state;
}

export function register() {
  registerAtom({
    type: 'draw',
    apply(state: GameState, atom: Atom & { type: 'draw' }): GameState {
      const player = atom.player as string;
      const count = atom.count as number;
      const s = maybeReshuffle(state, count);
      const drawn = s.zones.deck.slice(0, count);
      const remaining = s.zones.deck.slice(count);
      return updatePlayer(
        { ...s, zones: { ...s.zones, deck: remaining } },
        player,
        p => ({ hand: [...p.hand, ...drawn] }),
      );
    },
    toEvents(state: GameState, atom: Atom & { type: 'draw' }): AtomEventResult {
      const player = atom.player as string;
      const count = atom.count as number;
      const s = maybeReshuffle(state, count);
      const drawn = s.zones.deck.slice(0, count);
      const actualCount = drawn.length;
      const server = makeServerEvent('draw', { player, count: actualCount, cards: drawn });
      const ownerEvent = makePlayerEvent('draw', { player, count: actualCount, cards: drawn });
      const defaultEvent = makePlayerEvent('draw', { player, count: actualCount });
      return [server, new Map([[player, ownerEvent]]), defaultEvent];
    },
  });
}
