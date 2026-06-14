// src/engine/atoms/设上限.ts
// 设上限:设置玩家 maxHealth,clamp 当前 health 不超过新上限
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 设上限: AtomDefinition<{ player: number; amount: number }> = {
  type: '设上限',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const p = state.players[atom.player];
    if (!p) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    player.maxHealth = atom.amount;
    player.health = Math.min(player.health, atom.amount);
  },
};

registerAtom(设上限);
