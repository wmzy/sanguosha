// src/client/headless/HeadlessGameClient.ts
// 单座次无头玩家客户端。框架无关（零 React 依赖）。
// 传输层：REST（C→S 命令）+ SSE（S→C 事件流）。
// 浏览器用全局 EventSource；Node 环境（无全局 EventSource）惰性 import eventsource 包。
import type {
  GameView,
  ViewEvent,
  Json,
  ClientMessage as EngineClientMessage,
} from '../../engine/types';
import type { ServerMessage, RoomConfig } from '../../server/protocol';
import { applyServerMessage, mergeRoomConfig } from './viewMaintainer';
import { enumerateAvailableActions, appendRespondActions } from './availableActions';
import { resolvePendingRespond } from '../utils/pendingRespond';
import { decideAutoSkip, DEFAULT_PREFS, type AutoSkipPrefs } from '../utils/autoSkip';
import { getActionsForPlayer, registerSkillActions } from '../skillActionRegistry';
import type { ClientPhase, HeadlessCallbacks, AvailableAction, RoomState, ReconnectState } from './types';

/** 程序化客户端认证选项。
 *  - token: 已有会话 token(优先,直接复用)
 *  - username/password: 自动账号——无 token 时注册(已存在则登录)换取 token。
 *  浏览器(真实用户)不传 auth:Cookie 会话自动携带。 */
export interface HeadlessAuthOptions {
  token?: string;
  username?: string;
  password?: string;
}

export class HeadlessGameClient {
  private eventSource: EventSource | null = null;
  private _view: GameView | null = null;
  private _lastSeq = 0;
  private _phase: ClientPhase = 'connecting';
  private _playerId: string | null = null;
  private _seatIndex = 0;
  private _roomId: string | null = null;
  private _roomState: RoomState | null = null;
  private _gameOverWinner: string | null = null;
  private _pendingNewEvents: ViewEvent[] = [];
  /** 最近一次 action 是否被服务端拒（供 runPlay 轮询）。每次 sendAction 重置。 */
  private _lastActionRejected = false;
  /** 本客户端已 skip 的广播窗口 deadline;同一窗口内 needsAction 返回 false,
   *  避免 MCP agent 对已放弃的无懈窗口反复提交 skip(rejected/空转)。 */
  private _skippedBroadcastDeadline: number | null = null;
  private readonly callbacks: HeadlessCallbacks;
  /** REST/SSE base URL，如 'http://localhost:3930'（无 /ws 后缀） */
  private readonly baseUrl: string;

  // ── 重连机制 ──
  /** 主动断开标记:disconnect() 设为 true,不触发重连 */
  private intentionalDisconnect = false;
  /** 作废旧建房/加入请求及其后续回调，避免离开或换房后迟到响应复活连接。 */
  private connectionGeneration = 0;

  private isCurrentConnection(generation: number): boolean {
    return generation === this.connectionGeneration && !this.intentionalDisconnect;
  }

  private beginConnection(debugMode: boolean): number {
    this.disconnect();
    this.intentionalDisconnect = false;
    this._debugMode = debugMode;
    return this.connectionGeneration;
  }

  /** 当前重连状态 */
  private _reconnectState: ReconnectState = 'idle';
  /** 是否为 debug 模式(影响连接方式) */
  private _debugMode = false;
  /** 是否为旁观者 */
  private _isSpectator = false;
  /** 已收到 room_joined,具备 SSE 连接上下文 */
  private canReconnect = false;
  /** 重连状态轮询定时器 */
  private reconnectStateTimer: ReturnType<typeof setInterval> | null = null;
  /** SSE onopen 回调已触发（用于状态映射） */
  private sseConnected = false;
  /** 已自动跳过的 pending deadline(去重,避免对同一窗口重复发 skip) */
  private _autoSkippedDeadline: number | null = null;
  /** 自动跳过用户偏好(策略跳过开关)。AI 座次默认空(仅维度1强制生效)。 */
  private _autoSkipPrefs: AutoSkipPrefs = DEFAULT_PREFS;
  /** 延迟自动跳过定时器(view 推进到新窗口时清理,避免旧 skip 误作用于新 pending)。 */
  private _autoSkipTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(serverUrl: string, callbacks: HeadlessCallbacks = {}, auth?: HeadlessAuthOptions) {
    // 兼容旧 WS URL：ws://→http://, wss://→https://, 去掉 /ws 后缀
    let url = serverUrl;
    if (url.startsWith('ws://')) url = `http://${  url.slice(5)}`;
    else if (url.startsWith('wss://')) url = `https://${  url.slice(6)}`;
    if (url.endsWith('/ws')) url = url.slice(0, -3);
    this.baseUrl = url;
    this.callbacks = callbacks;
    this.auth = auth ?? null;
  }

  /** 程序化认证配置(可选;浏览器走 Cookie)。 */
  private auth: HeadlessAuthOptions | null = null;
  /** 已解析的会话 token(ensureAuth 后有值)。 */
  private authToken: string | null = null;
  private authInitPromise: Promise<void> | null = null;

  get phase(): ClientPhase {
    return this._phase;
  }

  get view(): GameView | null {
    return this._view;
  }

  get roomId(): string | null {
    return this._roomId;
  }

  get playerId(): string | null {
    return this._playerId;
  }

  get seatIndex(): number {
    return this._seatIndex;
  }

  get lastSeq(): number {
    return this._lastSeq;
  }

  get roomState(): RoomState | null {
    return this._roomState;
  }

  get gameOverWinner(): string | null {
    return this._gameOverWinner;
  }

  /** 是否为旁观者 */
  get isSpectator(): boolean {
    return this._isSpectator;
  }

  /** 当前重连状态(idle/reconnecting/failed) */
  get reconnectState(): ReconnectState {
    return this._reconnectState;
  }

  /** 当前重连尝试次数(0=未在重连) */
  get reconnectAttemptCount(): number {
    // EventSource 自动重连，不暴露尝试次数；返回 0/1 映射
    return this._reconnectState === 'reconnecting' ? 1 : 0;
  }

  private setPhase(p: ClientPhase) {
    if (this._phase !== p) {
      this._phase = p;
      this.callbacks.onPhaseChange?.(p);
    }
  }

  /** 统一的身份变更入口:更新 roomId/playerId/isSpectator,任一实际变化时触发
   *  onIdentityChange 回调(事件驱动,替代宿主轮询 getter)。未传的字段不动。 */
  private updateIdentity(next: {
    roomId?: string | null;
    playerId?: string | null;
    isSpectator?: boolean;
  }): void {
    const changed =
      (next.roomId !== undefined && next.roomId !== this._roomId) ||
      (next.playerId !== undefined && next.playerId !== this._playerId) ||
      (next.isSpectator !== undefined && next.isSpectator !== this._isSpectator);
    if (next.roomId !== undefined) this._roomId = next.roomId;
    if (next.playerId !== undefined) this._playerId = next.playerId;
    if (next.isSpectator !== undefined) this._isSpectator = next.isSpectator;
    if (changed) {
      this.callbacks.onIdentityChange?.({
        roomId: this._roomId,
        playerId: this._playerId,
        isSpectator: this._isSpectator,
      });
    }
  }

  /** 检查 REST 响应是否成功，失败时抛出带 status 的错误 */
  private async assertOk(resp: Response, fallbackMsg: string): Promise<void> {
    if (!resp.ok) throw await this.requestError(resp, fallbackMsg);
  }

  /** 程序化认证:换取/复用会话 token(幂等,并发安全)。
   *  无 auth 配置时同步短路(不引入微任务,保持浏览器场景 createRoom 同步发出 fetch)。 */
  private ensureAuth(): Promise<void> {
    if (!this.auth || this.authToken) return Promise.resolve();
    this.authInitPromise ??= (async () => {
      const { username, password, token } = this.auth!;
      if (token) {
        this.authToken = token;
        return;
      }
      if (!username || !password) {
        throw new Error('auth 配置不完整:需要 token 或 username/password');
      }
      // 注册(新账号);「用户名已存在」时回退登录
      const authOnce = async (path: 'register' | 'login'): Promise<void> => {
        const resp = await fetch(`${this.baseUrl}/api/auth/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const body = (await resp.json().catch(() => ({}))) as { token?: string; error?: string };
        if (!resp.ok || !body.token) {
          throw new Error(body.error ?? `认证失败(${resp.status})`);
        }
        this.authToken = body.token;
      };
      try {
        await authOnce('register');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/已存在/.test(msg)) throw err;
        await authOnce('login');
      }
    })().catch((err) => {
      this.authInitPromise = null;
      // 建房/加入的 Promise 是认证错误的唯一通道，避免宿主 catch 与 onError 重复提示。
      throw err instanceof Error ? err : new Error(String(err));
    });
    return this.authInitPromise;
  }

  /** 带 auth 头的 fetch(有 token 时)。浏览器无 token 时保留 Cookie 行为。 */
  private authFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (this.authToken) headers.set('Authorization', `Bearer ${this.authToken}`);
    return fetch(url, { ...init, headers });
  }

  /** 读取 HTTP 错误并构造可观测错误。 */
  private async requestError(resp: Response, fallbackMsg: string): Promise<Error & { status: number }> {
    const body = await resp.json().catch(() => ({}));
    const message = (body as { error?: string }).error ?? fallbackMsg;
    const err = new Error(message) as Error & { status: number };
    err.status = resp.status;
    return err;
  }

  /** 上报 REST 错误；action 还要标记 rejected，供 runPlay 不再等待 SSE。 */
  private reportRequestError(err: Error, rejected = false): void {
    if (rejected) {
      this._lastActionRejected = true;
      this.callbacks.onActionRejected?.();
    }
    this.callbacks.onError?.(err);
  }

  /** 房间命令只在当前连接上生效；HTTP/网络错误统一上报一次。 */
  private async requestRoom(
    op: string,
    fallbackMsg: string,
    body: Record<string, unknown> = {},
    method = 'POST',
    rejected = false,
  ): Promise<Response | null> {
    if (!this._roomId || !this._playerId || this.intentionalDisconnect) return null;
    const generation = this.connectionGeneration;
    try {
      const resp = await this.authFetch(`${this.baseUrl}/api/rooms/${this._roomId}/${op}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this._playerId, ...body }),
      });
      if (!this.isCurrentConnection(generation)) return null;
      await this.assertOk(resp, fallbackMsg);
      return this.isCurrentConnection(generation) ? resp : null;
    } catch (err) {
      if (this.isCurrentConnection(generation)) {
        this.reportRequestError(err instanceof Error ? err : new Error(String(err)), rejected);
      }
      return null;
    }
  }

  /** 创建 debug 房间并自动 join 0 号座。
   *  playerId 可选:指定则用作本座次身份,否则由服务端自动生成。 */
  async createDebugRoom(playerCount: number, config?: RoomConfig, playerId?: string): Promise<void> {
    const generation = this.beginConnection(true);

    const resp = await fetch(`${this.baseUrl}/api/debug-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerCount, config, autoJoin: true, playerId }),
    });
    if (!this.isCurrentConnection(generation)) return;
    await this.assertOk(resp, '创建调试房间失败');
    const data = await resp.json() as { roomId: string; playerId: string; seatIndex: number };
    if (!this.isCurrentConnection(generation)) return;
    this._seatIndex = data.seatIndex;
    this.updateIdentity({ roomId: data.roomId, playerId: data.playerId, isSpectator: false });
    this.canReconnect = true;

    this.openStream();
    this.setPhase('lobby');
  }

  /** 连接并 join 指定房间。
   *  playerId 可选:指定则预先设置本连接身份(透传到 join 请求体),否则复用已有或由服务端生成。
   *  opts.stream 默认 true(join 后立即打开 SSE);debug 单活流模式对非当前视角座次
   *  传 false——浏览器对同源 HTTP/1.1 有 6 连接上限,N 条长连 SSE 会饿死页面上的
   *  图片/请求,非当前视角座次只做 REST 驱动,不持有流。 */
  async connect(roomId: string, seatIndex?: number, playerId?: string, opts?: { stream?: boolean }): Promise<void> {
    const generation = this.beginConnection(true);
    this._seatIndex = seatIndex ?? this._seatIndex;
    this.updateIdentity({ roomId, playerId: playerId ?? undefined, isSpectator: false });

    const resp = await fetch(`${this.baseUrl}/api/debug-room/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: this._playerId ?? undefined, lastSeq: this._lastSeq }),
    });
    if (!this.isCurrentConnection(generation)) return;
    await this.assertOk(resp, '加入调试房间失败');
    const data = await resp.json() as { roomId: string; playerId: string; seatIndex: number };
    if (!this.isCurrentConnection(generation)) return;
    this._seatIndex = data.seatIndex;
    this.updateIdentity({ roomId: data.roomId, playerId: data.playerId });
    this.canReconnect = true;

    if (opts?.stream !== false) this.openStream();
    this.setPhase('lobby');
  }

  /** 创建普通(多人)房间:本连接成为房主。roomType: 'normal'=持久化, 'quick'=纯内存(默认)。 */
  async createRoom(name: string, maxPlayers: number, config?: RoomConfig, playerId?: string, roomType?: 'normal' | 'quick', password?: string): Promise<void> {
    const generation = this.beginConnection(false);
    if (this.auth) await this.ensureAuth();
    if (!this.isCurrentConnection(generation)) return;

    const resp = await this.authFetch(`${this.baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, maxPlayers, config, playerId, roomType, password: password ?? undefined }),
    });
    if (!this.isCurrentConnection(generation)) return;
    await this.assertOk(resp, '创建房间失败');
    const data = await resp.json() as { roomId: string; playerId: string };
    if (!this.isCurrentConnection(generation)) return;
    this.updateIdentity({ roomId: data.roomId, playerId: data.playerId, isSpectator: false });
    this.canReconnect = true;

    this.openStream();
    this.setPhase('lobby');
  }

  /** 加入普通(多人)房间。password: 有密码房间必填(错误时服务端 403 ROOM_PASSWORD_REQUIRED)。 */
  async joinRoom(roomId: string, playerId?: string, password?: string): Promise<void> {
    const generation = this.beginConnection(false);
    this.updateIdentity({ roomId, isSpectator: false });
    if (this.auth) await this.ensureAuth();
    if (!this.isCurrentConnection(generation)) return;

    const resp = await this.authFetch(`${this.baseUrl}/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, password: password ?? undefined }),
    });
    if (!this.isCurrentConnection(generation)) return;
    await this.assertOk(resp, '加入房间失败');
    const data = await resp.json() as { roomId: string; playerId: string };
    if (!this.isCurrentConnection(generation)) return;
    this.updateIdentity({ roomId: data.roomId, playerId: data.playerId, isSpectator: false });
    this.canReconnect = true;

    this.openStream();
  }

  /** 以旁观者身份加入房间。不占座次，默认看公开视图。 */
  async joinAsSpectator(roomId: string, playerId?: string, password?: string): Promise<void> {
    const generation = this.beginConnection(false);
    this.updateIdentity({ roomId });
    if (this.auth) await this.ensureAuth();
    if (!this.isCurrentConnection(generation)) return;

    const resp = await this.authFetch(`${this.baseUrl}/api/rooms/${roomId}/join-spectator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, password: password ?? undefined }),
    });
    if (!this.isCurrentConnection(generation)) return;
    await this.assertOk(resp, '加入旁观失败');
    const data = await resp.json() as { roomId: string; playerId: string };
    if (!this.isCurrentConnection(generation)) return;
    this.updateIdentity({ roomId: data.roomId, playerId: data.playerId, isSpectator: true });
    this.canReconnect = true;

    this.openStream();
    this.setPhase('lobby');
  }

  /** 建立 SSE 流接收服务端推送。
   *  程序化客户端(EventSource 无法带自定义头)把会话 token 放 ?sgs_token=;
   *  浏览器走 Cookie。 */
  private openStream() {
    if (this.intentionalDisconnect) return;
    const generation = ++this.openStreamGeneration;
    void this.ensureEventSource().then((EventSourceImpl) => {
      // 挂起/断开后迟到的 open 回调:不再创建流(否则挂起的座次"复活"出孤儿连接)
      if (generation !== this.openStreamGeneration) return;
      if (this.intentionalDisconnect || !this._roomId || !this._playerId) return;
      let url = `${this.baseUrl}/api/rooms/${this._roomId}/stream?playerId=${encodeURIComponent(this._playerId)}`;
      if (this.authToken) url += `&sgs_token=${encodeURIComponent(this.authToken)}`;
      this.eventSource = new EventSourceImpl(url);
      this.attachEventSourceHandlers();
    });
  }

  /** 开流代数:每次 open/suspend/disconnect 递增,作废在途的异步创建。 */
  private openStreamGeneration = 0;

  /** 获取 EventSource 构造器：浏览器用全局，Node 动态 import eventsource 包 */
  private async ensureEventSource(): Promise<typeof EventSource> {
    if (typeof globalThis.EventSource !== 'undefined') {
      return globalThis.EventSource;
    }
    // Node 环境无全局 EventSource，惰性 import
    const mod = await import('eventsource');
    return mod.EventSource;
  }

  private attachEventSourceHandlers(): void {
    const source = this.eventSource;
    if (!source) return;
    const isCurrent = () => this.eventSource === source && !this.intentionalDisconnect;
    this.sseConnected = false;

    source.onopen = () => {
      if (!isCurrent()) return;
      this.sseConnected = true;
      this.setReconnectState('idle');
    };

    source.onmessage = (ev) => {
      if (!isCurrent()) return;
      this.handleRaw(ev.data);
    };

    source.onerror = () => {
      if (!isCurrent()) return;
      this.sseConnected = false;
      // EventSource 自动重连——映射为 reconnecting 状态
      if (this.canReconnect) {
        this.setReconnectState('reconnecting');
        // EventSource 自带重连，但我们无法知道具体尝试次数
        // 通过轮询 readyState 来检测恢复
        this.startReconnectStatePolling();
      }
    };
  }

  /** 轮询 EventSource.readyState 检测重连恢复 */
  private startReconnectStatePolling(): void {
    if (this.reconnectStateTimer) return;
    this.reconnectStateTimer = setInterval(() => {
      if (!this.eventSource) {
        this.stopReconnectStatePolling();
        return;
      }
      // 0=connecting, 1=open, 2=closed
      if (this.eventSource.readyState === 1) {
        this.stopReconnectStatePolling();
        this.setReconnectState('idle');
      } else if (this.eventSource.readyState === 2) {
        // closed — EventSource 放弃重连（达到浏览器内部限制）
        this.stopReconnectStatePolling();
        this.setReconnectState('failed');
      }
    }, 500);
  }

  private stopReconnectStatePolling(): void {
    if (this.reconnectStateTimer) {
      clearInterval(this.reconnectStateTimer);
      this.reconnectStateTimer = null;
    }
  }

  private setReconnectState(state: ReconnectState): void {
    if (this._reconnectState !== state) {
      this._reconnectState = state;
      this.callbacks.onReconnectStateChange?.(state, this.reconnectAttemptCount);
    }
  }

  /** 用户手动取消重连。关闭正在重连的 EventSource。 */
  cancelReconnect(): void {
    this.stopReconnectStatePolling();
    if (this._reconnectState === 'reconnecting' && this.eventSource) {
      this.intentionalDisconnect = true;
      this.eventSource.close();
      this.eventSource = null;
    }
    this.setReconnectState('idle');
  }

  private handleRaw(raw: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    // 重连后收到任意消息:标记重连成功
    if (this._reconnectState === 'reconnecting') {
      this.stopReconnectStatePolling();
      this.setReconnectState('idle');
    }
    const r = applyServerMessage(this._view, this._lastSeq, msg);
    const viewChanged = this._view !== r.view;
    this._view = r.view;
    this._lastSeq = r.lastSeq;
    // onView: view 变化即触发（initialView baseline 或增量 event 后），不止于 newEvents 非空
    if (viewChanged && this._view) {
      if (r.newEvents.length) this._pendingNewEvents.push(...r.newEvents);
      this.callbacks.onView?.(this._view, r.newEvents);
    } else if (r.newEvents.length) {
      this._pendingNewEvents.push(...r.newEvents);
    }
    if (r.phaseChangedTo) this.setPhase(r.phaseChangedTo);
    if (r.gameOverWinner !== undefined) {
      this._gameOverWinner = r.gameOverWinner;
      this.callbacks.onGameOver?.(r.gameOverWinner);
    }
    if (r.playerId || r.roomId) {
      this.updateIdentity({ playerId: r.playerId ?? undefined, roomId: r.roomId ?? undefined });
    }
    if (r.seatIndex !== undefined) this._seatIndex = r.seatIndex;
    // room_joined 表示已成功加入房间,具备重连上下文
    if (msg.type === 'room_joined') {
      this.canReconnect = true;
    }
    if (r.roomState) {
      this._roomState = r.roomState;
      this.callbacks.onRoomState?.(r.roomState);
    }
    // room_config 增量：viewMaintainer 交由调用方合并
    if (msg.type === 'room_config') {
      this._roomState = mergeRoomConfig(this._roomState, msg.config);
      this.callbacks.onRoomState?.(this._roomState);
    }
    if (r.resetToLobby) {
      this._view = null;
      this._lastSeq = 0;
      this._gameOverWinner = null;
      this._pendingNewEvents = [];
      this._autoSkippedDeadline = null;
      if (this._autoSkipTimer) { clearTimeout(this._autoSkipTimer); this._autoSkipTimer = null; }
    }
    // 自动跳过决策(无法响应/策略跳过时代发 skip)
    if (viewChanged && this._view) {
      this.maybeAutoSkipBroadcast();
    }
    if (r.actionRejected) {
      this._lastActionRejected = true;
      this.callbacks.onActionRejected?.();
    }
    // 聊天消息处理
    if (msg.type === 'chat') {
      this.callbacks.onChat?.([{
        playerId: msg.playerId,
        seatIndex: msg.seatIndex,
        text: msg.text,
        timestamp: msg.timestamp,
      }], 'chat');
    } else if (msg.type === 'chat_history') {
      this.callbacks.onChat?.(msg.messages, 'history');
    }
    // 身份切换（player↔spectator）：更新本地 isSpectator 标志。
    // 服务端 switchRole 仅在等待中广播 role_changed；切换后后续消息自动修正座次/视图。
    if (msg.type === 'role_changed' && msg.playerId === this._playerId) {
      this.updateIdentity({ isSpectator: msg.newRole === 'spectator' });
      if (this._isSpectator) this._seatIndex = -1;
    }
    this.callbacks.onMessage?.(msg);
  }

  drainNewEvents(): ViewEvent[] {
    const e = this._pendingNewEvents;
    this._pendingNewEvents = [];
    return e;
  }

  needsAction(): boolean {
    const v = this._view;
    if (!v?.pending) {
      this._skippedBroadcastDeadline = null;
      return false;
    }
    const p = v.pending;
    if (p.target < 0) {
      // 广播型（无懈可击等）：已对同一窗口 skip 过则不再要求本客户端行动，
      // 等窗口 resolve / 换成新窗口（deadline 变化）再重新参与。
      if (this._skippedBroadcastDeadline !== null) {
        const deadline = p.deadline ?? -1;
        if (deadline === this._skippedBroadcastDeadline) return false;
        this._skippedBroadcastDeadline = null;
      }
      return true;
    }
    this._skippedBroadcastDeadline = null;
    if (p.target !== this._seatIndex) {
      // debug 模式下其他座次的阻塞型 pending：仅在无独立 AI 代理时由当前 viewer 代管。
      // 多 AI 实例同进 debug 房时，各实例只应响应自己座次的 pending；
      // 否则会为不可见手牌的座次生成无效弃牌/出牌动作，导致死锁。
      // 保守策略：不代管其他座次的 pending，由该座次自身的 AI 实例响应。
      return false;
    }
    // 卡牌回应 silent 模式(target 有手牌但无匹配牌):不被询问,不生成 skip/respond action,
    // 让短延时 slot 自然超时(避免 AI 提前 skip 绕过延时)。
    if (p.responseMode === 'silent') return false;
    // 阻塞型 pending：必须回应
    if (p.isBlocking !== false) return true;
    // 非阻塞型 pending：出牌阶段的出牌窗口需要 AI 行动（可出牌或结束回合）
    return v.phase === '出牌';
  }

  getAvailableActions(): AvailableAction[] {
    const v = this._view;
    if (!v) return [];
    // debug 模式:pending 可能属于其他座次,用 pending.target 作为操作座次
    const actionSeat = this._debugMode && v.pending && v.pending.target >= 0
      ? v.pending.target
      : this._seatIndex;
    const skillActions = getActionsForPlayer(actionSeat);
    const actions = enumerateAvailableActions(v, actionSeat, skillActions);
    // 追加 respond/discard 类（pending 驱动；枚举策略已迁入 availableActions,纯函数）
    if (v.pending && (v.pending.target === actionSeat || v.pending.target < 0)) {
      appendRespondActions(v, skillActions, actions, actionSeat);
    }
    return actions;
  }

  // ── 操作 ──

  sendAction(action: EngineClientMessage): void {
    this._lastActionRejected = false;
    // 阻塞型 pending 期间 respond 携带 pendingSeq（当前窗口 seq），非阻塞（出牌窗口）不带
    const pending = this._view?.pending;
    if (action.skillId === '__skip' && pending && pending.target < 0) {
      this._skippedBroadcastDeadline = pending.deadline ?? -1;
    }
    const pendingSeq = pending?.isBlocking ? this._lastSeq : undefined;
    const fullAction = { ...action, baseSeq: this._lastSeq, pendingSeq };
    void this.postAction(fullAction);
  }

  /** POST action 到服务端 */
  private async postAction(action: EngineClientMessage): Promise<void> {
    await this.requestRoom('action', '操作失败', { action }, 'POST', true);
  }

  /** 返回并清除最近一次 action 是否被服务端拒（供 runPlay 轮询，已拒则报告 rejected）。 */
  consumeActionRejected(): boolean {
    const r = this._lastActionRejected;
    this._lastActionRejected = false;
    return r;
  }

  /** 重排手牌 */
  async reorderHand(order: string[]): Promise<void> {
    await this.requestRoom('reorder', '重排手牌失败', { order });
  }

  useCardAndTarget(skillId: string, cardId: string, targets: number[]): void {
    this.sendAction({
      skillId,
      actionType: 'use',
      ownerId: this._seatIndex,
      params: { cardId, targets },
      baseSeq: 0,
    });
  }

  useCard(skillId: string, cardId: string): void {
    this.sendAction({
      skillId,
      actionType: 'use',
      ownerId: this._seatIndex,
      params: { cardId },
      baseSeq: 0,
    });
  }

  respond(skillId: string, params?: Record<string, Json>): void {
    this.sendAction({
      skillId,
      actionType: 'respond',
      ownerId: this._seatIndex,
      params: params ?? {},
      baseSeq: 0,
    });
  }

  /** 选择武将（对应选将询问 pending）。引擎注册 系统规则:选将。 */
  selectCharacter(character: string): void {
    this.sendAction({
      skillId: '系统规则',
      actionType: '选将',
      ownerId: this._seatIndex,
      params: { character },
      baseSeq: 0,
    });
  }

  /** 弃牌：提交要弃的 cardIds。引擎注册 系统规则:respond。 */
  discard(cardIds: string[]): void {
    this.respond('系统规则', { cardIds });
  }

  /** 放弃当前 pending（不回应）：广播型/阻塞型发 skip 触发超时，出牌窗口发空 respond。 */
  pass(): void {
    const pending = this._view?.pending;
    // 广播型 pending（无懈可击等）：发 skip 而非 respond
    if (pending && pending.target < 0) {
      this.sendAction({
        skillId: '__skip',
        actionType: 'skip',
        ownerId: this._seatIndex,
        params: {},
        baseSeq: 0,
      });
      return;
    }
    // 阻塞型 pending（询问闪/弃牌等）：也发 skip 触发超时
    if (pending && pending.isBlocking !== false) {
      this.sendAction({
        skillId: '__skip',
        actionType: 'skip',
        ownerId: this._seatIndex,
        params: {},
        baseSeq: 0,
      });
      return;
    }
    // 非阻塞型 pending（出牌窗口）：旧逻辑保留（发 respond 会被 reject，但出牌窗口不应调 pass）
    const info = pending
      ? resolvePendingRespond(pending, getActionsForPlayer(this._seatIndex))
      : null;
    const skillId = info?.skillId ?? '__pass';
    this.sendAction({
      skillId,
      actionType: 'respond',
      ownerId: this._seatIndex,
      params: {},
      baseSeq: 0,
    });
  }

  /** 自动跳过决策:本座次无法响应 pending(或用户开启策略跳过)时代发 skip。
   *  维度1(强制):无法响应时自动跳过,防恶意拖延。空手牌立即,有手牌随机延迟防泄露。
   *  维度2(可选):用户开启策略跳过时,无论能否响应都延迟跳过。
   *  以 pending.deadline 去重,同一窗口只跳一次。仅在非旁观者座次生效。 */
  private maybeAutoSkipBroadcast(): void {
    if (this._isSpectator) return;
    // 清理上一个未触发的延迟 skip(防串扰:view 已推进到新 pending,旧 skip 不应再发)
    if (this._autoSkipTimer) { clearTimeout(this._autoSkipTimer); this._autoSkipTimer = null; }
    const view = this._view;
    const pending = view?.pending;
    if (!pending) return;
    // 去重:同一窗口(deadline)只决策一次
    const deadline = pending.deadline ?? 0;
    if (deadline === this._autoSkippedDeadline) return;
    // canRespond:是否有非 skip 的可操作 action(含转化技)
    const actions = this.getAvailableActions();
    const canRespond = actions.some((a) => a.category !== 'skip');
    const handCount = view.players[this._seatIndex]?.handCount ?? 0;
    const decision = decideAutoSkip({
      pending,
      canRespond,
      handCount,
      prefs: this._autoSkipPrefs,
    });
    if (decision.kind === 'wait') return;
    this._autoSkippedDeadline = deadline;
    if (decision.kind === 'act-now') {
      this.pass();
    } else {
      // act-delayed:随机延迟后发 skip(防手牌信息泄露)。
      // 触发前校验窗口未变(deadline 一致):延迟期间 view 可能推进到新 pending(如杀问询),
      // 旧 skip 不得误作用于新窗口——pass() 用实时 _lastSeq 作 pendingSeq 会命中新 slot。
      this._autoSkipTimer = setTimeout(() => {
        this._autoSkipTimer = null;
        const cur = this._view?.pending;
        if (!cur || (cur.deadline ?? 0) !== deadline) return;
        this.pass();
      }, decision.ms);
    }
  }

  /** 设置自动跳过用户偏好(策略跳过开关)。 */
  setAutoSkipPrefs(prefs: AutoSkipPrefs): void {
    this._autoSkipPrefs = prefs;
  }

  // ── 大厅 ──

  async sendReady(): Promise<void> {
    await this.postRoomOp('ready');
  }

  async sendCancelReady(): Promise<void> {
    await this.postRoomOp('cancel-ready');
  }

  async sendStartGame(): Promise<void> {
    await this.postRoomOp('start');
  }

  async sendRestart(): Promise<void> {
    await this.postRoomOp('restart');
  }

  /** 发送聊天消息 */
  async sendChat(text: string): Promise<{ remaining?: number | null } | null> {
    const generation = this.connectionGeneration;
    const resp = await this.requestRoom('chat', '发送失败', { text });
    if (!resp) return null;
    const data = await resp.json().catch(() => ({})) as { remaining?: number | null };
    return this.isCurrentConnection(generation) ? { remaining: data.remaining } : null;
  }

  async sendUpdateConfig(config: RoomConfig, maxPlayers?: number): Promise<void> {
    await this.requestRoom('config', '更新配置失败', { config, maxPlayers }, 'PUT');
  }

  /** POST 通用房间操作（ready/start/restart） */
  private async postRoomOp(op: string): Promise<void> {
    await this.requestRoom(op, `${op} 失败`);
  }

  /** 挂起 SSE 流(不离开房间、不清理身份/视图状态):debug 单活流模式用。
   *  与 disconnect() 的区别:保留 canReconnect/identity/lastSeq,可 resumeStream() 原地恢复。 */
  suspendStream() {
    this.stopReconnectStatePolling();
    // 递增代数:作废在途的 ensureEventSource().then,防止挂起后迟到的新流"复活"
    this.openStreamGeneration++;
    this.eventSource?.close();
    this.eventSource = null;
    this.sseConnected = false;
  }

  /** 恢复 SSE 流:新 EventSource 首次请求无 Last-Event-ID,
   *  服务端按 lastSeq=0 回 initialView 全量快照,视图自动对齐。 */
  resumeStream() {
    if (this.intentionalDisconnect || !this._roomId || !this._playerId) return;
    if (this.eventSource) return;
    this.openStream();
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this.connectionGeneration++;
    this.openStreamGeneration++;
    this.stopReconnectStatePolling();
    this.canReconnect = false;
    if (this._autoSkipTimer) {
      clearTimeout(this._autoSkipTimer);
      this._autoSkipTimer = null;
    }
    this.eventSource?.close();
    this.eventSource = null;
  }

  /** 角色确定后，为本座次注册技能 actions（供 getAvailableActions）。 */
  async loadSkillActions(skillIds: string[], seatIndex?: number): Promise<void> {
    await registerSkillActions(seatIndex ?? this._seatIndex, skillIds);
  }
}
