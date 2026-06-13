// src/server/session.ts
// Session 只负责网络/持久化,游戏逻辑由引擎管理(顶层函数 + state: GameState)
import type {
  ActionLogEntry,
  ClientMessage as EngineClientMessage,
  GameState,
  GameView,
} from '../engine/types';
import { create, bootstrap, dispatch, buildView, resetForTest, rebootstrap, type GameConfig } from '../engine/create-engine';

import '../engine/atoms';
import '../engine/skills';
import type { ServerMessage } from './protocol';
import { serialize } from './protocol';
import type { Room } from './room';
import { createLogger } from './logger';
import { setRoomStatus } from './room';
import { saveRoom, deletePersistedRoom } from './persistence';

/** 默认武将列表 */
const CHARACTERS: Array<{ name: string; skills: string[] }> = [
  { name: '刘备', skills: ['仁德'] },
  { name: '曹操', skills: ['护甲'] },
  { name: '孙权', skills: ['制衡'] },
  { name: '关羽', skills: ['武圣'] },
  { name: '郭嘉', skills: ['遗计'] },
  { name: '主公', skills: [] },
];

const RECONNECT_GRACE_MS = 30_000;
const IDLE_TIMEOUT_MS = 50_000;

export class GameSession {
  private state: GameState | null = null;
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
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionSeed: number;
  private logger = createLogger('session');

  constructor(room: Room, debug = false, sessionSeed?: number) {
    this.room = room;
    this.roomName = room.name;
    this.maxPlayers = room.maxPlayers;
    this.debug = debug;
    this.sessionSeed = sessionSeed ?? Date.now();
  }

  /** 用持久化恢复的 state 接管(由 app.ts 从 actionLog replay 出来后传入) */
  async restoreState(state: GameState, actionLog: ActionLogEntry[] = []): Promise<void> {
    this.actionLog = actionLog;
    this.lastActivityAt = Date.now();
    this.state = state;
    // 通过 skillLoaders 动态加载并注册所有 skill 实例
    await rebootstrap(state);
  }

  async startGame(playerCount?: number): Promise<boolean> {
    if (this.destroyed) return false;
    const count = this.debug ? (playerCount ?? this.room.players.size) : this.room.players.size;
    if (count < 2) return false;

    // 清空模块级状态(技能实例 + 事件流)以避免历史注册污染
    resetForTest();

    // 调用 create + bootstrap 建好完整可玩 state:抽身份 + 选将 + 洗牌 + 发牌 + 启动第一回合
    const config: GameConfig = {
      characters: CHARACTERS,
      playerCount: count,
      seed: this.sessionSeed,
      gameId: this.room.id,
    };
    this.state = create(config);
    await bootstrap(this.state);

    // 建立 playerId → playerName 映射
    const state = this.state;
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

    // 检查游戏是否开局时已结束(3 人场开不了,直接结束)
    if (state.players.filter(p => p.alive).length <= 1) {
      this.handleGameOver(undefined);
    }

    this.actionLog = state.actionLog;
    this.lastActivityAt = Date.now();

    setRoomStatus(this.room.id, '进行中');
    this.sendInitialViewToAll();
    this.resetIdleTimer();
    return true;
  }

  async handleAction(playerId: string, action: EngineClientMessage): Promise<void> {
    if (this.destroyed || !this.state) return;
    // debug 模式:允许以任意角色名发 action
    // 非 debug 模式:校验 ownerId 必须匹配预期玩家
    const expectedName = this.playerNames.get(playerId);
    if (!expectedName && !this.debug) return;
    if (!this.debug && action.ownerId !== expectedName) {
      this.logger.warn('ownerId mismatch', { actionOwner: action.ownerId, expected: expectedName });
      return;
    }
    // CAS 校验:baseSeq 不匹配则静默丢弃
    const curState = this.state;
    if (action.baseSeq !== undefined && action.baseSeq !== curState.seq) {
      return;
    }

    const result = await dispatch(this.state, action);
    if (result.error) {
      this.sendToPlayer(playerId, { type: 'error', message: result.error });
      return;
    }

    // 记录 actionLog(从引擎获取)
    this.actionLog = this.state.actionLog;
    this.lastActivityAt = Date.now();
    this.persistAsync();
    this.broadcastNewState();


    // 检查游戏结束
    if (result.gameOver) {
      this.handleGameOver(result.winner);
    }
    this.resetIdleTimer();
  }

  private handleGameOver(winner?: string): void {
    setRoomStatus(this.room.id, '已结束');
    this.broadcast({ type: 'gameOver', winner: winner ?? '无人' });
  }


  private broadcastNewState(): void {
    if (!this.state) return;
    if (this.debug) {
      // debug 模式:发给房间内所有连接的玩家(支持重连后新 playerId)
      const view = buildView(this.state, 0);
      const state = this.state;
      for (const [pid] of this.room.players) {
        this.sendToPlayer(pid, { type: 'debugGameState', state: view, lastSeq: state.seq });
      }
      return;
    }
    const state = this.state;
    for (const [playerId, playerName] of this.playerNames) {
      const playerIdx = state.players.findIndex(p => p.name === playerName);
      if (playerIdx < 0) continue;
      const view = buildView(state, playerIdx);
      this.sendToPlayer(playerId, { type: 'initialView', state: view, lastSeq: state.seq });
    }
  }

  private sendInitialViewToAll(): void {
    if (!this.state) return;
    this.broadcastNewState();
  }

  private sendDebugGameState(playerId: string, lastSeq?: number): void {
    if (!this.state) return;
    const view = buildView(this.state, 0);
    const state = this.state;
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
    if (!this.state) return false;
    this.disconnectedAt.delete(playerId);
    this.clearGraceTimer();
    this.room.players.set(playerId, ws);

    if (this.debug) {
      const state = this.state;
      this.sendDebugGameState(playerId, state.seq);
    } else {
      const playerName = this.playerNames.get(playerId);
      if (playerName) {
        const state = this.state;
        const playerIdx = state.players.findIndex(p => p.name === playerName);
        if (playerIdx >= 0) {
          const view = buildView(state, playerIdx);
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
    this.clearIdleTimer();
    this.clearGraceTimer();
    this.state = null;
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

  /** 重置空闲超时定时器(在每次 action 和 startGame 后调用) */
  private resetIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    if (!this.state) return;
    const state = this.state;
    // 只在游戏进行中且有当前玩家时启动定时器
    if (state.players.some(p => !p.alive) || state.pendingSlot) return;
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer?.alive) return;
    this.idleTimer = setTimeout(async () => {
      if (this.destroyed || !this.state) return;
      this.logger.info('idle timeout, auto-ending turn', { player: currentPlayer.name });
      const seq = this.state.seq;
      await dispatch(this.state, {
        skillId: '回合管理',
        actionType: 'end',
        ownerId: currentPlayer.name,
        params: {},
        baseSeq: seq,
      });
      this.broadcastNewState();
      this.persistAsync();
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
  private persistAsync(): void {
    if (!this.state) return;
    const state = this.state;
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
