// src/server/session.ts
// Session 只负责网络/持久化,游戏逻辑由引擎管理(顶层函数 + state: GameState)
import type {
  ActionLogEntry,
  ClientMessage as EngineClientMessage,
  GameState,
  GameView,
  GameEventEnvelope,
} from '../engine/types';
import {
  create,
  bootstrap,
  dispatch,
  buildView,
  checkGameOver,
  restore,
  type GameConfig,
} from '../engine/index';
import { eventsForViewer } from '../engine/view/events-for-viewer';
import { getPendingDeadline } from '../engine/view/buildView';
import {
  allCharacters,
  weiCharacters,
  shuCharacters,
  wuCharacters,
  qunCharacters,
} from '../engine/data/characters';

import type { ServerMessage, DeadlineInfo } from './protocol';
import type { Room } from './room';
import { createLogger } from './logger';
import { setRoomStatus } from './room';
import { saveRoom, deletePersistedRoom } from './persistence';
import { appendEventJournal, resetEventJournal } from './eventJournal';
import { appendGameHistory, buildHistoryEntry, buildReplayFile } from './gameHistory';
import { createRng } from '../engine/util/rng';
import { VirtualClock, RealClock } from '../engine/core/clock';

/** 计算座次轮转偏移:物理座位 i → 游戏座次 (i + offset) % n。
 *  用 seed 派生(确定性,持久化/恢复可复现),使主公(游戏座次 0)随机分布到各物理座位——
 *  房主不再恒为主公。常数偏移避免与 抽身份 的身份洗牌(同 seed)产生相关性。 */
function computeSeatRotation(seed: number, n: number): number {
  if (n <= 1) return 0;
  return createRng(seed + 7919).nextInt(n);
}

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
 *  所有玩家离线超过此时长则自动终止游戏。30s 足以覆盖常见网络抖动(路由切换/WiFi 重连/页面刷新)。 */
export const RECONNECT_GRACE_MS = 30_000;

/** 差量重连阈值:客户端 lastSeq 距当前 state.seq 的缺口不超过该值时,
 *  重连走 event 差量补发而非全量 initialView 快照(节省带宽/重建开销)。 */
export const DIFF_RECONNECT_THRESHOLD = 200;

/** atomHistory 内存活跃窗口大小:seq 低于 state.seq - 窗口 的条目会被裁剪落盘
 *  (eventJournal)。必须 ≥ DIFF_RECONNECT_THRESHOLD——否则可服务差量重连的客户端
 *  (缺口在阈值内)会因所需条目已被裁而被迫回退全量快照,差量通道形同虚设。 */
export const EVENT_TRIM_WINDOW = 500;

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
  /** 录像基线:开局(选将完成)逐座次捕获的完整视图深拷贝,游戏结束组装房间历史录像用 */
  private replayBaseline: GameView[] = [];
  /** 录像基线捕获时的 state.seq(此后的 atomHistory 事件逐条进录像) */
  private replayBaselineSeq = 0;
  /** 本局开始时刻(历史条目 startedAt) */
  private gameStartedAt = 0;
  /** 事件历史可回溯下限:seq ≤ 它的 event 已从内存裁剪(落盘到 eventJournal),
 *  不可差量补发。由 trimAtomHistory 在每次广播后推进;新一局(startGame/restoreState/
 *  resetToLobby)归零。canServeDifferential 据此判定重连回退 initialView。 */
  private trimmedFloorSeq = 0;
  constructor(room: Room, debug = false, sessionSeed?: number) {
    this.room = room;
    this.roomName = room.name;
    this.maxPlayers = room.maxPlayers;
    this.debug = debug;
    this.sessionSeed = sessionSeed ?? Date.now();
  }

  /** 局标识:每局唯一(startGame/restoreState 各自设置的 gameStartedAt)。
   *  附在 event 消息上,SSE Last-Event-ID 用 `<epoch>:<seq>` 格式携带;
   *  重连时 epoch 不匹配(跨局/跨进程重启)则强制走 initialView 快照。 */
  get eventEpoch(): number {
    return this.gameStartedAt;
  }

  /** 用持久化数据恢复:create(config) → bootstrap → 重放 actionLog,确定性重建完整 state。
   *  config 从 state(rngSeed/playerCount)+ 全局 CHARACTERS 重构。 */
  async restoreState(state: GameState, actionLog: ActionLogEntry[] = []): Promise<void> {
    this.lastActivityAt = Date.now();
    // config 重构:seed 来自 state,playerCount 从 state.players,characters 用全局表,
    // mode 用房间配置(与开局一致;state.config.mode 由 create 写入快照,二者一致)
    const config: GameConfig = {
      characters: resolveCharPool(this.room.config.charPool),
      playerCount: state.players.length,
      seed: state.rngSeed,
      gameId: this.room.id,
      handSize: this.room.config.handSize,
      timeoutSec: this.room.config.timeoutSec,
      mode: this.room.config.gameMode,
    };
    const fresh = create(config);
    // 注入虚拟时钟:重放期间超时按 actionLog 时间戳确定性推导,不依赖真实系统时间。
    // startedAt 归零对齐 VirtualClock(相对时间从 0 起)。
    fresh.clock = new VirtualClock();
    fresh.startedAt = fresh.clock.now();
    await bootstrap(fresh, config);
    await restore(fresh, config, actionLog);
    // 重放完成:切回真实时钟,继续正常对局(超时由真实 setTimeout 驱动)。
    fresh.clock = new RealClock();
    this.state = fresh;
    // 恢复座次轮转偏移:与 startGame 一致(同 seed 派生),保证重连后视角不错位。
    this.state.seatRotation = computeSeatRotation(config.seed, this.state.players.length);
    this.actionLog = fresh.actionLog;
    this.attachStateListener();

    // 从 room.seats 恢复 playerId → 座次下标映射,使重启后玩家可重连。
    // startGame 正常路径会在游戏开始时设置 playerNames;恢复路径需手动填充。
    // 应用与 startGame 一致的座次轮转偏移(seatRotation),否则重连后视角错位。
    const n = this.state.players.length;
    const offset = this.state.seatRotation ?? 0;
    for (let i = 0; i < this.room.seats.length; i++) {
      const pid = this.room.seats[i];
      if (pid !== null) {
        this.playerNames.set(pid, (i + offset) % n);
      }
    }
    // 恢复局也记录历史:基线取恢复时刻的视图(若选将已完成则立即捕获;否则等
    // onStateChange 在选将完成后捕获)。startedAt 用恢复时刻近似。
    this.gameStartedAt = Date.now();
    // 恢复 = 新一局起点(epoch 变化):journal 重新开始,裁剪水位归零
    this.trimmedFloorSeq = 0;
    resetEventJournal(this.room.id);
    this.maybeCaptureReplayBaseline();
  }

  async startGame(playerCount?: number): Promise<boolean> {
    if (this.destroyed) return false;
    const count = this.debug ? (playerCount ?? this.room.players.size) : this.room.players.size;
    if (count < 2) return false;

    // 从房间配置派生 GameConfig:将池预设 + 手牌数 + 操作倒时秒数 + 游戏模式(规则包)
    const cfg = this.room.config;
    const config: GameConfig = {
      characters: resolveCharPool(cfg.charPool),
      playerCount: count,
      seed: this.sessionSeed,
      gameId: this.room.id,
      handSize: cfg.handSize,
      timeoutSec: cfg.timeoutSec,
      mode: cfg.gameMode,
    };
    this.state = create(config);
    // 座次轮转偏移:决定主公(游戏座次 0)对应哪个物理座位。在 bootstrap 之前同步设置,
    // 供下方 playerId↔座次映射读取——房主不再恒为主公。随 seed 确定,可复现。
    this.state.seatRotation = computeSeatRotation(config.seed, config.playerCount);
    // 挂载 state 变更回调:必须在 bootstrap 之前挂载!
    // 因为交互式选将(选将询问)会在 bootstrap 中创建 pending,
    // 需要 onStateChange 回调广播给客户端才能让玩家选将。
    this.actionLog = this.state.actionLog;
    this.attachStateListener();
    setRoomStatus(this.room.id, '进行中');
    // bootstrap 可能因选将 pending 而挂起(fire-and-forget dispatch)
    // 不 await — 让 startGame 立即返回,客户端收到选将 pending 后响应
    this.gameStartedAt = Date.now();
    this.replayBaseline = [];
    this.replayBaselineSeq = 0;
    // 新一局(epoch 变化):journal 重新开始,裁剪水位归零
    this.trimmedFloorSeq = 0;
    resetEventJournal(this.room.id);
    void bootstrap(this.state, config)
      .then(() => {
        // bootstrap 完成后:所有角色/手牌/技能已就绪,强制刷新 baseline
        this.baselineSent.clear();
        this.broadcastNewState();
        // 录像基线不在此时捕获:bootstrap resolve 仅表示选将 slot 已创建(见 onStateChange 注释),
        // 由 maybeCaptureReplayBaseline 在选将完成后的 onStateChange 中捕获
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
      // 应用座次轮转偏移(seatRotation):物理座位 i(房主=0,其余按加入顺序)
      // → 游戏座次 (i + seatRotation) % n。主公恒在游戏座次 0(引擎不变量),
      // 经偏移后落到随机物理座位,房主不再恒为主公;玩家环形相对位置保持不变。
      const playerIds = [...this.room.players.keys()];
      const n = state.players.length;
      const offset = state.seatRotation ?? 0;
      for (let i = 0; i < playerIds.length && i < n; i++) {
        const gameSeat = (i + offset) % n;
        this.playerNames.set(playerIds[i], state.players[gameSeat].index);
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
    // dispatch 返回 DispatchResult:{ accepted, settle }。settle 供重放用,正常对局忽略。
    // state 变更的广播/持久化/结束检查由 onStateChange 回调驱动(见 attachStateListener)。
    const result = await dispatch(this.state, action).catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error('dispatch error', { error: e.stack ?? String(e) });
      return { accepted: false, settle: Promise.resolve<Error | undefined>(undefined) } as const;
    });
    if (!result.accepted) {
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
    this.recordGameHistory(winner, '正常');
    this.broadcast({ type: 'gameOver', winner: winner !== undefined ? String(winner) : '无人' });
  }

  /** 延迟捕获录像基线:仅在「所有玩家 character 已就绪」且「尚未捕获」时执行。
   *  由 onStateChange 每次调用。bootstrap resolve 仅表示选将 slot 已创建(玩家未 respond,
   *  character 全空),此刻捕获会得到空武将名的无效 baseline——必须等到选将完成后的
   *  第一次 onStateChange。与客户端 ReplayRecorder.record 的 initialView 捕获条件一致。
   *  深拷贝隔离后续 state 变更——buildView 结果虽是新对象,但 cardMap 等嵌套字段可能
   *  共享 state 引用,JSON 往返是最可靠的快照手段(视图本身走 SSE JSON,可序列化)。 */
  private maybeCaptureReplayBaseline(): void {
    if (!this.state) return;
    if (this.replayBaseline.length > 0) return; // 已捕获本局
    const players = this.state.players;
    if (players.length === 0 || !players.every((p) => p.character)) return;
    const views: GameView[] = [];
    for (let v = 0; v < players.length; v++) {
      views.push(JSON.parse(JSON.stringify(buildView(this.state, v))) as GameView);
    }
    // 旁观基线(viewer=-1,无私有手牌):对局历史重放时,未参赛者/旁观者
    // 只能以旁观视角观看(buildReplayFile 按 view.viewer 键控,座次为 -1)。
    views.push(JSON.parse(JSON.stringify(buildView(this.state, -1))) as GameView);
    this.replayBaseline = views;
    this.replayBaselineSeq = this.state.seq;
  }

  /** 游戏结束记录房间历史:结果条目 + 全座次录像,fire-and-forget 落盘。
   *  winner=胜方座次(undefined=平局);reason '中断'=全员掉线宽限超时。
   *  座次→playerId 反查自 playerNames(记录真实连接身份,而非引擎生成的 P0/P1)。 */
  private recordGameHistory(winner: number | undefined, reason: '正常' | '中断'): void {
    const state = this.state;
    if (!state || state.players.length === 0) return;
    try {
      const seatPlayerIds = state.players.map((p) => {
        for (const [pid, seat] of this.playerNames) {
          if (seat === p.index) return pid;
        }
        return p.name;
      });
      const endedAt = Date.now();
      const entry = buildHistoryEntry(state, seatPlayerIds, {
        roomId: this.room.id,
        roomName: this.roomName,
        gameMode: this.room.config.gameMode ?? '身份局',
        startedAt: this.gameStartedAt || endedAt,
        endedAt,
        winner,
        reason,
      });
      const replay =
        this.replayBaseline.length > 0
          ? buildReplayFile(state, this.replayBaseline, this.replayBaselineSeq, {
              createdAt: endedAt,
              playerCount: state.players.length,
              characters: state.players.map((p) => p.character ?? ''),
              roomName: this.roomName,
            })
          : null;
      entry.hasReplay = replay !== null;
      void appendGameHistory(this.room.id, entry, replay).catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        this.logger.error('记录对局历史失败', { error: e.stack ?? String(e) });
      });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error('组装对局历史失败', { error: e.stack ?? String(e) });
    }
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
    // 丢弃上一局的录像基线(下一局 startGame 重新捕获)
    this.replayBaseline = [];
    this.replayBaselineSeq = 0;
    // 裁剪水位归零(下一局 startGame 也会重置;此处先复位避免残留影响判空)
    this.trimmedFloorSeq = 0;
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
   * checkGameOver 经规则包动态加载(异步):ES 模块缓存后近零开销;onStateChange
   * 是同步回调,胜负检查以 fire-and-forget 异步执行,gameOverHandled 标记兜底竞态。
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
      // 录像基线延迟捕获:bootstrap resolve 仅表示选将 slot 已创建(玩家未 respond,
      // character 全空)。与客户端 ReplayRecorder 一致,等「所有玩家 character 已就绪」
      // 的第一次 onStateChange 再捕获——此时选将完成,武将名/势力/体力齐全,作为录像
      // 起点语义完整;选将阶段事件(抽身份/选将/发牌)的结果均已体现在此 baseline。
      this.maybeCaptureReplayBaseline();
      this.broadcastNewState();
      this.persistAsync();
      void checkGameOver(this.state).then(({ gameOver, winner }) => {
        if (this.destroyed || this.gameOverHandled) return;
        if (gameOver) {
          // handleGameOver 内部设 gameOverHandled=true:本次已广播触发 gameOver 的 atom
          // (如 击杀主公),后续 atom(移动牌/popFrame/出牌窗口)的 onStateChange 被 return 拦截。
          this.handleGameOver(winner);
        }
      });
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
      this.sendViewToConn(playerId, viewer, state);
    }

    // 旁观者：viewer 来自 viewGrants（授权座次），无授权则为 -1（公开视图）
    for (const [spectatorId] of this.room.spectators) {
      const viewer = this.room.viewGrants.get(spectatorId) ?? -1;
      if (viewer >= 0 && viewer >= state.players.length) continue;
      this.sendViewToConn(spectatorId, viewer, state);
    }

    this.lastBroadcastSeq = state.seq;
    // 广播完成后裁剪 atomHistory(超出活跃窗口的旧条目落盘 journal)。
    // viewBuffering 期间 dispatch 的 preceding 回滚会截断 atomHistory,与裁剪竞争;
    // 防御性判 state.viewBuffering(正常路径 onStateChange 在 buffering 时被吞,不会到这)。
    this.trimAtomHistory(state);
  }

  /** 裁剪 atomHistory:把 seq ≤ floor 的头部条目落盘 eventJournal 后从内存移除,
   *  并推进 trimmedFloorSeq(可回溯下限)。三条不变量:
   *  (a) floor = min(seq - EVENT_TRIM_WINDOW, replayBaselineSeq) ≤ replayBaselineSeq:
   *      buildReplayFile 只需要 seq > replayBaselineSeq 的存活条目,裁剪永不越过
   *      录像基线,终局录像组装不受影响;
   *  (b) EVENT_TRIM_WINDOW ≥ DIFF_RECONNECT_THRESHOLD:缺口在差量阈值内的客户端
   *      所需条目必然仍在窗口内,canServeDifferential 不会因裁剪误伤;
   *  (c) 选将未完成时 replayBaselineSeq = 0 → floor = 0 ≤ trimmedFloorSeq(初值 0)
   *      → 直接返回不裁剪,开局阶段事件全量保留。 */
  private trimAtomHistory(state: GameState): void {
    if (state.viewBuffering) return;
    const floor = Math.min(state.seq - EVENT_TRIM_WINDOW, this.replayBaselineSeq);
    if (floor <= this.trimmedFloorSeq) return;
    // atomHistory 按 seq 升序,头部扫描统计 seq ≤ floor 的条数
    let k = 0;
    while (k < state.atomHistory.length && state.atomHistory[k].seq <= floor) k++;
    if (k > 0) {
      const evicted = state.atomHistory.slice(0, k);
      appendEventJournal(this.room.id, this.eventEpoch, evicted);
      state.atomHistory.splice(0, k);
    }
    this.trimmedFloorSeq = floor;
  }

  /** 向单个连接（玩家或旁观者）发送 baseline + 增量事件。 */
  private sendViewToConn(connId: string, viewer: number, state: GameState): void {
    if (!this.baselineSent.has(connId)) {
      const view = buildView(state, viewer);
      this.sendToPlayer(connId, { type: 'initialView', state: view, lastSeq: state.seq });
      this.baselineSent.add(connId);
      this.lastSentDeadline.set(connId, this.deadlineKey(this.effectiveDeadline(state, viewer)));
    }
    this.sendEventEnvelopes(connId, viewer, state, eventsForViewer(state, viewer, this.lastBroadcastSeq));
  }

  /** 逐条发送 event 消息(统一带 epoch 局标识;deadline 仅末条且变化时附加)。
   *  常规广播与断线重连差量补发共用。 */
  private sendEventEnvelopes(
    connId: string,
    viewer: number,
    state: GameState,
    envelopes: GameEventEnvelope[],
  ): void {
    if (envelopes.length === 0) return;
    const dl = this.effectiveDeadline(state, viewer);
    const dlKey = this.deadlineKey(dl);
    const prevKey = this.lastSentDeadline.get(connId) ?? undefined;
    for (let i = 0; i < envelopes.length; i++) {
      const env = envelopes[i];
      const isLast = i === envelopes.length - 1;
      const attachDeadline = isLast && dlKey !== prevKey;
      this.sendToPlayer(connId, {
        type: 'event',
        seq: env.seq,
        epoch: this.eventEpoch,
        timestamp: env.timestamp,
        ...(env.view ? { view: env.view } : {}),
        ...(env.notify ? { notify: env.notify } : {}),
        ...(attachDeadline ? { deadline: dl } : {}),
      });
    }
    this.lastSentDeadline.set(connId, dlKey);
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

  /** 旁观者连接 SSE：若游戏进行中则发送 initialView(或小差量补发)。 */
  sendSpectatorInitialView(spectatorId: string, lastSeq = 0): void {
    if (!this.state) return;
    const viewer = this.room.viewGrants.get(spectatorId) ?? -1;
    if (viewer >= 0 && viewer >= this.state.players.length) return;
    const state = this.state;
    if (this.canServeDifferential(lastSeq)) {
      this.sendEventEnvelopes(spectatorId, viewer, state, eventsForViewer(state, viewer, lastSeq));
    } else {
      const view = buildView(state, viewer);
      this.sendToPlayer(spectatorId, { type: 'initialView', state: view, lastSeq: state.seq });
      this.lastSentDeadline.set(
        spectatorId,
        this.deadlineKey(this.effectiveDeadline(state, viewer)),
      );
    }
    this.baselineSent.add(spectatorId);
  }

  /** 清除旁观者 baseline，强制下次 broadcastNewState 重发 initialView。
   *  在授权变更（approve/revoke）时调用，确保旁观者获得新 viewer 的完整视图。 */
  clearSpectatorBaseline(spectatorId: string): void {
    this.baselineSent.delete(spectatorId);
    this.lastSentDeadline.delete(spectatorId);
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
    // seatIndex = 游戏 view 的 player 下标(playerNames 语义),供前端定位离线座位
    const seatIndex = this.playerNames.get(playerId) ?? -1;
    this.broadcast({
      type: 'player_disconnected',
      playerId,
      seatIndex,
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

/** 判断是否所有玩家都已断线。
 *  用 playerNames.size(座次总数)而非 room.players.size:因为 sse.ts 的 onAbort
 *  会先 room.players.delete(playerId) 再调 handleDisconnect,此时 room.players 已缩小,
 *  最后一人断线时 room.players.size=0 会误判为「无玩家」而非「全员断线」。 */
  private allPlayersDisconnected(): boolean {
    if (this.playerNames.size === 0) return false;
    return this.disconnectedAt.size >= this.playerNames.size;
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
    // 记录中断历史(已在 handleGameOver 记录过的不再重复记)
    if (!this.gameOverHandled) this.recordGameHistory(undefined, '中断');
    this.broadcast({ type: 'error', message: `${names} 在重连宽限期内未恢复,游戏结束` });
    this.broadcast({ type: 'gameOver', winner: '无人' });
    // 必须 destroy 以清理 idle timer，否则定时器会通过 onStateChange 自循环
    void this.destroy().catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error('destroy after disconnect failed', { error: e.stack ?? String(e) });
    });
  }

  /** 差量重连判定:lastSeq 落在可回溯窗口内(未被裁剪、不超过当前 seq、
   *  缺口不超过 DIFF_RECONNECT_THRESHOLD)时可差量补发,否则回退全量快照。 */
  private canServeDifferential(lastSeq: number): boolean {
    return (
      lastSeq > 0 &&
      lastSeq > this.trimmedFloorSeq &&
      this.state !== null &&
      lastSeq <= this.state.seq &&
      this.state.seq - lastSeq <= DIFF_RECONNECT_THRESHOLD
    );
  }

  /** 玩家重连:恢复座位并发送当前完整 state(或小差量补发)。
   *  multiplayer 模式:新 WS 连接的 playerId 与断线前不同(服务端 onOpen 自动生成),
   *  需通过 previousPlayerId 迁移座次映射(旧 playerId → 新 playerId)。
   *  debug 模式:不传 previousPlayerId,assignDebugSeat 已完成座次分配。
   *  lastSeq 来自 SSE Last-Event-ID(经 epoch 校验):窗口内差量补发 event,
   *  否则发 initialView 全量快照。 */
  reconnectPlayer(
    playerId: string,
    sink: import('./connection').ConnectionSink,
    lastSeq = 0,
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
    this.room.players.set(playerId, sink);
    const viewer = this.playerNames.get(playerId);
    const differential =
      this.canServeDifferential(lastSeq) &&
      viewer !== undefined &&
      viewer >= 0 &&
      viewer < this.state.players.length;
    if (differential) {
      this.sendEventEnvelopes(playerId, viewer, this.state, eventsForViewer(this.state, viewer, lastSeq));
    } else {
      this.sendInitialViewToPlayer(playerId);
    }
    this.baselineSent.add(playerId);
    // initialView/diff 已覆盖到当前 seq,不需要补推差量。
    // 同步水位标记,避免后续 broadcastNewState 重发已含在 initialView 中的事件。
    this.lastBroadcastSeq = Math.max(this.lastBroadcastSeq, this.state.seq);
    const reconSeatIndex = this.playerNames.get(playerId) ?? -1;
    this.broadcast({ type: 'player_reconnected', playerId, seatIndex: reconSeatIndex });
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
    // 无在线玩家的房间(如启动恢复的僵尸房间)不持久化:
    // pending slot 定时器触发的自动操作会反复重写文件(每次更新 mtime),
    // 导致 restorePersistedRooms 的过期检查永远失效,房间删不掉。
    if (this.room.players.size === 0) return;
    const state = this.state;
    void saveRoom(
      this.room.id,
      {
        roomName: this.roomName,
        maxPlayers: this.maxPlayers,
        hostId: this.room.hostId,
        debug: this.debug,
        seats: this.room.seats,
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
    const sink = this.room.players.get(playerId) ?? this.room.spectators.get(playerId);
    if (!sink) return;
    try {
      sink.send(message);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`sendToPlayer failed for ${playerId}`, { error: e.stack ?? String(e) });
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const [, sink] of this.room.players) {
      try {
        sink.send(message);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.logger.error('broadcast send failed', { error: e.stack ?? String(e) });
      }
    }
    // 旁观者也接收广播
    for (const [, sink] of this.room.spectators) {
      try {
        sink.send(message);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.logger.error('broadcast send to spectator failed', { error: e.stack ?? String(e) });
      }
    }
  }
}
