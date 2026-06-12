// @ts-nocheck
import type { GameState, Atom, Json } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: '设置变量',
    apply(state: GameState, atom: Atom & { type: '设置变量' }) {
      const player = atom.player as string;
      const { key } = atom;
      const value = atom.value as Json;
      return updatePlayer(state, player, p => ({
        vars: { ...p.vars, [key]: value },
      }));
    },
  });

  registerAtom({
    type: '增加变量',
    apply(state: GameState, atom: Atom & { type: '增加变量' }) {
      const player = atom.player as string;
      const { key } = atom;
      const delta = atom.delta as number;
      return updatePlayer(state, player, p => ({
        vars: { ...p.vars, [key]: ((p.vars[key] as number | undefined) ?? 0) + delta },
      }));
    },
  });

  registerAtom({
    type: '清空变量',
    apply(state: GameState, atom: Atom & { type: '清空变量' }) {
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
  });
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}
