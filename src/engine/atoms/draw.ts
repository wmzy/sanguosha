import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom, applyAtoms } from '../atom';
import { registerAtomHook } from '../skill-hook';
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
    [{ type: '重洗' }],
    { skipHooks: true, skipPlayerEvents: true },
  ).state;
}

export function register() {
  // onBefore 钩子：当牌堆不足时在 toEvents 之前先 reshuffle。
  // 这样 serverLog 顺序为 [..., reshuffle, draw]（reshuffle 先于 draw）。
  // 直接 applyAtom 调用不走 onBefore，所以 draw.apply 内部仍保留 maybeReshuffle
  // 兜底（保持直接调用者也能正确洗牌）。
  registerAtomHook({
    atomType: '摸牌',
    onBefore: ({ state, atom }) => {
      const count = (atom as Atom & { type: '摸牌' }).count as number;
      if (state.zones.deck.length >= count) return undefined;
      if (state.zones.discardPile.length === 0) return undefined;
      return { state: maybeReshuffle(state, count) };
    },
  });

  registerAtom({
    type: '摸牌',
    // 直接 applyAtom 调用者：apply 内仍做 reshuffle 兜底（不走 onBefore 钩子）。
    apply(state: GameState, atom: Atom & { type: '摸牌' }): GameState {
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
    // toEvents 不再做 reshuffle：onBefore 钩子（或 apply 路径）已保证牌堆足够。
    // 避免 applyAtoms 一次入口触发两次 reshuffle（double RNG 推进）。
    toEvents(state: GameState, atom: Atom & { type: '摸牌' }): AtomEventResult {
      const player = atom.player as string;
      const count = atom.count as number;
      const drawn = state.zones.deck.slice(0, count);
      const actualCount = drawn.length;
      const server = makeServerEvent('摸牌', { player, count: actualCount, cards: drawn });
      const ownerEvent = makePlayerEvent('摸牌', { player, count: actualCount, cards: drawn });
      const defaultEvent = makePlayerEvent('摸牌', { player, count: actualCount });
      return [server, new Map([[player, ownerEvent]]), defaultEvent];
    },
  });
}
