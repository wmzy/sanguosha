// src/engine/atoms/失去体力.ts
// 失去体力:target 玩家失去 amount 体力(不进入濒死流程——纯事件)
import type { AtomDefinition, GameView } from '../types';
import { registerAtom } from '../atom';

export const 失去体力: AtomDefinition<{ target: number; amount: number }> = {
  type: '失去体力',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const p = state.players[atom.target];
    if (!p) return `target ${atom.target} not found`;
    if (!p.alive) return `target is dead`;
    return null;
  },
  apply(state, atom) {
    const target = state.players[atom.target];
    const newHealth = Math.max(0, target.health - atom.amount);
    target.health = newHealth;
    target.alive = newHealth > 0;
  },
  effect: { sound: 'lose_health', animation: 'shake', duration: 800 },
  applyView(view: GameView, event) {
    const pi = view.players.findIndex(p => p.index === (event.target as number));
    if (pi < 0) return;
    const p = view.players[pi];
    p.health = Math.max(0, p.health - (event.amount as number));
  },
};

registerAtom(失去体力);
