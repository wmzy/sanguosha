import type { GameAction, GameState, ServerEvent } from '../engine/types';
import type { SequencedEvent, EventSeq, ServerMessage } from './protocol';
import type { Room } from './room';
import { createInitialState } from '../engine/state';
import { createEngine } from '../engine/create-engine';
import type { EngineInstance } from '../engine/create-engine';
import { createAsyncEngine, type AsyncEngineInstance } from '../engine/async-engine';
import { AsyncHookRegistry } from '../engine/async-hook';
import { allSkills } from '../engine/skills';
import { serialize as serializeState, deserialize as deserializeState } from '../engine/serializer';
import { saveRoom, deletePersistedRoom } from './persistence';
import { registerCharacterTriggers } from '../engine/skill';
import { allCharacters } from '../engine/characters';
import { serialize } from './protocol';
import { setRoomStatus } from './room';
import type { Role } from '../shared/types';
import { createLogger } from './logger';
import { createRng } from '../shared/rng';
import { buildPlayerView } from '../engine/view/buildView';
import type { FrontendState } from '../engine/view/types';
import { GameLogger } from '../engine/logger';
import type { GameLog, Operation } from '../shared/log';

const characterMap = Object.fromEntries(allCharacters.map(c => [c.name, c]));

function assignRoles(count: number): Role[] {
  if (count === 2) return ['主公', '反贼'];
  if (count === 3) return ['主公', '反贼', '内奸'];
  if (count === 4) return ['主公', '忠臣', '反贼', '反贼'];
  const roles: Role[] = ['主公', '忠臣', '内奸'];
  for (let i = 3; i < count; i++) roles.push('反贼');
  return roles;
}

/** 从 GameState 构造某玩家视角的初始 FrontendState。 */
function buildInitialState(state: GameState, myPlayerId: string): FrontendState {
  return {
    view: buildPlayerView(state, myPlayerId),
    myPlayerId,
    animationQueue: [],
  };
}

/** 玩家断线后等待重连的宽限期（毫秒）。超时则结束游戏。 */
const RECONNECT_GRACE_MS = 30_000;

export class GameSession {
  private gameEngine: EngineInstance | null = null;
  private asyncEngine: AsyncEngineInstance | null = null;
  private actionLog: GameAction[] = [];
  private room: Room;
  private debug: boolean;
  private playerNames = new Map<string, string>();
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectedAt = new Map<string, number>();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private logger = createLogger('session');
  private sessionSeed: number;
  private lastActivityAt = Date.now();
  private roomName: string;
  private maxPlayers: number;
  private destroyed = false;
  /**
   * 协议层事件序号：与 state.serverLog 同步累加（初始 = serverLog.length）。
   * 重启从持久化的 serverLog 恢复，保证新事件 seq 不会与已持久化事件冲突。
   */
  private nextSeq = 0;
  private gameLogger: GameLogger | null = null;
  pendingPlayerCount?: number;

  constructor(room: Room, debug = false, sessionSeed?: number) {
    this.room = room;
    this.roomName = room.name;
    this.maxPlayers = room.maxPlayers;
    this.debug = debug;
    this.sessionSeed = sessionSeed ?? Date.now();
  }

  restoreState(state: GameState, actionLog?: GameAction[]): void {
    this.state = state;
    this.actionLog = actionLog ?? [];
    this.playerNames.clear();
    this.lastActivityAt = Date.now();
    this.nextSeq = state.serverLog?.length ?? 0;
    if (this.actionLog.length > 0 && state.serverLog?.length) {
      this.gameLogger = new GameLogger(
        { version: '1.0', createdAt: Date.now(), playerCount: state.playerOrder.length, characters: state.playerOrder, seed: 0 },
        state.playerOrder,
      );
      this.gameLogger.rebuildFromLog(state, state.serverLog);
    }
    this.scheduleTimeout();
  }

  startGame(playerCount?: number): boolean {
    if (this.destroyed) return false;
    const count = this.debug ? (playerCount ?? this.room.players.size) : this.room.players.size;
    if (!this.debug && count < 2) return false;
    if (this.debug && count < 2) return false;

    const seed = this.sessionSeed;
    const rng = createRng(seed);
    const shuffled = [...allCharacters];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    const selected = shuffled.slice(0, count);
    const roles = assignRoles(count);

    if (this.debug) {
      // 调试模式：只有 1 个 WS 连接，为所有虚拟玩家建立映射
      const playerId = this.room.players.keys().next().value!;
      for (let i = 0; i < count; i++) {
        this.playerNames.set(`${playerId}:${selected[i].name}`, selected[i].name);
      }
    } else {
      const playerIds = [...this.room.players.keys()];
      for (let i = 0; i < playerIds.length; i++) {
        this.playerNames.set(playerIds[i], selected[i].name);
      }
    }

    const players = selected.map((char, i) => ({
      name: char.name,
      characterId: char.name,
      role: roles[i],
    }));

    let state = createInitialState({
      players,
      seed,
      characterMap,
    });
    for (const playerName of state.playerOrder) {
      state = registerCharacterTriggers(state, playerName, { characterMap });
    }

    this.gameEngine = createEngine({ skills: allSkills });
    const startResult = this.gameEngine.dispatch(state, { type: '开始' });
    state = startResult.state;

    // P5-T2 / ADR 0025：创建 AsyncHook 引擎。当前 PoC 阶段 AsyncHookRegistry 留空，
    // 由 future 迁移 / 配置注入。session.handleAction 会优先把 action 路由到 asyncEngine。
    this.asyncEngine = createAsyncEngine({ asyncHooks: new AsyncHookRegistry() });
    this.state = state;
    this.actionLog = [{ type: '开始' }];
    this.nextSeq = state.serverLog?.length ?? 0;
    this.gameLogger = new GameLogger(
      {
        version: '1.0',
        createdAt: Date.now(),
        playerCount: count,
        characters: selected.map(c => c.name),
        seed,
      },
      state.playerOrder,
    );
    this.touchAndPersist();
    this.gameLogger.recordBatch({ type: '开始' }, [], this.state);

    setRoomStatus(this.room.id, '进行中');
    this.sendInitialViewToAll();
    return true;
  }

  handleAction(playerId: string, action: GameAction, baseSeq?: EventSeq): void {
    if (this.destroyed) return;
    if (!this.state) return;

    // CAS 校验：客户端操作的 baseSeq 必须等于服务端当前 nextSeq。
    // 不匹配说明客户端基于过期快照操作，静默丢弃——前端会通过后续
    // events 推送自动看到最新状态，旧操作自然"消失"。详见 ADR 0009。
    if (baseSeq !== undefined && baseSeq !== this.nextSeq) {
      this.logger.warn('CAS mismatch', { baseSeq, currentSeq: this.nextSeq });
      return;
    }

    let fullAction: GameAction;
    if (this.debug) {
      fullAction = action;
    } else {
      const playerName = this.playerNames.get(playerId);
      if (!playerName) return;
      fullAction = { ...action, player: playerName } as GameAction;
    }

    if (this.state.meta.status === '已结束') return;

    const result = this.gameEngine!.dispatch(this.state, fullAction);
    if (result.error) {
      this.sendToPlayer(playerId, { type: 'error', message: result.error });
      return;
    }

    this.appendAction(fullAction);
    this.state = result.state;
    this.touchAndPersist();

    this.broadcastEvents(result.events, fullAction);
    this.checkGameEnd();
  }

  /**
   * 处理 '异步钩子响应' action：路由到 asyncEngine.dispatchAsync。
   * fire-and-forget 模式：返回 void 即可，结果通过 WS 推送。
   */
  handleAsyncHookResponse(playerId: string, action: GameAction, baseSeq?: EventSeq): void {
    if (this.destroyed) return;
    if (!this.state) return;
    if (!this.asyncEngine) return;
    if (baseSeq !== undefined && baseSeq !== this.nextSeq) {
      this.logger.warn('CAS mismatch (async hook)', { baseSeq, currentSeq: this.nextSeq });
      return;
    }
    let fullAction: GameAction;
    if (this.debug) {
      fullAction = action;
    } else {
      const playerName = this.playerNames.get(playerId);
      if (!playerName) return;
      fullAction = { ...action, player: playerName } as GameAction;
    }
    if (this.state.meta.status === '已结束') return;

    // fire-and-forget：dispatchAsync 内部走恢复路径
    void this.asyncEngine.dispatchAsync(this.state, fullAction).then((result) => {
      if (result.error) {
        this.sendToPlayer(playerId, { type: 'error', message: result.error });
        return;
      }
      this.appendAction(fullAction);
      this.state = result.state;
      this.touchAndPersist();
      this.broadcastEvents(result.events, fullAction);
      this.checkGameEnd();
    }).catch((err) => {
      this.logger.error('async hook dispatch error', { err });
    });
  }

  private broadcastEvents(events: ServerEvent[], action?: GameAction | null): void {
    if (events.length === 0) return;

    const sequenced: SequencedEvent[] = events.map((ev) => ({
      id: ev.id,
      type: ev.type,
      timestamp: ev.timestamp,
      payload: ev.payload,
      seq: ++this.nextSeq,
    }));
    const fromSeq = sequenced[0].seq;

    const batchResult = this.gameLogger?.recordBatch(action ?? null, events, this.state!) ?? { serverOps: [] as Operation[], playerOps: {} };

    if (this.debug) {
      const eventMsg: ServerMessage = {
        type: 'events',
        fromSeq,
        events: sequenced,
        operations: batchResult.serverOps,
      };
      const realPlayerId = this.room.players.keys().next().value;
      if (realPlayerId) this.sendToPlayer(realPlayerId, eventMsg);
      return;
    }

    for (const [pid, playerName] of this.playerNames) {
      const playerMsg: ServerMessage = {
        type: 'events',
        fromSeq,
        events: sequenced,
        operations: batchResult.playerOps[playerName] ?? [],
      };
      this.sendToPlayer(pid, playerMsg);
    }

    this.broadcastAsyncHookPendingIfAny();
  }

  /**
   * 如果 state.pending 是 PendingAsyncHook，给对应玩家推送 asyncHookPending 消息。
   */
  private broadcastAsyncHookPendingIfAny(): void {
    const pending = this.state?.pending;
    if (!pending || pending.type !== '异步钩子挂起') return;
    const msg: ServerMessage = {
      type: 'asyncHookPending',
      pendingId: pending.id,
      hookId: pending.hookId,
      player: pending.self,
      def: pending.def,
      timeout: pending.timeout,
      deadline: pending.deadline,
    };
    // 找 self 玩家的 pid
    if (this.debug) {
      const realPlayerId = this.room.players.keys().next().value;
      if (realPlayerId) this.sendToPlayer(realPlayerId, msg);
      return;
    }
    for (const [pid, playerName] of this.playerNames) {
      if (playerName === pending.self) {
        this.sendToPlayer(pid, msg);
        break;
      }
    }
  }

  /**
   * 给所有玩家发送完整初始 FrontendState（一次性快照）。
   * 之后的状态变化通过 events 消息发送，客户端用 reducer 维护本地 state。
   */
  private sendInitialViewToAll(): void {
    if (!this.state) return;
    if (this.debug) {
      const playerId = this.room.players.keys().next().value;
      if (playerId) {
        this.sendToPlayer(playerId, { type: 'debugGameState', state: this.state, lastSeq: this.nextSeq });
      }
      return;
    }
    for (const [playerId, playerName] of this.playerNames) {
      const feState = buildInitialState(this.state, playerName);
      this.sendToPlayer(playerId, { type: 'initialView', state: feState, lastSeq: this.nextSeq });
    }
  }

  /**
   * 断点续传：从 serverLog[lastSeq..] 取所有未应用事件，组装成 events 消息下发。
   */
  private sendEventsSince(playerId: string, lastSeq: number): void {
    if (!this.state) return;
    const log = this.state.serverLog;
    const startIdx = Math.max(0, Math.min(lastSeq, log.length));
    if (startIdx >= log.length) {
      this.sendToPlayer(playerId, { type: 'events', fromSeq: lastSeq, events: [], operations: [] });
      return;
    }
    const missed = log.slice(startIdx);
    if (missed.length === 0) return;
    const sequenced: SequencedEvent[] = missed.map((ev, i) => ({
      id: ev.id,
      type: ev.type,
      timestamp: ev.timestamp,
      payload: ev.payload,
      seq: startIdx + i + 1,
    }));
    const playerName = this.playerNames.get(playerId);
    const exported = this.gameLogger?.export();
    let operations: Operation[];
    if (this.debug && exported) {
      operations = exported.serverOps.slice(startIdx);
    } else if (playerName && exported) {
      operations = (exported.playerOps[playerName] ?? []).slice(startIdx);
    } else {
      operations = [];
    }
    this.sendToPlayer(playerId, { type: 'events', fromSeq: startIdx + 1, events: sequenced, operations });
  }

  /** 给单个玩家（重连时）发完整初始视图。 */
  private sendInitialViewTo(playerId: string, playerName: string, lastSeq?: number): void {
    if (!this.state) return;
    const feState = buildInitialState(this.state, playerName);
    this.sendToPlayer(playerId, { type: 'initialView', state: feState, lastSeq: lastSeq ?? this.nextSeq });
  }

  sendDebugGameState(playerId: string, lastSeq?: number): void {
    if (!this.state) return;
    this.sendToPlayer(playerId, { type: 'debugGameState', state: this.state, lastSeq: lastSeq ?? this.nextSeq });
  }

  private checkGameEnd(): void {
    if (!this.state) return;

    if (this.state.meta.status === '已结束') {
      this.clearTimeoutTimer();
      setRoomStatus(this.room.id, '已结束');
      this.broadcast({ type: 'gameOver', winner: this.state.meta.winner ?? '未知' });
    }
  }

  private checkTimeout(): void {
    if (this.destroyed) return;
    this.timeoutTimer = null;
    if (!this.state?.pending) return;

    const onTimeout = this.state.pending.onTimeout;
    const result = this.gameEngine!.dispatch(this.state, onTimeout);

    if (result.error) {
      this.logger.warn(`[Timeout] engine error: ${result.error}`);
      this.scheduleTimeout();
      return;
    }

    this.appendAction(onTimeout);
    this.state = result.state;
    this.touchAndPersist();
    this.broadcastEvents(result.events, onTimeout);
    this.checkGameEnd();
  }

  /**
   * 按当前 pending 的 deadline 调度单次 setTimeout。
   * 在 touchAndPersist() 中自动调用，无需手动 reschedule。
   */
  private scheduleTimeout(): void {
    this.clearTimeoutTimer();
    const pending = this.state?.pending;
    if (!pending) return;
    const delay = Math.max(0, pending.deadline - Date.now());
    this.timeoutTimer = setTimeout(() => this.checkTimeout(), delay);
  }

  private clearTimeoutTimer(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimeoutTimer();
    this.clearGraceTimer();
    this.state = null;
    await deletePersistedRoom(this.room.id);
  }

  getLastActivityAt(): number {
    return this.lastActivityAt;
  }

  private touchAndPersist(): void {
    if (this.destroyed) return;
    this.lastActivityAt = Date.now();
    if (this.state) {
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
    this.scheduleTimeout();
  }

  private appendAction(action: GameAction): void {
    this.actionLog.push(action);
  }

  handleDisconnect(playerId: string): void {
    if (this.debug) return;
    if (this.state?.meta.status !== '进行中') return;

    this.disconnectedAt.set(playerId, Date.now());
    // 只有当所有玩家都离线时才启动结束游戏的计时器；
    // 仍有玩家在线时保持无限等待。
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

  /** 重连宽限期到时仍有玩家未恢复：结束游戏。 */
  private endDueToDisconnect(): void {
    this.graceTimer = null;
    if (this.state?.meta.status !== '进行中') return;
    const still = [...this.disconnectedAt.keys()];
    if (still.length === 0) return;
    const names = still.map(id => this.playerNames.get(id) ?? id).join('、');
    this.clearTimeoutTimer();
    setRoomStatus(this.room.id, '已结束');
    this.state = { ...this.state, meta: { ...this.state.meta, status: '已结束' } };
    this.broadcast({ type: 'error', message: `${names} 在重连宽限期内未恢复，游戏结束` });
    this.broadcast({ type: 'gameOver', winner: '无人' });
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  getPlayerName(playerId: string): string | undefined {
    return this.playerNames.get(playerId);
  }

  getPending(): import('../engine/types').PendingAction | null {
    return this.state?.pending ?? null;
  }

  getGameLog(): GameLog | null {
    return this.gameLogger?.export() ?? null;
  }

  reconnectPlayer(playerId: string, ws: import('hono/ws').WSContext, lastSeq = 0): boolean {
    if (this.state?.meta.status !== '进行中') return false;
    const wasDisconnected = this.disconnectedAt.delete(playerId);
    this.clearGraceTimer();
    this.room.players.set(playerId, ws);

    if (this.playerNames.size === 0 && this.debug && this.state) {
      for (const charName of this.state.playerOrder) {
        this.playerNames.set(`${playerId}:${charName}`, charName);
      }
    }

    if (this.debug) {
      this.sendDebugGameState(playerId, this.nextSeq);
      if (lastSeq < this.nextSeq) {
        this.sendEventsSince(playerId, lastSeq);
      }
    } else {
      const playerName = this.playerNames.get(playerId);
      if (playerName) {
        this.sendInitialViewTo(playerId, playerName, this.nextSeq);
        if (lastSeq < this.nextSeq) {
          this.sendEventsSince(playerId, lastSeq);
        }
      }
    }
    this.scheduleTimeout();
    if (wasDisconnected) {
      this.broadcast({ type: 'player_reconnected', playerId });
    }
    return true;
  }

  serializeState(): string | null {
    if (!this.state) return null;
    return serializeState(this.state);
  }

  deserializeAndRestore(json: string): boolean {
    try {
      this.state = deserializeState(json);
      return true;
    } catch {
      return false;
    }
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
