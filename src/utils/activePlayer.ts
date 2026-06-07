// src/utils/activePlayer.ts
import type { GameState } from '../../engine/types';

export function getSingleActivePlayer(state: GameState): string | null {
  const pending = state.pending;
  if (pending) {
    switch (pending.type) {
      case '响应窗口': {
        return pending.window.defender;
      }
      case '弃牌阶段': return pending.player;
      case '濒死窗口': return pending.savers[pending.currentSaverIndex];
      case '选择牌': return pending.player;
      case '收获选牌': return pending.pickOrder[pending.currentPickerIndex];
      case '技能选择': return pending.player;
      case '出牌阶段': return pending.player;
      default: return null;
    }
  }
  if (state.phase === '出牌') return state.currentPlayer;
  return null;
}
