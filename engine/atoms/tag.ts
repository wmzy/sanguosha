import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: 'addTag',
    apply(state: GameState, atom: Atom & { type: 'addTag' }) {
      const player = atom.player as string;
      const { tag } = atom;
      return updatePlayer(state, player, p => {
        if (p.tags.includes(tag)) return p;
        return { tags: [...p.tags, tag] };
      });
    },
    toEvents(state: GameState, atom: Atom & { type: 'addTag' }): AtomEventResult {
      const player = atom.player as string;
      const payload: Json = { player, tag: atom.tag };
      const server = makeServerEvent('addTag', payload);
      const ownerEvent = makePlayerEvent('addTag', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });

  registerAtom({
    type: 'removeTag',
    apply(state: GameState, atom: Atom & { type: 'removeTag' }) {
      const player = atom.player as string;
      const { tag } = atom;
      return updatePlayer(state, player, p => ({
        tags: p.tags.filter(t => t !== tag),
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: 'removeTag' }): AtomEventResult {
      const player = atom.player as string;
      const payload: Json = { player, tag: atom.tag };
      const server = makeServerEvent('removeTag', payload);
      const ownerEvent = makePlayerEvent('removeTag', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });
}
