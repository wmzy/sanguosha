import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: '设上限',
    apply(state: GameState, atom: Atom & { type: '设上限' }): GameState {
      const player = atom.player as string;
      const delta = atom.delta as number;
      return updatePlayer(state, player, p => {
        const newMax = p.maxHealth + delta;
        // 体力上限不能低于1
        const clampedMax = Math.max(1, newMax);
        // 当前体力不超过新的体力上限
        const newHealth = Math.min(p.health, clampedMax);
        return { maxHealth: clampedMax, health: newHealth };
      });
    },
    toEvents(state: GameState, atom: Atom & { type: '设上限' }): AtomEventResult {
      const player = atom.player as string;
      const delta = atom.delta as number;
      const payload: Json = { player, delta };
      const server = makeServerEvent('设上限', payload);
      const ownerEvent = makePlayerEvent('设上限', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });
}
