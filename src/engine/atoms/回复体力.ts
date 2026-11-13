// src/engine/atoms/回复体力.ts
// 回复体力:target 玩家回复 amount 体力(不超过 maxHealth)
import type { AtomDefinition, GameView, ViewEventSplit, ViewEvent } from '../types';
import { broadcast, requirePlayer, viewPlayer } from './_helpers';

export const 回复体力: AtomDefinition<{ target: number; amount: number; source?: number }> = {
  type: '回复体力',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const err = requirePlayer(state, atom.target, 'target');
    if (err) return err;
    if (!state.players[atom.target].alive) return `target is dead`;
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
    return broadcast(view);
  },
  applyView(view: GameView, event) {
    const p = viewPlayer(view, event.target as number);
    if (!p) return;
    p.health = Math.min(p.maxHealth, p.health + (event.amount as number));
  },
  toViewLog(event) {
    return { player: event.target as number, text: `回复 ${event.amount ?? 0} 点体力` };
  },
};

