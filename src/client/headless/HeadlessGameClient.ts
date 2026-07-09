// src/client/headless/HeadlessGameClient.ts
// 单座次无头 WS 玩家客户端。框架无关（零 React 依赖）。
// 用全局 WebSocket（浏览器/Node22/Bun 都有），不 import 'ws'，避免污染浏览器 bundle。
import type {
  GameView,
  ViewEvent,
  Json,
  ClientMessage as EngineClientMessage,
} from '../../engine/types';
import type { ServerMessage, ClientMessage, RoomConfig } from '../../server/protocol';
import { applyServerMessage, mergeRoomConfig } from './viewMaintainer';
import { enumerateAvailableActions } from './availableActions';
import { resolvePendingRespond, getPendingRequestType } from '../utils/pendingRespond';
import { getActionsForPlayer, registerSkillActions } from '../skillActionRegistry';
import type { ClientPhase, HeadlessCallbacks, AvailableAction, RoomState, ReconnectState } from './types';

export class HeadlessGameClient {
  private ws: WebSocket | null = null;
  private _view: GameView | null = null;
  private _lastSeq = 0;
  private _phase: ClientPhase = 'connecting';
  private _playerId: string | null = null;
  private _seatIndex = 0;
  private _roomId: string | null = null;
  private _roomState: RoomState | null = null;
  private _gameOverWinner: string | null = null;
  private _pendingNewEvents: ViewEvent[] = [];
  /** 连接就绪前缓冲的待发消息（open 后 flush） */
  private _outbox: ClientMessage[] = [];
  /** 最近一次 action 是否被服务端拒（供 runPlay 轮询）。每次 sendAction 重置。 */
  private _lastActionRejected = false;
  private readonly callbacks: HeadlessCallbacks;
  private readonly serverUrl: string;

  // ── 重连机制 ──
  /** 重连退避定时器 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 已尝试重连次数 */
  private _reconnectAttempts = 0;
  /** 最大重连尝试次数 */
  private readonly maxReconnectAttempts = 10;
  /** 主动断开标记:disconnect() 设为 true,onclose 不触发重连 */
  private intentionalDisconnect = false;
  /** 当前重连状态 */
  private _reconnectState: ReconnectState = 'idle';
  /** 是否为 debug 模式(影响重连消息类型) */
  private _debugMode = false;
  /** 已收到 room_joined,具备重连所需上下文(roomId/playerId) */
  private canReconnect = false;
  /** 重连 WS 已打开、已发 reconnect 消息、等待服务端响应。收到任意消息即标记成功。 */
  private pendingReconnect = false;

  constructor(serverUrl: string, callbacks: HeadlessCallbacks = {}) {
    this.serverUrl = serverUrl;
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
    return this._reconnectAttempts;
  }

  private setPhase(p: ClientPhase) {
    if (this._phase !== p) {
      this._phase = p;
      this.callbacks.onPhaseChange?.(p);
    }
  }

  /** 创建 debug 房间并自动 join 0 号座 */
  createDebugRoom(playerCount: number, config?: RoomConfig): void {
    this._debugMode = true;
    this.intentionalDisconnect = false;
    this.openSocket();
    this.send({ type: 'create_debug_room', config, playerCount });
  }

  /** 连接并 join 指定房间 */
  connect(roomId: string, seatIndex?: number): void {
    this._debugMode = true;
    this._roomId = roomId;
    this._seatIndex = seatIndex ?? this._seatIndex;
    this.intentionalDisconnect = false;
    this.openSocket();
    this.send({ type: 'join_debug_room', roomId, lastSeq: 0 });
  }

  /** 声明 playerId(连接初期调用)。给定则采用该值,否则服务端自动生成。 */
  setPlayerId(playerId?: string): void {
    if (playerId?.trim()) {
      this.send({ type: 'set_player_id', playerId: playerId.trim() });
    }
  }

  /** 创建普通(多人)房间:本连接成为房主。 */
  createRoom(name: string, maxPlayers: number, config?: RoomConfig, playerId?: string): void {
    this._debugMode = false;
    this.intentionalDisconnect = false;
    this.openSocket();
    this.setPlayerId(playerId);
    this.send({ type: 'create_room', name, maxPlayers, config });
  }

  /** 加入普通(多人)房间。 */
  joinRoom(roomId: string, playerId?: string): void {
    this._debugMode = false;
    this._roomId = roomId;
    this.intentionalDisconnect = false;
    this.openSocket();
    this.setPlayerId(playerId);
    this.send({ type: 'join_room', roomId });
  }

  private openSocket(isReconnect = false) {
    this.ws = new WebSocket(this.serverUrl);
    this.ws.onopen = () => {
      // 主动断开后迟到的新 WS:立即关闭,不处理
      if (this.intentionalDisconnect) {
        this.ws?.close();
        return;
      }
      if (isReconnect) {
        // 重连:发送 reconnect/join_debug_room 消息恢复座位
        this.sendReconnectMessage();
      } else {
        // 正常首次连接
        this.setPhase('lobby');
      }
      // flush 连接前缓冲的待发消息
      for (const m of this._outbox) this.ws!.send(JSON.stringify(m));
      this._outbox = [];
    };
    this.ws.onmessage = (ev) =>
      this.handleRaw(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    this.ws.onerror = () => {
      this.callbacks.onError?.(new Error('WebSocket error'));
    };
    this.ws.onclose = () => {
      // 主动断开:不重连
      if (this.intentionalDisconnect) return;
      // 已具备重连上下文(room_joined 已收到):自动重连
      if (this.canReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  /** 重连 WS 打开后发送恢复消息。根据模式选择 join_debug_room 或 reconnect。 */
  private sendReconnectMessage(): void {
    if (this._debugMode && this._roomId) {
      // debug 模式:通过 join_debug_room 恢复(服务端按 room.status 决定恢复视图)
      this.pendingReconnect = true;
      this.ws!.send(
        JSON.stringify({ type: 'join_debug_room', roomId: this._roomId, lastSeq: this._lastSeq }),
      );
    } else if (this._playerId) {
      // multiplayer 模式:通过 reconnect 消息携带旧 playerId 恢复座位
      this.pendingReconnect = true;
      this.ws!.send(
        JSON.stringify({ type: 'reconnect', playerId: this._playerId, lastSeq: this._lastSeq }),
      );
    } else {
      // 无重连上下文:放弃
      this.setReconnectState('failed');
    }
  }

  // ── 重连机制 ──

  /** 指数退避延迟:1s→2s→4s→8s→16s,上限 30s */
  private getReconnectDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 30000);
  }

  /** 调度下一次重连。超过最大次数则标记失败。 */
  private scheduleReconnect(): void {
    if (this._reconnectAttempts >= this.maxReconnectAttempts) {
      this.setReconnectState('failed');
      return;
    }
    this._reconnectAttempts++; // 先递增(1-based),使回调报告当前尝试编号
    this.setReconnectState('reconnecting');
    const delay = this.getReconnectDelay(this._reconnectAttempts - 1); // 0-based for delay
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket(true);
    }, delay);
  }

  private setReconnectState(state: ReconnectState): void {
    if (this._reconnectState !== state) {
      this._reconnectState = state;
      this.callbacks.onReconnectStateChange?.(state, this._reconnectAttempts);
    }
  }

  /** 用户手动取消重连。清除定时器、重置状态、关闭正在重连的 WS。 */
  cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._reconnectAttempts = 0;
    this.pendingReconnect = false;
    const wasReconnecting = this._reconnectState === 'reconnecting';
    this.setReconnectState('idle');
    // 正在重连的 WS:关闭它(不影响正常连接)
    if (wasReconnecting && this.ws) {
      this.intentionalDisconnect = true;
      this.ws.close();
      this.ws = null;
    }
  }

  private handleRaw(raw: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    // 重连后收到任意消息:标记重连成功
    if (this.pendingReconnect) {
      this.pendingReconnect = false;
      this._reconnectAttempts = 0;
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
    if (p.target !== this._seatIndex) return false; // 别人的 pending
    // 阻塞型 pending：必须回应
    if (p.isBlocking !== false) return true;
    // 非阻塞型 pending：出牌阶段的出牌窗口需要 AI 行动（可出牌或结束回合）
    return v.phase === '出牌';
  }

  getAvailableActions(): AvailableAction[] {
    const v = this._view;
    if (!v) return [];
    const skillActions = getActionsForPlayer(this._seatIndex);
    const actions = enumerateAvailableActions(v, this._seatIndex, skillActions);
    // 追加 respond/discard 类（pending 驱动）
    if (v.pending && (v.pending.target === this._seatIndex || v.pending.target < 0)) {
      this.appendRespondActions(v, skillActions, actions);
    }
    return actions;
  }

  private appendRespondActions(
    view: GameView,
    skillActions: import('../skillActionRegistry').SkillActionDef[],
    out: AvailableAction[],
  ) {
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
            ownerId: this._seatIndex,
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
          ownerId: this._seatIndex,
          params: {},
          baseSeq: 0,
        },
        validTargets: [],
        category: 'skip',
      });
    }
    const reqType = getPendingRequestType(pending);
    // 弃牌阶段：引擎注册 系统规则:respond，validate 要求 params.cardIds。
    // 此处给出一个“选择弃牌”占位 action，agent 须自行从手牌选足 discardMin 张填入 cardIds。
    if (reqType === '__弃牌') {
      out.push({
        description: '弃牌（需选弃牌张数后提交 cardIds）',
        message: {
          skillId: '系统规则',
          actionType: 'respond',
          ownerId: this._seatIndex,
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
            ownerId: this._seatIndex,
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
            ownerId: this._seatIndex,
            params: { choice: false },
            baseSeq: 0,
          },
          validTargets: [],
          category: 'skip',
        });
      } else if (info.cardFilter) {
        // 需要选牌（杀/闪等）：为每张可出的牌生成独立 respond action（带 cardId）
        const me = view.players[this._seatIndex];
        const candidates = me?.hand?.filter((c) => info.cardFilter!(c)) ?? [];
        for (const card of candidates) {
          out.push({
            description: `回应【${info.skillId}】(${card.suit}${card.rank})`,
            message: {
              skillId: info.skillId,
              actionType: 'respond',
              ownerId: this._seatIndex,
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
            ownerId: this._seatIndex,
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
            ownerId: this._seatIndex,
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
    this.send({
      type: 'action',
      action: { ...action, baseSeq: this._lastSeq, pendingSeq },
      baseSeq: this._lastSeq,
    });
  }

  /** 返回并清除最近一次 action 是否被服务端拒（供 runPlay 轮询，已拒则报告 rejected）。 */
  consumeActionRejected(): boolean {
    const r = this._lastActionRejected;
    this._lastActionRejected = false;
    return r;
  }

  /** 重排手牌（对应 reorder_hand 协议消息） */
  reorderHand(order: string[]): void {
    this.send({ type: 'reorder_hand', order });
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

  sendReady(): void {
    this.send({ type: 'ready' });
  }

  sendStartGame(): void {
    this.send({ type: 'start_game' });
  }

  sendRestart(): void {
    this.send({ type: 'restart_game' });
  }

  sendUpdateConfig(config: RoomConfig): void {
    this.send({ type: 'update_room_config', config });
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this._outbox.push(msg);
    }
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this.cancelReconnect();
    this.canReconnect = false;
    this.ws?.close();
    this.ws = null;
  }

  /** 角色确定后，为本座次注册技能 actions（供 getAvailableActions）。 */
  async loadSkillActions(skillIds: string[]): Promise<void> {
    await registerSkillActions(this._seatIndex, skillIds);
  }
}
