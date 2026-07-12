// src/server/session.ts
// Session 只负责网络/持久化,游戏逻辑由引擎管理(顶层函数 + state: GameState)
import type {
  ActionLogEntry,
  ClientMessage as EngineClientMessage,
  GameState,
  GameView,
} from '../engine/types';
import {
  create,
  bootstrap,
  dispatch,
  buildView,
  checkGameOver,
  restore,
  type GameConfig,
} from '../engine/create-engine';
import { eventsForViewer } from '../engine/view/events-for-viewer';
import { getPendingDeadline } from '../engine/view/buildView';
import {
  allCharacters,
  weiCharacters,
  shuCharacters,
  wuCharacters,
  qunCharacters,
} from '../engine/cards/characters';

import '../engine/atoms';
import '../engine/skills';
import type { ServerMessage, DeadlineInfo } from './protocol';
import { serialize } from './protocol';
import type { Room } from './room';
import { createLogger } from './logger';
import { setRoomStatus } from './room';
import { saveRoom, deletePersistedRoom } from './persistence';

/** 默认武将列表:使用引擎全量武将(allCharacters),供选将池使用。
 *  skills 字段来自武将数据(供选将 UI 显示);选完后只实例化引擎默认技能(见 系统规则·选将)。 */
const CHARACTERS: Array<{ name: string; skills: string[] }> = allCharacters.map((c) => ({
  name: c.name,
  skills: c.skills.map((s) => s.name),
}));

/** 将池预设解析:按预设裁剪武将列表。
 *  - 'standard':标准经典(各势力前 8 名),约 32 人
 *  - 'extended':扩展(标准 + 剩余),约全量
 *  - 'all':全量(60 人) */
function resolveCharPool(preset: string): Array<{ name: string; skills: string[] }> {
  const toList = (chars: typeof allCharacters) =>
    chars.map((c) => ({ name: c.name, skills: c.skills.map((s) => s.name) }));
  if (preset === 'standard') {
    // 各势力取前 8 个经典武将
    return [
      ...toList(weiCharacters.slice(0, 8)),
      ...toList(shuCharacters.slice(0, 8)),
      ...toList(wuCharacters.slice(0, 8)),
      ...toList(qunCharacters.slice(0, 8)),
    ];
  }
  // extended / all 均为全量(当前数据集即扩展版;后续数据扩充时细化 extended)
  return CHARACTERS;
}

/** 玩家断线后的保活宽限期(ms)。在此期间重连可恢复座位,超时后正常清理。
 *  60s 足以覆盖常见网络抖动(路由切换/WiFi 重连/页面刷新)。 */
export const RECONNECT_GRACE_MS = 60_000;
export class GameSession {
  private state: GameState | null = null;
  private actionLog: ActionLogEntry[] = [];
  private room: Room;
  private debug: boolean;
  private playerNames = new Map<string, number>();
  private disconnectedAt = new Map<string, number>();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivityAt = Date.now();

  private roomName: string;
  private maxPlayers: number;
  private destroyed = false;
  /** 游戏已结束(主公阵亡/仅剩一人):拦截后续 state 广播与新 action。
   *  避免 gameOver 广播后,杀.execute finally 的 移动牌/popFrame、父帧恢复产生的
   *  出牌窗口 等事件仍被下发,导致前端无法进入结算界面。 */
  private gameOverHandled = false;
  private sessionSeed: number;
  private logger = createLogger('session');
  private lastBroadcastSeq = 0;
  private baselineSent = new Set<string>();
  /** per-player 上次发送的 deadline 缓存,避免重复发送不变的倒计时 */
  private lastSentDeadline = new Map<string, string | null>();
  constructor(room: Room, debug = false, sessionSeed?: number) {
    this.room = room;
    this.roomName = room.name;
    this.maxPlayers = room.maxPlayers;
    this.debug = debug;
    this.sessionSeed = sessionSeed ?? Date.now();
  }

  /** 用持久化数据恢复:create(config) → bootstrap → 重放 actionLog,确定性重建完整 state。
   *  config 从 state(rngSeed/playerCount)+ 全局 CHARACTERS 重构。 */
  async restoreState(state: GameState, actionLog: ActionLogEntry[] = []): Promise<void> {
    this.lastActivityAt = Date.now();
    // config 重构:seed 来自 state,playerCount 从 state.players,characters 用全局表
    const config: GameConfig = {
      characters: resolveCharPool(this.room.config.charPool),
      playerCount: state.players.length,
      seed: state.rngSeed,
      gameId: this.room.id,
      handSize: this.room.config.handSize,
      timeoutScale: this.room.config.timeoutScale,
    };
    const fresh = create(config);
    await bootstrap(fresh, config);
    await restore(fresh, config, actionLog);
    this.state = fresh;
    this.actionLog = fresh.actionLog;
    this.attachStateListener();
  }

  async startGame(playerCount?: number): Promise<boolean> {
    if (this.destroyed) return false;
    const count = this.debug ? (playerCount ?? this.room.players.size) : this.room.players.size;
    if (count < 2) return false;

    // 从房间配置派生 GameConfig:将池预设 + 手牌数 + 超时倍率
    const cfg = this.room.config;
    const config: GameConfig = {
      characters: resolveCharPool(cfg.charPool),
      playerCount: count,
      seed: this.sessionSeed,
      gameId: this.room.id,
      handSize: cfg.handSize,
      timeoutScale: cfg.timeoutScale,
    };
    this.state = create(config);
    // 挂载 state 变更回调:必须在 bootstrap 之前挂载!
    // 因为交互式选将(选将询问)会在 bootstrap 中创建 pending,
    // 需要 onStateChange 回调广播给客户端才能让玩家选将。
    this.actionLog = this.state.actionLog;
    this.attachStateListener();
    setRoomStatus(this.room.id, '进行中');
    // bootstrap 可能因选将 pending 而挂起(fire-and-forget dispatch)
    // 不 await — 让 startGame 立即返回,客户端收到选将 pending 后响应
    void bootstrap(this.state, config)
      .then(() => {
        // bootstrap 完成后:所有角色/手牌/技能已就绪,强制刷新 baseline
        this.baselineSent.clear();
        this.broadcastNewState();
      })
      .catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        this.logger.error('bootstrap error', { error: e.stack ?? String(e) });
      });

    // 建立 playerId → 座次下标 映射
    const state = this.state;
    if (this.debug) {
      // debug 模式:座次已在 joinDebugRoom 时由 assignDebugSeat 分配(配置阶段)。
      // 这里仅补充 startGame 后新加入连接(超出预期座次数),不再覆盖已有映射。
      const playerIds = [...this.room.players.keys()];
      for (let i = 0; i < playerIds.length && i < state.players.length; i++) {
        if (this.playerNames.has(playerIds[i])) continue;
        // 未分配:找下一个未占用座次
        const used = new Set([...this.playerNames.values()]);
        let seat = i;
        while (used.has(seat) && seat < state.players.length) seat++;
        if (seat < state.players.length) this.playerNames.set(playerIds[i], seat);
      }
    } else {
      const playerIds = [...this.room.players.keys()];
      for (let i = 0; i < playerIds.length && i < state.players.length; i++) {
        this.playerNames.set(playerIds[i], state.players[i].index);
      }
    }

    // 检查游戏是否开局时已结束(3 人场开不了,直接结束)
    if (state.players.filter((p) => p.alive).length <= 1) {
      this.handleGameOver(undefined);
    }

    this.actionLog = state.actionLog;
    this.lastActivityAt = Date.now();

    // sendInitialViewToAll 已移除——bootstrap 的 onStateChange 会触发 broadcastNewState,
    // 此时 state 已推进(至少完成抽身份),发给前端的是有意义的状态。
    return true;
  }

  /**
   * debug 模式:为连接的玩家分配座次(配置阶段即可调用,不依赖 state)。
   * 按连接顺序分配 player[0], player[1], ...
   * 返回分配的座次下标,超出 maxPlayers 时返回 0(观察者)。
   */
  assignDebugSeat(playerId: string): number {
    if (!this.debug) return 0;
    // 已分配过则直接返回
    const existing = this.playerNames.get(playerId);
    if (existing !== undefined) return existing;
    // 找到下一个未占用的座次(上限为房间 maxPlayers)
    const used = new Set([...this.playerNames.values()]);
    for (let i = 0; i < this.maxPlayers; i++) {
      if (!used.has(i)) {
        this.playerNames.set(playerId, i);
        return i;
      }
    }
    // 全部占用 → 观察者
    this.playerNames.set(playerId, 0);
    return 0;
  }

  async handleAction(playerId: string, action: EngineClientMessage): Promise<void> {
    if (this.destroyed || !this.state || this.gameOverHandled) return;
    // debug 模式:允许以任意角色名发 action
    // 非 debug 模式:校验 ownerId 必须匹配预期玩家
    const expectedIndex = this.playerNames.get(playerId);
    if (expectedIndex === undefined && !this.debug) return;
    // debug 模式不校验 ownerId——单人控制所有角色
    // 非 debug 模式:校验 ownerId
    if (!this.debug && action.ownerId !== expectedIndex) {
      this.logger.warn('ownerId mismatch', {
        actionOwner: action.ownerId,
        expected: expectedIndex,
      });
      return;
    }
    // dispatch 返回 boolean:true=accepted,false=rejected。
    // state 变更的广播/持久化/结束检查由 onStateChange 回调驱动(见 attachStateListener)。
    const accepted = await dispatch(this.state, action).catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error('dispatch error', { error: e.stack ?? String(e) });
      return false;
    });
    if (!accepted) {
      this.sendToPlayer(playerId, { type: 'actionRejected' });
    }
  }

  /**
   * 整理手牌:玩家拖拽重排自己的手牌顺序。
   * 这是纯显示偏好,不调 dispatch、不写 actionLog、不触发 seq 变化 ——
   * 直接 mutate state.players[i].hand,只给该玩家广播最新 view。
   *
   * 重放确定性由盲选 action 在 actionLog 里 splice 的"设置手牌顺序"条目保证
   * (过河拆桥/顺手牵羊盲选时会快照顺序),state 快照也会随 persistAsync 保存最新顺序。
   * 即使重启丢失了 state 快照,下次有人盲选时顺序仍会从 actionLog 恢复。
   */
  async handleReorderHand(playerId: string, order: string[]): Promise<void> {
    if (this.destroyed || !this.state) return;
    const playerIndex = this.playerNames.get(playerId);
    if (playerIndex === undefined) return;
    // debug 模式不校验 ownerId——单人控制所有角色
    const player = this.state.players[playerIndex];
    if (!player) return;
    // 校验:order 必须是当前 hand 的合法排列(同集合,防注入不存在的卡)
    if (order.length !== player.hand.length) return;
    const handSet = new Set(player.hand);
    for (const id of order) {
      if (!handSet.has(id)) return;
    }
    // 直接 mutate hand 顺序
    player.hand = [...order];
  }

  private handleGameOver(winner?: number): void {
    // 标记游戏结束:拦截后续 onStateChange 广播与 handleAction。
    // 所有触发 gameOver 的路径(onStateChange/startGame/恢复)统一在此设值。
    this.gameOverHandled = true;
    setRoomStatus(this.room.id, '已结束');
    this.broadcast({ type: 'gameOver', winner: winner !== undefined ? String(winner) : '无人' });
  }

  /** 游戏结束后重置房间到「配置+准备」阶段,供「再来一局」复用同一 session。
   *  清除 gameOverHandled/state/广播水位,房间状态回到「等待中」,清空准备记录。
   *  广播 game_reset 通知客户端清除 gameOver/gameStarted/views,回到配置面板。
   *  app 层随后调用 broadcastRoomState 同步准备状态。 */
  resetToLobby(): void {
    this.gameOverHandled = false;
    // 断开旧 state 回调并丢弃,防止残留 execute resume 后触发已重置 session 的广播
    if (this.state) this.state.onStateChange = undefined;
    this.state = null;
    this.actionLog = [];
    this.baselineSent.clear();
    this.lastSentDeadline.clear();
    this.lastBroadcastSeq = 0;
    // 重新生成 seed,新一局随机序列不同
    this.sessionSeed = Date.now();
    setRoomStatus(this.room.id, '等待中');
    this.room.readyPlayers.clear();
    // 清除旧持久化数据,避免重启时恢复到已结束的局面
    void deletePersistedRoom(this.room.id).catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error('resetToLobby: deletePersistedRoom failed', {
        error: e.stack ?? String(e),
      });
    });
    // 通知所有连接:游戏已重置,客户端清除 gameOver/gameStarted/views
    this.broadcast({ type: 'game_reset' });
  }

  /**
   * 挂载 state.onStateChange 回调:每次 applyAtom 结束后同步 broadcastNewState +
   * persistAsync + checkGameOver。dispatch fire-and-forget 模型下,所有 session
   * 副作用由本回调驱动。幂等:重复挂载会覆盖旧回调。
   */
  private attachStateListener(): void {
    if (!this.state) return;
    this.state.onStateChange = () => {
      if (this.destroyed || !this.state) return;
      // 游戏已结束:拦截 gameOver 之后的残留广播。本次 onStateChange 已广播了触发
      // gameOver 的 atom(如 击杀主公);标记后,杀.execute finally 的 移动牌/popFrame、
      // 父帧恢复产生的 出牌窗口 等后续 atom 的 onStateChange 直接 return,不再下发。
      if (this.gameOverHandled) return;
      this.actionLog = this.state.actionLog;
      this.lastActivityAt = Date.now();
      this.broadcastNewState();
      this.persistAsync();
      const { gameOver, winner } = checkGameOver(this.state);
      if (gameOver) {
        // handleGameOver 内部设 gameOverHandled=true:本次已广播触发 gameOver 的 atom
        // (如 击杀主公),后续 atom(移动牌/popFrame/出牌窗口)的 onStateChange 被 return 拦截。
        this.handleGameOver(winner);
      }
    };
    this.state.onError = (error: Error) => {
      this.logger.error('引擎 execute 抛错', { error: error.stack ?? String(error) });
    };
  }

  /** 计算某 viewer 的有效 deadline(来自 pending slot 的超时)。
   *  出牌阶段有 __出牌 询问(50s 超时),其他阶段有各自的询问(询问闪/弃牌等)。
   *  无 pending 返回 null。 */
  private effectiveDeadline(state: GameState, viewer: number): DeadlineInfo | null {
    const p = getPendingDeadline(state, viewer);
    return p ? { deadline: p.deadline, totalMs: p.totalMs } : null;
  }

  /** 从 deadline 值构建缓存 key(避免重复发送不变的倒计时) */
  private deadlineKey(dl: DeadlineInfo | null): string | null {
    return dl ? `${dl.deadline}:${dl.totalMs}` : null;
  }

  /**
   * 广播状态变更:每次 atom apply 后同步触发(onStateChange 回调)。
   * 逐条发送 event 消息,deadline 仅在变化时附加。
   * 首次推送 initialView 作为 baseline,后续发增量 event。
   */
  private broadcastNewState(): void {
    if (!this.state) return;
    const state = this.state;

    for (const [playerId, viewer] of this.playerNames) {
      if (viewer < 0 || viewer >= state.players.length) continue;
      if (!this.baselineSent.has(playerId)) {
        const view = buildView(state, viewer);
        this.sendToPlayer(playerId, { type: 'initialView', state: view, lastSeq: state.seq });
        this.baselineSent.add(playerId);
        // baseline 已含完整状态,初始化 deadline 缓存
        this.lastSentDeadline.set(
          playerId,
          this.deadlineKey(this.effectiveDeadline(state, viewer)),
        );
      }
      const envelopes = eventsForViewer(state, viewer, this.lastBroadcastSeq);
      if (envelopes.length > 0) {
        // 计算 effective deadline:pending 优先,否则出牌/弃牌阶段的 idleDeadline
        const dl = this.effectiveDeadline(state, viewer);
        const dlKey = this.deadlineKey(dl);
        const prevKey = this.lastSentDeadline.get(playerId) ?? undefined;
        // deadline 仅在变化时附加在最后一条 event 上(减少冗余)
        // 逐条发送 view + notify envelopes(view=atom 事件, notify=pendingResolved 等)
        for (let i = 0; i < envelopes.length; i++) {
          const env = envelopes[i];
          const isLast = i === envelopes.length - 1;
          const attachDeadline = isLast && dlKey !== prevKey;
          this.sendToPlayer(playerId, {
            type: 'event',
            seq: env.seq,
            timestamp: env.timestamp,
            ...(env.view ? { view: env.view } : {}),
            ...(env.notify ? { notify: env.notify } : {}),
            ...(attachDeadline ? { deadline: dl } : {}),
          });
        }
        this.lastSentDeadline.set(playerId, dlKey);
      }
    }
    this.lastBroadcastSeq = state.seq;
  }

  /**
   * 向单个玩家发其座次的 initialView(重连/后加入用)。
   * 重连时发当前完整 state 作为 baseline。
   */
  private sendInitialViewToPlayer(playerId: string): void {
    if (!this.state) return;
    const viewer = this.playerNames.get(playerId);
    if (viewer === undefined || viewer < 0 || viewer >= this.state.players.length) return;
    const state = this.state;
    const view = buildView(state, viewer);
    this.sendToPlayer(playerId, { type: 'initialView', state: view, lastSeq: state.seq });
    this.lastSentDeadline.set(playerId, this.deadlineKey(this.effectiveDeadline(state, viewer)));
  }

  handleDisconnect(playerId: string): void {
    if (this.debug) {
      this.clearDebugPlayer(playerId);
      // room.players 也由 clearDebugPlayer 内部删除
      return;
    }
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

  /** debug 模式:刷新重连复用座次时,由 app.ts 调用清理旧 playerId 的映射。
   *  与 handleDisconnect 的区别:room.players 已由 joinDebugRoom 删除,这里不重复删。 */
  evictDebugPlayer(playerId: string): void {
    this.clearDebugPlayer(playerId, /* deleteFromRoom */ false);
  }

  /** debug 模式清理 playerId 的所有映射。deleteFromRoom=false 用于刷新重连
   *  (room.players 已由调用方处理)。 */
  private clearDebugPlayer(playerId: string, deleteFromRoom = true): void {
    this.playerNames.delete(playerId);
    this.baselineSent.delete(playerId);
    this.lastSentDeadline.delete(playerId);
    if (deleteFromRoom) {
      this.room.players.delete(playerId);
    }
  }

  private allPlayersDisconnected(): boolean {
    if (this.room.players.size === 0) return false;
    return this.disconnectedAt.size >= this.room.players.size;
  }

  private endDueToDisconnect(): void {
    this.graceTimer = null;
    const still = [...this.disconnectedAt.keys()];
    if (still.length === 0) return;
    const state = this.state;
    const names = still
      .map((id) => {
        const idx = this.playerNames.get(id);
        return idx !== undefined ? (state?.players[idx]?.name ?? id) : id;
      })
      .join('、');
    setRoomStatus(this.room.id, '已结束');
    this.broadcast({ type: 'error', message: `${names} 在重连宽限期内未恢复,游戏结束` });
    this.broadcast({ type: 'gameOver', winner: '无人' });
    // 必须 destroy 以清理 idle timer，否则定时器会通过 onStateChange 自循环
    void this.destroy().catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error('destroy after disconnect failed', { error: e.stack ?? String(e) });
    });
  }

  /** 玩家重连:恢复座位并发送当前完整 state。
   *  multiplayer 模式:新 WS 连接的 playerId 与断线前不同(服务端 onOpen 自动生成),
   *  需通过 previousPlayerId 迁移座次映射(旧 playerId → 新 playerId)。
   *  debug 模式:不传 previousPlayerId,assignDebugSeat 已完成座次分配。 */
  reconnectPlayer(
    playerId: string,
    ws: import('hono/ws').WSContext,
    _lastSeq = 0,
    previousPlayerId?: string,
  ): boolean {
    if (!this.state) return false;

    // multiplayer 模式:迁移 playerId 映射
    if (previousPlayerId && previousPlayerId !== playerId) {
      const seatIndex = this.playerNames.get(previousPlayerId);
      if (seatIndex === undefined) return false; // 旧 playerId 已不存在(可能已超时清理)
      this.playerNames.delete(previousPlayerId);
      this.playerNames.set(playerId, seatIndex);
      this.baselineSent.delete(previousPlayerId);
      this.lastSentDeadline.delete(previousPlayerId);
      this.disconnectedAt.delete(previousPlayerId);
      this.room.players.delete(previousPlayerId);
    }

    this.clearGraceTimer();
    this.disconnectedAt.delete(playerId);
    this.room.players.set(playerId, ws);
    this.sendInitialViewToPlayer(playerId);
    this.baselineSent.add(playerId);
    // initialView 已是全量状态，不需要补推差量。
    // 同步水位标记，避免后续 broadcastNewState 重发已含在 initialView 中的事件。
    this.lastBroadcastSeq = Math.max(this.lastBroadcastSeq, this.state.seq);
    this.broadcast({ type: 'player_reconnected', playerId });
    return true;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearGraceTimer();
    // 先断开 state 变更回调:防止挂起的 execute resume 后触发已销毁 session 的广播
    if (this.state) this.state.onStateChange = undefined;
    this.state = null;
    await deletePersistedRoom(this.room.id);
  }

  getLastActivityAt(): number {
    return this.lastActivityAt;
  }

  /** session 是否已销毁。闲置清理据此区分「活跃但 idle」与「已 destroy 的 zombie」:
   *  全员断线 grace 超时(endDueToDisconnect)会 destroy 但不从 gameSessions 移除,
   *  留给 cleanupIdleRooms 回收——此时必须无视 TTL 立即清理,避免泄漏。 */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  getPlayerName(playerId: string): number | undefined {
    return this.playerNames.get(playerId);
  }

  getState(): GameState | null {
    return this.state;
  }

  getDebugView(): GameView | null {
    if (!this.state) return null;
    return buildView(this.state, 0, this.debug);
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
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
    ).catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error('saveRoom failed', { error: e.stack ?? String(e) });
    });
  }

  /** 返回游戏动作日志(供 /api/rooms/:id/log 端点)。无 state 时返回 null。 */
  getGameLog(): ActionLogEntry[] | null {
    if (!this.state) return null;
    return this.actionLog;
  }

  private sendToPlayer(playerId: string, message: ServerMessage): void {
    const ws = this.room.players.get(playerId);
    if (!ws) return;
    try {
      ws.send(serialize(message));
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`sendToPlayer failed for ${playerId}`, { error: e.stack ?? String(e) });
    }
  }

  private broadcast(message: ServerMessage): void {
    const data = serialize(message);
    for (const [, ws] of this.room.players) {
      try {
        ws.send(data);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.logger.error('broadcast send failed', { error: e.stack ?? String(e) });
      }
    }
  }
}
