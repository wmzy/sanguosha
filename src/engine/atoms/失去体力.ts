// src/engine/atoms/失去体力.ts
// 失去体力:target 玩家失去 amount 体力(不进入濒死流程——纯事件)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 失去体力: AtomDefinition<{ target: string; amount: number }> = {
  type: '失去体力',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const p = state.players.find(x => x.name === atom.target);
    if (!p) return `target ${atom.target} not found`;
    if (!p.alive) return `target is dead`;
    return null;
  },
  apply(state, atom) {
    const tIdx = state.players.findIndex(p => p.name === atom.target);
    const target = state.players[tIdx];
    const newHealth = Math.max(0, target.health - atom.amount);
    target.health = newHealth;
    target.alive = newHealth > 0;
  },
  effect: { sound: 'lose_health', animation: 'shake', duration: 300 },
};

registerAtom(失去体力);
