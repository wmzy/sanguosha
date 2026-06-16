// src/engine/atoms/造成伤害.ts
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 造成伤害: AtomDefinition<{
  target: number; amount: number; source: number; cardId?: string;
}> = {
  type: '造成伤害',
  validate(state, atom) {
    if (atom.amount < 0) return 'amount must be >= 0';
    const target = state.players[atom.target];
    if (!target) return `target ${atom.target} not found`;
    if (!target.alive) return `target ${atom.target} is dead`;
    return null;
  },
  apply(state, atom) {
    const target = state.players[atom.target];
    const newHealth = Math.max(0, target.health - atom.amount);
    target.health = newHealth;
    // 注意:扣到 0 不直接设 alive=false——进入濒死流程(求桃),无人救才 击杀
    // alive 的清理由 击杀 atom 负责
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
    const pi = view.players.findIndex(p => p.index === (event.target as number));
    if (pi >= 0) {
      const p = view.players[pi];
      p.health = Math.max(0, p.health - (event.amount as number));
      // alive 由 击杀 atom 的 applyView 更新,这里不提前设
    }
  },
};

registerAtom(造成伤害);
