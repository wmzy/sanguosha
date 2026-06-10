// src/engine/atoms/回复体力.ts
// 回复体力:target 玩家回复 amount 体力(不超过 maxHealth)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 回复体力: AtomDefinition<{ target: string; amount: number; source?: string }> = {
  type: '回复体力',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const p = state.players.find(x => x.name === atom.target);
    if (!p) return `target ${atom.target} not found`;
    if (!p.alive) return `target is dead`;
    return null;
  },
  apply(state, atom) {
    const tIdx = state.players.findIndex(p => p.name === atom.target);
    return {
      ...state,
      players: state.players.map((p, i) => {
        if (i !== tIdx) return p;
        const newHealth = Math.min(p.maxHealth, p.health + atom.amount);
        return { ...p, health: newHealth };
      }),
    };
  },
  effect: { sound: 'heal', particles: 'ice', duration: 300 },
};

registerAtom(回复体力);
