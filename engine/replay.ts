import type { GameState, PublicGameState, TurnPhase, Card } from '../shared/types';
import type { GameLog, Operation } from '../shared/log';
import type { Rng } from '../shared/rng';
import { createRng } from '../shared/rng';
import { 创建游戏, 获取公开状态, 开始游戏 } from './state';
import { 所有角色 } from '../shared/characters';

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
      所有角色.find(c => c.name === name)!,
    );
    let state = 创建游戏(characters, log.meta.seed);
    state = 开始游戏(state);
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
        return { ...state, 当前阶段: data.phase as TurnPhase };
      }

      case 'turnChange': {
        const data = op.data as { from: string; to: string; round: number };
        return { ...state, 当前玩家: data.to, 回合数: data.round };
      }

      case 'draw': {
        const data = op.data as {
          player: string;
          cards: Array<{ name: string; 花色: string; 点数: string }>;
        };
        const drawnCards: Card[] = data.cards.map(c => ({
          name: c.name,
          类型: '基本牌' as const,
          子类型: c.name as Card['子类型'],
          花色: c.花色 as Card['花色'],
          点数: c.点数 as Card['点数'],
          描述: '',
        }));
        return {
          ...state,
          牌堆: state.牌堆.slice(data.cards.length),
          玩家列表: state.玩家列表.map(p =>
            p.name === data.player
              ? { ...p, 手牌: [...p.手牌, ...drawnCards] }
              : p,
          ),
        };
      }

      case 'damage': {
        const data = op.data as { target: string; amount: number };
        return {
          ...state,
          玩家列表: state.玩家列表.map(p =>
            p.name === data.target
              ? { ...p, 体力: p.体力 - data.amount }
              : p,
          ),
        };
      }

      case 'heal': {
        const data = op.data as { player: string; amount: number };
        return {
          ...state,
          玩家列表: state.玩家列表.map(p =>
            p.name === data.player
              ? { ...p, 体力: Math.min(p.体力 + data.amount, p.体力上限) }
              : p,
          ),
        };
      }

      case 'gameEnd': {
        const data = op.data as { winner: string };
        return {
          ...state,
          状态: '已结束' as const,
          获胜身份: data.winner as GameState['获胜身份'],
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
    return 获取公开状态(this.states[this.currentStep], playerName);
  }

  getCurrentOp(): Operation | null {
    if (this.currentStep === 0) return null;
    return this.log.serverOps[this.currentStep - 1] ?? null;
  }
}
