// src/client/headless/HeadlessGameClient.ts
// 单座次无头 WS 玩家客户端。框架无关（零 React 依赖）。
// 用全局 WebSocket（浏览器/Node22/Bun 都有），不 import 'ws'，避免污染浏览器 bundle。
import type { GameView, ViewEvent, Json, ClientMessage as EngineClientMessage } from '../../engine/types';
import type { ServerMessage, ClientMessage, RoomConfig } from '../../server/protocol';
import { applyServerMessage, mergeRoomConfig } from './viewMaintainer';
import { enumerateAvailableActions } from './availableActions';
import { resolvePendingRespond, getPendingRequestType } from '../utils/pendingRespond';
import { getActionsForPlayer, registerSkillActions } from '../skillActionRegistry';
import type { ClientPhase, HeadlessCallbacks, AvailableAction, RoomState } from './types';

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

  constructor(serverUrl: string, callbacks: HeadlessCallbacks = {}) {
    this.serverUrl = serverUrl;
    this.callbacks = callbacks;
  }

  get phase(): ClientPhase { return this._phase; }
  get view(): GameView | null { return this._view; }
  get roomId(): string | null { return this._roomId; }
  get playerId(): string | null { return this._playerId; }
  get seatIndex(): number { return this._seatIndex; }
  get lastSeq(): number { return this._lastSeq; }
  get roomState(): RoomState | null { return this._roomState; }
  get gameOverWinner(): string | null { return this._gameOverWinner; }

  private setPhase(p: ClientPhase) {
    if (this._phase !== p) { this._phase = p; this.callbacks.onPhaseChange?.(p); }
  }

  /** 创建 debug 房间并自动 join 0 号座 */
  createDebugRoom(playerCount: number, config?: RoomConfig): void {
    this.openSocket();
    this.send({ type: 'create_debug_room', config, playerCount });
  }

  /** 连接并 join 指定房间 */
  connect(roomId: string, seatIndex?: number): void {
    this._roomId = roomId;
    this._seatIndex = seatIndex ?? this._seatIndex;
    this.openSocket();
    this.send({ type: 'join_debug_room', roomId, lastSeq: 0 });
  }

  private openSocket() {
    this.ws = new WebSocket(this.serverUrl);
    this.ws.onopen = () => {
      this.setPhase('lobby');
      // flush 连接前缓冲的待发消息
      for (const m of this._outbox) this.ws!.send(JSON.stringify(m));
      this._outbox = [];
    };
    this.ws.onmessage = (ev) => this.handleRaw(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    this.ws.onerror = () => { this.callbacks.onError?.(new Error('WebSocket error'));
    };
    this.ws.onclose = () => { /* 一期不重连 */ };
  }

  private handleRaw(raw: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
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
    if (r.actionRejected) { this._lastActionRejected = true; this.callbacks.onActionRejected?.(); }
    this.callbacks.onMessage?.(msg);
  }

  drainNewEvents(): ViewEvent[] {
    const e = this._pendingNewEvents;
    this._pendingNewEvents = [];
    return e;
  }

  needsAction(): boolean {
    const v = this._view;
    if (!v || !v.pending) return false;
    const p = v.pending;
    // 广播型（target<0，如无懈可击询问）或阻塞型 target===本座次
    return p.target < 0 ? true : (p.isBlocking !== false && p.target === this._seatIndex);
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
    const atom = pending.atom as { type: string; candidates?: Array<{ name: string; skills: string[] }>; requestType?: string };
    // 选将询问：每个候选武将一个 selectChar action（引擎注册 系统规则:选将）
    if (atom.type === '选将询问' && Array.isArray(atom.candidates)) {
      for (const c of atom.candidates) {
        out.push({
          description: `选择武将【${c.name}】`,
          message: { skillId: '系统规则', actionType: '选将', ownerId: this._seatIndex, params: { character: c.name }, baseSeq: 0 },
          validTargets: [],
          category: 'selectChar',
        });
      }
      return;
    }
    const reqType = getPendingRequestType(pending);
    // 弃牌阶段：引擎注册 系统规则:respond，validate 要求 params.cardIds。
    // 此处给出一个“选择弃牌”占位 action，agent 须自行从手牌选足 discardMin 张填入 cardIds。
    if (reqType === '__弃牌') {
      out.push({
        description: '弃牌（需选弃牌张数后提交 cardIds）',
        message: { skillId: '系统规则', actionType: 'respond', ownerId: this._seatIndex, params: { cardIds: [] }, baseSeq: 0 },
        validTargets: [],
        category: 'discard',
      });
      return;
    }
    // 通用回应（出闪/出杀等）：引擎按 pendingRespondInfo 推导 skillId，respond 携带 cardId 或空
    const info = resolvePendingRespond(pending, skillActions);
    if (info?.skillId) {
      out.push({
        description: `回应【${info.skillId}】`,
        message: { skillId: info.skillId, actionType: 'respond', ownerId: this._seatIndex, params: {}, baseSeq: 0 },
        validTargets: [],
        category: 'respond',
      });
    }
  }

  // ── 操作 ──

  sendAction(action: EngineClientMessage): void {
    this._lastActionRejected = false;
    // 阻塞型 pending 期间 respond 携带 pendingSeq（当前窗口 seq），非阻塞（出牌窗口）不带
    const pending = this._view?.pending;
    const pendingSeq = pending?.isBlocking ? this._lastSeq : undefined;
    this.send({ type: 'action', action: { ...action, baseSeq: this._lastSeq, pendingSeq }, baseSeq: this._lastSeq });
  }

  /** 返回并清除最近一次 action 是否被服务端拒（供 runPlay 轮询，已拒则报告 rejected）。 */
  consumeActionRejected(): boolean {
    const r = this._lastActionRejected;
    this._lastActionRejected = false;
    return r;
  }

  /** 重排手牌（对应 reorder_hand 协议消息） */
  reorderHand(order: string[]): void { this.send({ type: 'reorder_hand', order }); }

  useCardAndTarget(skillId: string, cardId: string, targets: number[]): void {
    this.sendAction({ skillId, actionType: 'use', ownerId: this._seatIndex, params: { cardId, targets }, baseSeq: 0 });
  }

  useCard(skillId: string, cardId: string): void {
    this.sendAction({ skillId, actionType: 'use', ownerId: this._seatIndex, params: { cardId }, baseSeq: 0 });
  }

  respond(skillId: string, params?: Record<string, Json>): void {
    this.sendAction({ skillId, actionType: 'respond', ownerId: this._seatIndex, params: params ?? {}, baseSeq: 0 });
  }

  /** 选择武将（对应选将询问 pending）。引擎注册 系统规则:选将。 */
  selectCharacter(character: string): void {
    this.sendAction({ skillId: '系统规则', actionType: '选将', ownerId: this._seatIndex, params: { character }, baseSeq: 0 });
  }

  /** 弃牌：提交要弃的 cardIds。引擎注册 系统规则:respond。 */
  discard(cardIds: string[]): void {
    this.respond('系统规则', { cardIds });
  }

  /** 放弃当前 pending（不回应）：空 respond。 */
  pass(): void {
    // 广播型 pending（无懈可击等）无特定 skillId，用当前 pending 推导的 skillId
    const pending = this._view?.pending;
    const info = pending ? resolvePendingRespond(pending, getActionsForPlayer(this._seatIndex)) : null;
    const skillId = info?.skillId ?? '__pass';
    this.sendAction({ skillId, actionType: 'respond', ownerId: this._seatIndex, params: {}, baseSeq: 0 });
  }

  // ── 大厅 ──

  sendReady(): void { this.send({ type: 'ready' }); }
  sendStartGame(): void { this.send({ type: 'start_game' }); }
  sendRestart(): void { this.send({ type: 'restart_game' }); }
  sendUpdateConfig(config: RoomConfig): void { this.send({ type: 'update_room_config', config }); }

  private send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this._outbox.push(msg);
    }
  }
  disconnect() { this.ws?.close(); this.ws = null; }

  /** 角色确定后，为本座次注册技能 actions（供 getAvailableActions）。 */
  async loadSkillActions(skillIds: string[]): Promise<void> {
    await registerSkillActions(this._seatIndex, skillIds);
  }
}
