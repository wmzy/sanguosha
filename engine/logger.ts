import type { GameLog, Operation, OperationType } from '../shared/log';

export class GameLogger {
  private log: GameLog;
  private seq = 0;

  constructor(meta: GameLog['meta']) {
    this.log = {
      meta,
      serverOps: [],
      playerOps: {},
    };
  }

  logServerOp(type: OperationType, data: unknown, description: string): void {
    const op: Operation = {
      seq: this.seq++,
      timestamp: Date.now(),
      type,
      data,
      description,
    };
    this.log.serverOps.push(op);
  }

  logPlayerOp(playerName: string, type: OperationType, data: unknown, description: string): void {
    if (!this.log.playerOps[playerName]) {
      this.log.playerOps[playerName] = [];
    }
    const op: Operation = {
      seq: this.log.playerOps[playerName].length,
      timestamp: Date.now(),
      type,
      data,
      description,
    };
    this.log.playerOps[playerName].push(op);
  }

  export(): GameLog {
    return this.log;
  }

  static import(data: unknown): GameLog {
    const parsed = data as Record<string, unknown>;
    if (!parsed.meta || !parsed.serverOps || !parsed.playerOps) {
      throw new Error('Invalid game log format');
    }
    return data as GameLog;
  }
}
