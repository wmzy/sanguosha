// src/engine/view/buildView.ts
import type { GameState, GameView } from '../types';

export function buildView(state: GameState, viewer: number): GameView {
  return {
    viewer,
    currentPlayerIndex: state.currentPlayerIndex,
    phase: state.phase,
    turn: state.turn,
    players: state.players.map((p, i) => ({
      name: p.name,
      character: p.character,
      health: p.health,
      maxHealth: p.maxHealth,
      alive: p.alive,
      equipment: p.equipment,
      skills: p.skills,
      handCount: p.hand.length,
      hand: i === viewer ? p.hand.map(id => state.cardMap[id]).filter(Boolean) : undefined,
      marks: p.marks,
    })),
    cardMap: state.cardMap,
    pending: null,
  };
}