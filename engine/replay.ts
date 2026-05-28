import type { GameState, PublicGameState, TurnPhase, Card } from '../shared/types';
import type { GameLog, Operation } from '../shared/log';
import type { Rng } from '../shared/rng';
import { createRng } from '../shared/rng';
import { createGame, getPublicState, startGame } from './state';
import { 所有character as allCharacters } from '../shared/characters';

export class ReplayEngine {
  private log: GameLog;
  private currentStep = 0;
  private states: GameState[];

  private constructor(log: GameLog, states: GameState[]) {
    this.log = log;
    this.states = states;
  }

  static create(log: GameLog): ReplayEngine {
    const states = ReplayEngine.replayAll(log);
    return new ReplayEngine(log, states);
  }

  private static replayAll(log: GameLog): GameState[] {
    const states: GameState[] = [];
    const _rng = createRng(log.meta.seed);

    // Create initial state
    const characters = log.meta.characters.map(name =>
      allCharacters.find(c => c.name === name)!,
    );
    let state = createGame(characters, log.meta.seed);
    state = startGame(state);
    states.push(state);

    // Replay each operation
    for (const op of log.serverOps) {
      state = ReplayEngine.applyOperation(state, op, _rng);
      states.push(state);
    }

    return states;
  }

  private static applyOperation(state: GameState, op: Operation, _rng: Rng): GameState {
    switch (op.type) {
      case 'gameStart':
        // Game already created, return a copy to avoid shared references
        return { ...state };

      case 'phaseChange': {
        const data = op.data as { phase: string; player: string };
        return { ...state, phase: data.phase as TurnPhase };
      }

      case 'turnChange': {
        const data = op.data as { from: string; to: string; round: number };
        return { ...state, currentPlayer: data.to, round: data.round };
      }

      case 'draw': {
        const data = op.data as {
          player: string;
          cards: Array<{ name: string; suit: string; rank: string }>;
        };
        const drawnCards: Card[] = data.cards.map(c => ({
          name: c.name,
          type: '基本牌' as const,
          subtype: c.name as Card['subtype'],
          suit: c.suit as Card['suit'],
          rank: c.rank as Card['rank'],
          description: '',
        }));
        return {
          ...state,
          deck: state.deck.slice(data.cards.length),
          players: state.players.map(p =>
            p.name === data.player
              ? { ...p, hand: [...p.hand, ...drawnCards] }
              : p,
          ),
        };
      }

      case 'damage': {
        const data = op.data as { target: string; amount: number };
        return {
          ...state,
          players: state.players.map(p =>
            p.name === data.target
              ? { ...p, health: p.health - data.amount }
              : p,
          ),
        };
      }

      case 'heal': {
        const data = op.data as { player: string; amount: number };
        return {
          ...state,
          players: state.players.map(p =>
            p.name === data.player
              ? { ...p, health: Math.min(p.health + data.amount, p.maxHealth) }
              : p,
          ),
        };
      }

      case 'gameEnd': {
        const data = op.data as { winner: string };
        return {
          ...state,
          status: '已结束' as const,
          winner: data.winner as GameState['winner'],
        };
      }

      default:
        return state;
    }
  }

  getCurrentState(): GameState {
    return this.states[this.currentStep];
  }

  getCurrentStep(): number {
    return this.currentStep;
  }

  getTotalSteps(): number {
    return this.states.length;
  }

  next(): GameState {
    if (this.currentStep < this.states.length - 1) {
      this.currentStep++;
    }
    return this.states[this.currentStep];
  }

  prev(): GameState {
    if (this.currentStep > 0) {
      this.currentStep--;
    }
    return this.states[this.currentStep];
  }

  goTo(step: number): GameState {
    this.currentStep = Math.max(0, Math.min(step, this.states.length - 1));
    return this.states[this.currentStep];
  }

  getPlayerView(playerName: string): PublicGameState {
    return getPublicState(this.states[this.currentStep], playerName);
  }

  getCurrentOp(): Operation | null {
    if (this.currentStep === 0) return null;
    return this.log.serverOps[this.currentStep - 1] ?? null;
  }
}
