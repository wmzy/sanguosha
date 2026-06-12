// @ts-nocheck
import type { GameState, Atom, DamageType } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';

/** damage type 默认值：所有未显式指定的 damage 视为 normal */
const DEFAULT_DAMAGE_TYPE: DamageType = 'normal';

export function register() {
  registerAtom({
    type: '造成伤害',
    apply(state: GameState, atom: Atom & { type: '造成伤害' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      return updatePlayer(state, target, p => ({
        health: p.health - amount,
      }));
    },
  });
}
