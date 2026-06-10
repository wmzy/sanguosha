// src/server/session.ts
// 切到新 ENGINE-DESIGN:使用 createEngine() + ClientMessage 协议
// 不再用 createAsyncEngine / AsyncHookRegistry / 老 GameAction / 老 serverLog
import type {
  ActionLogEntry,
  ClientMessage as EngineClientMessage,
  GameState,
  GameView,
} from '../engine/types';
import { buildView } from '../engine/view/buildView';
import { createEngine, type EngineInstance } from '../engine/create-engine';
import '../engine/atoms';
import '../engine/skills';
import type { ServerMessage } from './protocol';
import { serialize } from './protocol';
import type { Room } from './room';
import type { Role } from '../shared/types';
import { createLogger } from './logger';
import { createRng } from '../shared/rng';
import { setRoomStatus } from './room';
import { saveRoom, deletePersistedRoom } from './persistence';

/**
 * 武将定义(简化版:名字 + 初始技能列表)
 * 新 ENGINE-DESIGN 技能由 src/engine/skills/<name>.ts 编译进模块。
 */
const CHARACTERS: Array<{ name: string; skills: string[] }> = [
  { name: '刘备', skills: ['仁德'] },
  { name: '曹操', skills: ['护甲'] },
  { name: '孙权', skills: ['制衡'] },
  { name: '关羽', skills: ['武圣'] },
  { name: '郭嘉', skills: ['遗计'] },
  { name: '主公', skills: [] },
];

function assignRoles(count: number): Role[] {
  if (count === 2) return ['主公', '反贼'];
  if (count === 3) return ['主公', '反贼', '内奸'];
  if (count === 4) return ['主公', '忠臣', '反贼', '反贼'];
  const roles: Role[] = ['主公', '忠臣', '内奸'];
  for (let i = 3; i < count; i++) roles.push('反贼');
  return roles;
}

const RECONNECT_GRACE_MS = 30_000;

export class GameSession {
  private engine: EngineInstance | null = null;
  private actionLog: ActionLogEntry[] = [];
  private state: GameState | null = null;
  private room: Room;
  private debug: boolean;
  private playerNames = new Map<string, string>();
  private disconnectedAt = new Map<string, number>();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivityAt = Date.now();
  private roomName: string;
  private maxPlayers: number;
  private destroyed = false;
  private logger = createLogger('session');
  private sessionSeed: number;

  constructor(room: Room, debug = false, sessionSeed?: number) {
    this.room = room;
    this.roomName = room.name;
    this.maxPlayers = room.maxPlayers;
    this.debug = debug;
    this.sessionSeed = sessionSeed ?? Date.now();
  }

  restoreState(state: GameState, actionLog: ActionLogEntry[] = []): void {
    this.state = state;
    this.actionLog = actionLog;
    this.playerNames.clear();
    this.lastActivityAt = Date.now();
    // 重启后,新 engine 重新实例化所有 skill
    this.engine = createEngine();
    this.engine.resetForTest();
    this.engine.bootstrap(state);
  }

  startGame(playerCount?: number): boolean {
    if (this.destroyed) return false;
    const count = this.debug ? (playerCount ?? this.room.players.size) : this.room.players.size;
    if (count < 2) return false;

    const seed = this.sessionSeed;
    const rng = createRng(seed);
    const shuffled = [...CHARACTERS];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    const selected = shuffled.slice(0, count);
    const roles = assignRoles(count);

    if (this.debug) {
      const playerId = this.room.players.keys().next().value;
      if (!playerId) return false;
      for (let i = 0; i < count; i++) {
        this.playerNames.set(`${playerId}:${selected[i].name}`, selected[i].name);
      }
    } else {
      const playerIds = [...this.room.players.keys()];
      for (let i = 0; i < playerIds.length; i++) {
        this.playerNames.set(playerIds[i], selected[i].name);
      }
    }

    const state: GameState = {
      players: selected.map((char, i) => ({
        index: i,
        name: char.name,
        character: char.name,
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: char.skills,
        vars: {},
        marks: [],
        pendingTricks: [],
      })),
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
      zones: { deck: [], discardPile: [], processing: [] },
      settlementStack: [],
      cardMap: {},
      rngSeed: seed,
      marks: [],
      localVars: {},
      meta: { gameId: this.room.id, createdAt: Date.now() },
      seq: 0,
      startedAt: 0,
      actionLog: [],
    };
    this.engine = createEngine();
    this.engine.resetForTest();
    this.engine.bootstrap(state);
    this.state = state;
    this.actionLog = [];
    this.lastActivityAt = Date.now();

    setRoomStatus(this.room.id, '进行中');
    this.sendInitialViewToAll();
    return true;
  }

  /**
   * 处理客户端 action(主动/回应都走这个接口)
   * 主动 action 压栈(由 engine 内部处理),回应 action 不压栈(由 engine settlement 内部处理)
   * CAS 校验:baseSeq 不匹配时静默丢弃
   */
  async handleAction(playerId: string, action: EngineClientMessage, baseSeq?: number): Promise<void> {
    if (this.destroyed) return;
    if (!this.state || !this.engine) return;

    if (baseSeq !== undefined && baseSeq !== this.state.seq) {
      this.logger.warn('CAS mismatch', { baseSeq, currentSeq: this.state.seq });
      return;
    }

    const expectedName = this.playerNames.get(playerId);
    if (!expectedName) return;
    if (action.ownerId !== expectedName) {
      this.logger.warn('ownerId mismatch', { actionOwner: action.ownerId, expected: expectedName });
      return;
    }

    try {
      const next = await this.engine.dispatch(this.state, action);
      this.state = next;
      this.actionLog.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now() - this.state.startedAt,
        message: action,
        baseSeq: this.state.seq,
      });
      this.lastActivityAt = Date.now();
      this.persistAsync();
      this.broadcastNewState();
      this.checkGameEnd();
    } catch (err) {
      this.logger.error('dispatch error', { err: String(err) });
      this.sendToPlayer(playerId, { type: 'error', message: '引擎内部错误' });
    }
  }

  private broadcastNewState(): void {
    if (!this.state) return;
    if (this.debug) {
      const playerId = this.room.players.keys().next().value;
      if (playerId) {
        const view = buildView(this.state, 0);
        this.sendToPlayer(playerId, { type: 'debugGameState', state: view, lastSeq: this.state.seq });
      }
      return;
    }
    for (const [playerId, playerName] of this.playerNames) {
      const playerIdx = this.state.players.findIndex(p => p.name === playerName);
      if (playerIdx < 0) continue;
      const view = buildView(this.state, playerIdx);
      this.sendToPlayer(playerId, { type: 'initialView', state: view, lastSeq: this.state.seq });
    }
  }

  private checkGameEnd(): void {
    if (!this.state) return;
    const aliveCount = this.state.players.filter(p => p.alive).length;
    if (aliveCount <= 1) {
      const winner = this.state.players.find(p => p.alive);
      setRoomStatus(this.room.id, '已结束');
      this.broadcast({ type: 'gameOver', winner: winner?.name ?? '无人' });
    }
  }

  private sendInitialViewToAll(): void {
    if (!this.state) return;
    this.broadcastNewState();
  }

  private sendDebugGameState(playerId: string, lastSeq?: number): void {
    if (!this.state) return;
    const view = buildView(this.state, 0);
    this.sendToPlayer(playerId, { type: 'debugGameState', state: view, lastSeq: lastSeq ?? this.state.seq });
  }

  handleDisconnect(playerId: string): void {
    if (this.debug) return;
    this.disconnectedAt.set(playerId, Date.now());
    if (this.graceTimer === null && this.allPlayersDisconnected()) {
      this.graceTimer = setTimeout(() => this.endDueToDisconnect(), RECONNECT_GRACE_MS);
    }
    this.broadcast({
      type: 'player_disconnected',
      playerId,
      graceMs: RECONNECT_GRACE_MS,
    });
  }

  private allPlayersDisconnected(): boolean {
    if (this.room.players.size === 0) return false;
    return this.disconnectedAt.size >= this.room.players.size;
  }

  private endDueToDisconnect(): void {
    this.graceTimer = null;
    const still = [...this.disconnectedAt.keys()];
    if (still.length === 0) return;
    const names = still.map(id => this.playerNames.get(id) ?? id).join('、');
    setRoomStatus(this.room.id, '已结束');
    this.broadcast({ type: 'error', message: `${names} 在重连宽限期内未恢复,游戏结束` });
    this.broadcast({ type: 'gameOver', winner: '无人' });
  }

  reconnectPlayer(playerId: string, ws: import('hono/ws').WSContext, _lastSeq = 0): boolean {
    if (!this.state) return false;
    this.disconnectedAt.delete(playerId);
    this.clearGraceTimer();
    this.room.players.set(playerId, ws);

    if (this.debug) {
      this.sendDebugGameState(playerId, this.state.seq);
    } else {
      const playerName = this.playerNames.get(playerId);
      if (playerName) {
        const playerIdx = this.state.players.findIndex(p => p.name === playerName);
        if (playerIdx >= 0) {
          const view = buildView(this.state, playerIdx);
          this.sendToPlayer(playerId, { type: 'initialView', state: view, lastSeq: this.state.seq });
        }
      }
    }
    this.broadcast({ type: 'player_reconnected', playerId });
    return true;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearGraceTimer();
    this.state = null;
    this.engine = null;
    await deletePersistedRoom(this.room.id);
  }

  getLastActivityAt(): number {
    return this.lastActivityAt;
  }

  getPlayerName(playerId: string): string | undefined {
    return this.playerNames.get(playerId);
  }

  getState(): GameState | null {
    return this.state;
  }

  getDebugView(): GameView | null {
    if (!this.state) return null;
    return buildView(this.state, 0);
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private persistAsync(): void {
    if (!this.state) return;
    void saveRoom(
      this.room.id,
      {
        roomName: this.roomName,
        maxPlayers: this.maxPlayers,
        hostId: this.room.hostId,
        debug: this.debug,
      },
      this.state,
      this.actionLog,
    );
  }

  private sendToPlayer(playerId: string, message: ServerMessage): void {
    const ws = this.room.players.get(playerId);
    if (!ws) return;
    try {
      ws.send(serialize(message));
    } catch (err) {
      this.logger.warn(`sendToPlayer failed for ${playerId}`, { error: String(err) });
    }
  }

  private broadcast(message: ServerMessage): void {
    const data = serialize(message);
    for (const [, ws] of this.room.players) {
      try {
        ws.send(data);
      } catch (err) {
        this.logger.warn('broadcast send failed', { error: String(err) });
      }
    }
  }
}
