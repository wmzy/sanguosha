// src/server/session.ts
// Session 只负责网络/持久化,游戏逻辑由引擎管理
import type {
  ActionLogEntry,
  ClientMessage as EngineClientMessage,
  GameState,
  GameView,
} from '../engine/types';
import { createEngine, type EngineInstance } from '../engine/create-engine';
import { createInitialState, type GameSetupConfig } from '../engine/game-setup';
import '../engine/atoms';
import '../engine/skills';
import type { ServerMessage } from './protocol';
import { serialize } from './protocol';
import type { Room } from './room';
import { createLogger } from './logger';
import { setRoomStatus } from './room';
import { saveRoom, deletePersistedRoom } from './persistence';

/** 默认角色列表 */
const CHARACTERS: GameSetupConfig['characters'] = [
  { name: '刘备', skills: ['仁德'] },
  { name: '曹操', skills: ['护甲'] },
  { name: '孙权', skills: ['制衡'] },
  { name: '关羽', skills: ['武圣'] },
  { name: '郭嘉', skills: ['遗计'] },
  { name: '主公', skills: [] },
];

const RECONNECT_GRACE_MS = 30_000;

export class GameSession {
  private engine: EngineInstance | null = null;
  private actionLog: ActionLogEntry[] = [];
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
    this.actionLog = actionLog;
    this.lastActivityAt = Date.now();
    this.engine = createEngine();
    this.engine.resetForTest();
    this.engine.bootstrap(state);
  }

  async startGame(playerCount?: number): Promise<boolean> {
    if (this.destroyed) return false;
    const count = this.debug ? (playerCount ?? this.room.players.size) : this.room.players.size;
    if (count < 2) return false;

    // 引擎创建初始状态(抽角色、洗牌、发牌)
    const state = createInitialState({
      characters: CHARACTERS,
      playerCount: count,
      seed: this.sessionSeed,
      gameId: this.room.id,
    });

    // 建立 playerId → playerName 映射
    if (this.debug) {
      const playerId = this.room.players.keys().next().value;
      if (!playerId) return false;
      for (const player of state.players) {
        this.playerNames.set(`${playerId}:${player.name}`, player.name);
      }
      this.playerNames.set(playerId, state.players[0].name);
    } else {
      const playerIds = [...this.room.players.keys()];
      for (let i = 0; i < playerIds.length && i < state.players.length; i++) {
        this.playerNames.set(playerIds[i], state.players[i].name);
      }
    }

    // bootstrap 引擎
    this.engine = createEngine();
    this.engine.resetForTest();
    this.engine.bootstrap(state);

    // 启动第一回合
    const firstPlayer = state.players[0];
    if (firstPlayer) {
      const result = await this.engine.dispatch({
        skillId: '回合管理',
        actionType: 'start',
        ownerId: firstPlayer.name,
        params: {},
        baseSeq: 0,
      });
      if (result.gameOver) {
        this.handleGameOver(result.winner);
      }
    }

    this.actionLog = [];
    this.lastActivityAt = Date.now();

    setRoomStatus(this.room.id, '进行中');
    this.sendInitialViewToAll();
    return true;
  }

  async handleAction(playerId: string, action: EngineClientMessage): Promise<void> {
    if (this.destroyed || !this.engine) return;
    // debug 模式:允许以任意角色名发 action
    // 非 debug 模式:校验 ownerId 必须匹配预期玩家
    const expectedName = this.playerNames.get(playerId);
    if (!expectedName && !this.debug) return;
    if (!this.debug && action.ownerId !== expectedName) {
      this.logger.warn('ownerId mismatch', { actionOwner: action.ownerId, expected: expectedName });
      return;
    }

    const result = await this.engine.dispatch(action);
    if (result.error) {
      this.sendToPlayer(playerId, { type: 'error', message: result.error });
      return;
    }

    // 记录 actionLog(从引擎获取)
    const state = this.engine.getState();
    this.actionLog = state.actionLog;
    this.lastActivityAt = Date.now();
    this.persistAsync();
    this.broadcastNewState();


    // 检查游戏结束
    if (result.gameOver) {
      this.handleGameOver(result.winner);
    }
  }

  private handleGameOver(winner?: string): void {
    setRoomStatus(this.room.id, '已结束');
    this.broadcast({ type: 'gameOver', winner: winner ?? '无人' });
  }


  private broadcastNewState(): void {
    if (!this.engine) return;
    if (this.debug) {
      // debug 模式:发给房间内所有连接的玩家(支持重连后新 playerId)
      const view = this.engine.buildView(0);
      const state = this.engine.getState();
      for (const [pid] of this.room.players) {
        this.sendToPlayer(pid, { type: 'debugGameState', state: view, lastSeq: state.seq });
      }
      return;
    }
    const state = this.engine.getState();
    for (const [playerId, playerName] of this.playerNames) {
      const playerIdx = state.players.findIndex(p => p.name === playerName);
      if (playerIdx < 0) continue;
      const view = this.engine.buildView(playerIdx);
      this.sendToPlayer(playerId, { type: 'initialView', state: view, lastSeq: state.seq });
    }
  }

  private sendInitialViewToAll(): void {
    if (!this.engine) return;
    this.broadcastNewState();
  }

  private sendDebugGameState(playerId: string, lastSeq?: number): void {
    if (!this.engine) return;
    const view = this.engine.buildView(0);
    const state = this.engine.getState();
    this.sendToPlayer(playerId, { type: 'debugGameState', state: view, lastSeq: lastSeq ?? state.seq });
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
    if (!this.engine) return false;
    this.disconnectedAt.delete(playerId);
    this.clearGraceTimer();
    this.room.players.set(playerId, ws);

    if (this.debug) {
      const state = this.engine.getState();
      this.sendDebugGameState(playerId, state.seq);
    } else {
      const playerName = this.playerNames.get(playerId);
      if (playerName) {
        const state = this.engine.getState();
        const playerIdx = state.players.findIndex(p => p.name === playerName);
        if (playerIdx >= 0) {
          const view = this.engine.buildView(playerIdx);
          this.sendToPlayer(playerId, { type: 'initialView', state: view, lastSeq: state.seq });
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
    return this.engine?.getState() ?? null;
  }

  getDebugView(): GameView | null {
    if (!this.engine) return null;
    return this.engine.buildView(0);
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private persistAsync(): void {
    if (!this.engine) return;
    const state = this.engine.getState();
    void saveRoom(
      this.room.id,
      {
        roomName: this.roomName,
        maxPlayers: this.maxPlayers,
        hostId: this.room.hostId,
        debug: this.debug,
      },
      state,
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
