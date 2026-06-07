import type { GameState, ServerEvent } from './types';
import type { Operation, GameLog } from '../shared/log';
import type { CharacterConfig, Role } from '../shared/types';
import { reduceGameState } from './view/reducer';
import { createInitialState } from './state';

export interface ReplayStep {
  state: GameState;
  serverOp: Operation | null;
  seq: number;
}

export class ReplayEngine {
  private steps: ReplayStep[] = [];
  private currentIdx = 0;
  private playerOps: Record<string, Operation[]>;

  constructor(
    private log: GameLog,
    private opts?: { characterMap?: Record<string, CharacterConfig> },
  ) {
    this.playerOps = log.playerOps;
    this.steps = this.buildSteps();
  }

  private buildSteps(): ReplayStep[] {
    const { meta, serverLog, serverOps } = this.log;
    const characterMap = this.opts?.characterMap;
    const players = meta.characters.map((name) => ({
      name,
      characterId: name,
      role: 'commoner' as Role,
    }));
    const initial = createInitialState({
      players,
      seed: meta.seed,
      characterMap: (characterMap ?? {}),
    });

    const steps: ReplayStep[] = [
      { state: initial, serverOp: null, seq: 0 },
    ];

    if (!serverLog || serverLog.length === 0) return steps;

    let state = initial;
    for (let i = 0; i < serverLog.length; i++) {
      const entry = serverLog[i];
      const event = entry as unknown as ServerEvent;
      state = reduceGameState(state, [event]);
      const serverOp = serverOps[i] ?? null;
      steps.push({ state, serverOp, seq: i + 1 });
    }

    return steps;
  }

  next(): ReplayStep {
    if (this.currentIdx < this.steps.length - 1) {
      this.currentIdx++;
    }
    return this.getCurrent();
  }

  prev(): ReplayStep {
    if (this.currentIdx > 0) {
      this.currentIdx--;
    }
    return this.getCurrent();
  }

  goTo(step: number): ReplayStep {
    const clamped = Math.max(0, Math.min(step, this.steps.length - 1));
    this.currentIdx = clamped;
    return this.getCurrent();
  }

  getCurrent(): ReplayStep {
    return this.steps[this.currentIdx];
  }

  getPlayerOps(playerName: string, upto?: number): Operation[] {
    const ops = this.playerOps[playerName];
    if (!ops) return [];
    const end = upto ?? this.currentIdx + 1;
    return ops.slice(0, end);
  }

  getTotalSteps(): number {
    return this.steps.length;
  }

  getCurrentIndex(): number {
    return this.currentIdx;
  }
}
