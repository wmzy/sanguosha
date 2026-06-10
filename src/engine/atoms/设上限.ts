// src/engine/atoms/设上限.ts
// 设上限:设置玩家 maxHealth,clamp 当前 health 不超过新上限
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 设上限: AtomDefinition<{ player: string; amount: number }> = {
  type: '设上限',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const p = state.players.find(x => x.name === atom.player);
    if (!p) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const pIdx = state.players.findIndex(p => p.name === atom.player);
    return {
      ...state,
      players: state.players.map((p, i) => {
        if (i !== pIdx) return p;
        return { ...p, maxHealth: atom.amount, health: Math.min(p.health, atom.amount) };
      }),
    };
  },
};

registerAtom(设上限);
