// src/utils/activePlayer.ts
import type { GameState } from '../../engine/types';

export function getSingleActivePlayer(state: GameState): string | null {
  const pending = state.pending;
  if (pending) {
    switch (pending.type) {
      case 'responseWindow': {
        return pending.window.defender;
      }
      case 'discardPhase': return pending.player;
      case 'dyingWindow': return pending.savers[pending.currentSaverIndex];
      case 'selectCard': return pending.player;
      case 'harvestSelection': return pending.pickOrder[pending.currentPickerIndex];
      case 'skillPrompt': return pending.player;
      case 'playPhase': return pending.player;
      default: return null;
    }
  }
  if (state.phase === '出牌') return state.currentPlayer;
  return null;
}
