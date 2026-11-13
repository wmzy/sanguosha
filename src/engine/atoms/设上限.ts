// src/engine/atoms/设上限.ts
// 设上限:设置玩家 maxHealth,clamp 当前 health 不超过新上限
import type { AtomDefinition, GameView } from '../types';
import { requirePlayer, viewPlayer } from './_helpers';

export const 设上限: AtomDefinition<{ player: number; amount: number }> = {
  type: '设上限',
  validate(state, atom) {
    // 允许 amount=0:体力上限降为0时角色直接死亡(由 设上限 after-hook 触发 runDeathFlow)。
    return requirePlayer(state, atom.player, 'player');
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    player.maxHealth = atom.amount;
    player.health = Math.min(player.health, atom.amount);
  },
  applyView(view: GameView, event) {
    const p = viewPlayer(view, event.player as number);
    if (!p) return;
    p.maxHealth = event.amount as number;
    p.health = Math.min(p.health, event.amount as number);
  },
};

