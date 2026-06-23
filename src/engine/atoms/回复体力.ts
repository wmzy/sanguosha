// src/engine/atoms/回复体力.ts
// 回复体力:target 玩家回复 amount 体力(不超过 maxHealth)
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';
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
  effect: { sound: 'heal', particles: 'ice', duration: 800 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '回复体力',
      target: atom.target,
      amount: atom.amount,

    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view: GameView, event) {
    const pi = view.players.findIndex(p => p.index === (event.target as number));
    if (pi < 0) return;
    const p = view.players[pi];
    p.health = Math.min(p.maxHealth, p.health + (event.amount as number));
  },
  toViewLog(event) {
    return { player: event.target as number, text: `回复 ${event.amount ?? 0} 点体力` };
  },
};

registerAtom(回复体力);
