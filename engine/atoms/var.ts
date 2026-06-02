import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: 'setVar',
    apply(state: GameState, atom: Atom & { type: 'setVar' }) {
      const player = atom.player as string;
      const { key } = atom;
      const value = atom.value as Json;
      return updatePlayer(state, player, p => ({
        vars: { ...p.vars, [key]: value },
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: 'setVar' }): AtomEventResult {
      const player = atom.player as string;
      const { key } = atom;
      const value = atom.value as Json;
      const payload = { player, key, value };
      const server = makeServerEvent('setVar', payload);
      const ownerEvent = makePlayerEvent('setVar', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });

  registerAtom({
    type: 'incrementVar',
    apply(state: GameState, atom: Atom & { type: 'incrementVar' }) {
      const player = atom.player as string;
      const { key } = atom;
      const delta = atom.delta as number;
      return updatePlayer(state, player, p => ({
        vars: { ...p.vars, [key]: ((p.vars[key] as number | undefined) ?? 0) + delta },
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: 'incrementVar' }): AtomEventResult {
      const player = atom.player as string;
      const { key } = atom;
      const delta = atom.delta as number;
      const payload = { player, key, delta };
      const server = makeServerEvent('incrementVar', payload);
      const ownerEvent = makePlayerEvent('incrementVar', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });

  registerAtom({
    type: 'clearVarPattern',
    apply(state: GameState, atom: Atom & { type: 'clearVarPattern' }) {
      const player = atom.player as string;
      const { pattern } = atom;
      const regex = globToRegex(pattern);
      return updatePlayer(state, player, p => {
        const vars: Record<string, Json> = {};
        for (const [k, v] of Object.entries(p.vars)) {
          if (!regex.test(k)) vars[k] = v;
        }
        return { vars };
      });
    },
    toEvents(state: GameState, atom: Atom & { type: 'clearVarPattern' }): AtomEventResult {
      const player = atom.player as string;
      const payload = { player, pattern: atom.pattern };
      const server = makeServerEvent('clearVarPattern', payload);
      return [server, new Map(), null];
    },
  });
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}
