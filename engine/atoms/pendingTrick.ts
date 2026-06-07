import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';
import type { PendingTrick } from '../../shared/types';
import { asJson } from '../../shared/typeGuards';

export function register() {
  registerAtom({
    type: '添加延时锦囊',
    apply(state: GameState, atom: Atom & { type: '添加延时锦囊'; trick: PendingTrick }) {
      const player = atom.player as string;
      return updatePlayer(state, player, p => ({
        pendingTricks: [...p.pendingTricks, atom.trick],
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: '添加延时锦囊' }): AtomEventResult {
      const player = atom.player as string;
      const payload: Json = { player, trick: asJson(atom.trick) };
      const server = makeServerEvent('添加延时锦囊', payload);
      return [server, new Map(), makePlayerEvent('添加延时锦囊', payload)];
    },
  });

  registerAtom({
    type: '移除延时锦囊',
    apply(state: GameState, atom: Atom & { type: '移除延时锦囊'; index: number }) {
      const player = atom.player as string;
      return updatePlayer(state, player, p => ({
        pendingTricks: p.pendingTricks.filter((_, i) => i !== atom.index),
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: '移除延时锦囊' }): AtomEventResult {
      const player = atom.player as string;
      const payload: Json = { player, index: atom.index };
      const server = makeServerEvent('移除延时锦囊', payload);
      return [server, new Map(), makePlayerEvent('移除延时锦囊', payload)];
    },
  });
}
