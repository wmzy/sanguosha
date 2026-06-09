// src/engine/atoms/造成伤害.ts
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 造成伤害: AtomDefinition<{
  target: string; amount: number; source: string; cardId?: string;
}> = {
  type: '造成伤害',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const target = state.players.find(p => p.name === atom.target);
    if (!target) return `target ${atom.target} not found`;
    if (!target.alive) return `target ${atom.target} is dead`;
    return null;
  },
  apply(state, atom) {
    const targetIdx = state.players.findIndex(p => p.name === atom.target);
    const target = state.players[targetIdx];
    const newHealth = Math.max(0, target.health - atom.amount);
    return {
      ...state,
      players: state.players.map((p, i) =>
        i === targetIdx ? { ...p, health: newHealth, alive: newHealth > 0 } : p,
      ),
    };
  },
  effect: { sound: 'damage_physical', animation: 'shake', particles: 'blood', duration: 400 },
};

registerAtom(造成伤害);