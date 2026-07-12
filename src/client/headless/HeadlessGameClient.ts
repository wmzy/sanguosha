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
import { enumerateAvailableActions } from './availableActions';
import { resolvePendingRespond, getPendingRequestType } from '../utils/pendingRespond';
import { getActionsForPlayer, registerSkillActions } from '../skillActionRegistry';
import type { ClientPhase, HeadlessCallbacks, AvailableAction, RoomState, ReconnectState } from './types';

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
  private readonly callbacks: HeadlessCallbacks;
  /** REST/SSE base URL，如 'http://localhost:3930'（无 /ws 后缀） */
  private readonly baseUrl: string;

  // ── 重连机制 ──
  /** 主动断开标记:disconnect() 设为 true,不触发重连 */
  private intentionalDisconnect = false;
  /** 当前重连状态 */
  private _reconnectState: ReconnectState = 'idle';
  /** 是否为 debug 模式(影响连接方式) */
  private _debugMode = false;
  /** 已收到 room_joined,具备 SSE 连接上下文 */
  private canReconnect = false;
  /** 重连状态轮询定时器 */
  private reconnectStateTimer: ReturnType<typeof setInterval> | null = null;
  /** SSE onopen 回调已触发（用于状态映射） */
  private sseConnected = false;

  constructor(serverUrl: string, callbacks: HeadlessCallbacks = {}) {
    // 兼容旧 WS URL：ws://→http://, wss://→https://, 去掉 /ws 后缀
    let url = serverUrl;
    if (url.startsWith('ws://')) url = `http://${  url.slice(5)}`;
    else if (url.startsWith('wss://')) url = `https://${  url.slice(6)}`;
    if (url.endsWith('/ws')) url = url.slice(0, -3);
    this.baseUrl = url;
    this.callbacks = callbacks;
  }

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

  /** 创建 debug 房间并自动 join 0 号座 */
  async createDebugRoom(playerCount: number, config?: RoomConfig): Promise<void> {
    this._debugMode = true;
    this.intentionalDisconnect = false;

    const resp = await fetch(`${this.baseUrl}/api/debug-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerCount, config, autoJoin: true }),
    });
    const data = await resp.json() as { roomId: string; playerId: string; seatIndex: number };
    this._roomId = data.roomId;
    this._playerId = data.playerId;
    this._seatIndex = data.seatIndex;
    this.canReconnect = true;

    this.openStream();
    this.setPhase('lobby');
  }

  /** 连接并 join 指定房间 */
  async connect(roomId: string, seatIndex?: number): Promise<void> {
    this._debugMode = true;
    this._roomId = roomId;
    this._seatIndex = seatIndex ?? this._seatIndex;
    this.intentionalDisconnect = false;

    const resp = await fetch(`${this.baseUrl}/api/debug-room/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: this._playerId ?? undefined, lastSeq: this._lastSeq }),
    });
    const data = await resp.json() as { roomId: string; playerId: string; seatIndex: number };
    this._roomId = data.roomId;
    this._playerId = data.playerId;
    this._seatIndex = data.seatIndex;
    this.canReconnect = true;

    this.openStream();
  }

  /** 创建普通(多人)房间:本连接成为房主。 */
  async createRoom(name: string, maxPlayers: number, config?: RoomConfig, playerId?: string): Promise<void> {
    this._debugMode = false;
    this.intentionalDisconnect = false;

    const resp = await fetch(`${this.baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, maxPlayers, config, playerId }),
    });
    const data = await resp.json() as { roomId: string; playerId: string };
    this._roomId = data.roomId;
    this._playerId = data.playerId;
    this.canReconnect = true;

    this.openStream();
    this.setPhase('lobby');
  }

  /** 加入普通(多人)房间。 */
  async joinRoom(roomId: string, playerId?: string): Promise<void> {
    this._debugMode = false;
    this._roomId = roomId;
    this.intentionalDisconnect = false;

    const resp = await fetch(`${this.baseUrl}/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    const data = await resp.json() as { roomId: string; playerId: string };
    this._roomId = data.roomId;
    this._playerId = data.playerId;
    this.canReconnect = true;

    this.openStream();
  }

  /** 建立 SSE 流接收服务端推送 */
  private openStream() {
    if (this.intentionalDisconnect) return;
    void this.ensureEventSource().then((EventSourceImpl) => {
      if (this.intentionalDisconnect || !this._roomId || !this._playerId) return;
      const url = `${this.baseUrl}/api/rooms/${this._roomId}/stream?playerId=${this._playerId}`;
      this.eventSource = new EventSourceImpl(url);
      this.attachEventSourceHandlers();
    });
  }

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
    if (!this.eventSource) return;
    this.sseConnected = false;

    this.eventSource.onopen = () => {
      this.sseConnected = true;
      if (this.intentionalDisconnect) {
        this.eventSource?.close();
        return;
      }
      this.setReconnectState('idle');
    };

    this.eventSource.onmessage = (ev) => {
      this.handleRaw(ev.data);
    };

    this.eventSource.onerror = () => {
      this.sseConnected = false;
      if (this.intentionalDisconnect) return;
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
    if (r.playerId) this._playerId = r.playerId;
    if (r.roomId) this._roomId = r.roomId;
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
    }
    if (r.actionRejected) {
      this._lastActionRejected = true;
      this.callbacks.onActionRejected?.();
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
    if (!v?.pending) return false;
    const p = v.pending;
    if (p.target < 0) return true; // 广播型（无懈可击等）
    if (p.target !== this._seatIndex) {
      // debug 模式:单人控制所有座次,其他座次的阻塞型 pending 也需要响应
      if (this._debugMode && p.isBlocking !== false) return true;
      return false; // 别人的 pending
    }
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
    // 追加 respond/discard 类（pending 驱动）
    if (v.pending && (v.pending.target === actionSeat || v.pending.target < 0)) {
      this.appendRespondActions(v, skillActions, actions, actionSeat);
    }
    return actions;
  }

  private appendRespondActions(
    view: GameView,
    skillActions: import('../skillActionRegistry').SkillActionDef[],
    out: AvailableAction[],
    actionSeat?: number,
  ) {
    const ownerId = actionSeat ?? this._seatIndex;
    const pending = view.pending!;
    const atom = pending.atom as {
      type: string;
      candidates?: Array<{ name: string; skills: string[] }>;
      requestType?: string;
    };
    // 选将询问：每个候选武将一个 selectChar action（引擎注册 系统规则:选将）
    if (atom.type === '选将询问' && Array.isArray(atom.candidates)) {
      for (const c of atom.candidates) {
        out.push({
          description: `选择武将【${c.name}】`,
          message: {
            skillId: '系统规则',
            actionType: '选将',
            ownerId,
            params: { character: c.name },
            baseSeq: 0,
          },
          validTargets: [],
          category: 'selectChar',
        });
      }
      return;
    }
    // 广播型 pending（无懈可击等）：添加跳过 action
    if (pending.target < 0) {
      out.push({
        description: '跳过（不打出无懈可击）',
        message: {
          skillId: '__skip',
          actionType: 'skip',
          ownerId,
          params: {},
          baseSeq: 0,
        },
        validTargets: [],
        category: 'skip',
      });
    }
    const reqType = getPendingRequestType(pending);
    // 弃牌阶段：引擎注册 系统规则:respond，validate 要求 params.cardIds。
    // 此处给出一个"选择弃牌"占位 action，agent 须自行从手牌选足 discardMin 张填入 cardIds。
    if (reqType === '__弃牌') {
      out.push({
        description: '弃牌（需选弃牌张数后提交 cardIds）',
        message: {
          skillId: '系统规则',
          actionType: 'respond',
          ownerId,
          params: { cardIds: [] },
          baseSeq: 0,
        },
        validTargets: [],
        category: 'discard',
      });
      return;
    }
    // 通用回应（出闪/出杀/确认发动等）
    const info = resolvePendingRespond(pending, skillActions);
    if (info?.skillId) {
      // choosePlayer 类（突袭/select、激将、节命 等）：计算合法目标，agent 需填入 targets
      if (pending.prompt?.type === 'choosePlayer') {
        const choosePrompt = pending.prompt;
        const filter = choosePrompt.filter;
        const validTargets: number[] = [];
        for (const p of view.players) {
          if (!p.alive) continue;
          if (filter && !filter(view, p.index)) continue;
          validTargets.push(p.index);
        }
        out.push({
          description: choosePrompt.title ?? info.skillId,
          message: {
            skillId: info.skillId,
            actionType: 'respond',
            ownerId,
            params: { targets: [] },
            baseSeq: 0,
          },
          validTargets,
          category: 'respond',
        });
        return;
      }
      // confirm 类（突袭/trigger 等）优先于 cardFilter：
      //   询问杀/闪 的 prompt 也是 confirm，但它们需要 cardId（atom.type 以「询问」开头）。
      //   只有 请求回应 + confirm 才是纯确认操作（choice: true/false）。
      const atomType = atom.type ?? '';
      const isAskType = atomType.startsWith('询问');
      if (!isAskType && pending.prompt?.type === 'confirm') {
        const confirmLabel = pending.prompt.confirmLabel ?? '确认';
        const cancelLabel = pending.prompt.cancelLabel ?? '取消';
        out.push({
          description: `${confirmLabel}【${info.skillId}】`,
          message: {
            skillId: info.skillId,
            actionType: 'respond',
            ownerId,
            params: { choice: true },
            baseSeq: 0,
          },
          validTargets: [],
          category: 'respond',
        });
        out.push({
          description: `${cancelLabel}`,
          message: {
            skillId: info.skillId,
            actionType: 'respond',
            ownerId,
            params: { choice: false },
            baseSeq: 0,
          },
          validTargets: [],
          category: 'skip',
        });
      } else if (info.cardFilter) {
        // 需要选牌（杀/闪等）：为每张可出的牌生成独立 respond action（带 cardId）
        const me = view.players[ownerId];
        const candidates = me?.hand?.filter((c) => info.cardFilter!(c)) ?? [];
        for (const card of candidates) {
          out.push({
            description: `回应【${info.skillId}】(${card.suit}${card.rank})`,
            message: {
              skillId: info.skillId,
              actionType: 'respond',
              ownerId,
              params: { cardId: card.id },
              baseSeq: 0,
            },
            validTargets: [],
            category: 'respond',
          });
        }
        // 没有可出的牌或策略性不出：提供 skip
        out.push({
          description: candidates.length === 0 ? `无牌可出，跳过` : `不出【${info.skillId}】`,
          message: {
            skillId: '__skip',
            actionType: 'skip',
            ownerId,
            params: {},
            baseSeq: 0,
          },
          validTargets: [],
          category: 'skip',
        });
      } else {
        // 兜底（choosePlayer 等）：空 params，agent 需自行补全 targets
        out.push({
          description: `回应【${info.skillId}】`,
          message: {
            skillId: info.skillId,
            actionType: 'respond',
            ownerId,
            params: {},
            baseSeq: 0,
          },
          validTargets: [],
          category: 'respond',
        });
      }
    }
  }

  // ── 操作 ──

  sendAction(action: EngineClientMessage): void {
    this._lastActionRejected = false;
    // 阻塞型 pending 期间 respond 携带 pendingSeq（当前窗口 seq），非阻塞（出牌窗口）不带
    const pending = this._view?.pending;
    const pendingSeq = pending?.isBlocking ? this._lastSeq : undefined;
    const fullAction = { ...action, baseSeq: this._lastSeq, pendingSeq };
    void this.postAction(fullAction);
  }

  /** POST action 到服务端 */
  private async postAction(action: EngineClientMessage): Promise<void> {
    if (!this._roomId || !this._playerId) return;
    try {
      await fetch(`${this.baseUrl}/api/rooms/${this._roomId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this._playerId, action }),
      });
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** 返回并清除最近一次 action 是否被服务端拒（供 runPlay 轮询，已拒则报告 rejected）。 */
  consumeActionRejected(): boolean {
    const r = this._lastActionRejected;
    this._lastActionRejected = false;
    return r;
  }

  /** 重排手牌 */
  async reorderHand(order: string[]): Promise<void> {
    if (!this._roomId || !this._playerId) return;
    try {
      await fetch(`${this.baseUrl}/api/rooms/${this._roomId}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this._playerId, order }),
      });
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
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

  // ── 大厅 ──

  async sendReady(): Promise<void> {
    await this.postRoomOp('ready');
  }

  async sendStartGame(): Promise<void> {
    await this.postRoomOp('start');
  }

  async sendRestart(): Promise<void> {
    await this.postRoomOp('restart');
  }

  async sendUpdateConfig(config: RoomConfig): Promise<void> {
    if (!this._roomId || !this._playerId) return;
    try {
      await fetch(`${this.baseUrl}/api/rooms/${this._roomId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this._playerId, config }),
      });
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** POST 通用房间操作（ready/start/restart） */
  private async postRoomOp(op: string): Promise<void> {
    if (!this._roomId || !this._playerId) return;
    try {
      await fetch(`${this.baseUrl}/api/rooms/${this._roomId}/${op}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this._playerId }),
      });
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this.stopReconnectStatePolling();
    this.canReconnect = false;
    this.eventSource?.close();
    this.eventSource = null;
  }

  /** 角色确定后，为本座次注册技能 actions（供 getAvailableActions）。 */
  async loadSkillActions(skillIds: string[], seatIndex?: number): Promise<void> {
    await registerSkillActions(seatIndex ?? this._seatIndex, skillIds);
  }
}
