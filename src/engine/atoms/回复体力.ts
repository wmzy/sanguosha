// src/engine/atoms/回复体力.ts
// 回复体力:target 玩家回复 amount 体力(不超过 maxHealth)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 回复体力: AtomDefinition<{ target: number; amount: number; source?: number }> = {
  type: '回复体力',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const p = state.players[atom.target];
    if (!p) return `target ${atom.target} not found`;
    if (!p.alive) return `target is dead`;
    return null;
  },
  apply(state, atom) {
    const target = state.players[atom.target];
    target.health = Math.min(target.maxHealth, target.health + atom.amount);
  },
  effect: { sound: 'heal', particles: 'ice', duration: 300 },
};

registerAtom(回复体力);
