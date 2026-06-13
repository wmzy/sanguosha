// src/engine/atoms/造成伤害.ts
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
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
    target.health = newHealth;
    target.alive = newHealth > 0;
  },
  effect: { sound: 'damage_physical', animation: 'shake', particles: 'blood', duration: 400 },
  toViewEvents(_state, atom): ViewEventSplit {
    const effect = { sound: 'damage_physical' as const, animation: 'shake' as const, particles: 'blood' as const, duration: 400 };
    const view: ViewEvent = {
      type: '造成伤害',
      target: atom.target,
      amount: atom.amount,
      source: atom.source,
      effect,
    };
    return {
      ownerViews: new Map(),
      othersView: view,
    };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.name === event.target as string);
    if (pi >= 0) {
      const p = view.players[pi];
      p.health = Math.max(0, p.health - (event.amount as number));
      p.alive = p.health > 0;
    }
  },
};

registerAtom(造成伤害);
