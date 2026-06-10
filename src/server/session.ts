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
import { createStandardDeck, shuffle } from '../shared/deck';
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
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
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
    this.lastActivityAt = Date.now();
    this.engine = createEngine();
    this.engine.resetForTest();
    this.engine.bootstrap(state);
  }

  async startGame(playerCount?: number): Promise<boolean> {
    if (this.destroyed) return false;
    const count = this.debug ? (playerCount ?? this.room.players.size) : this.room.players.size;
    if (count < 2) return false;

    const seed = this.sessionSeed;
    const rng = createRng(seed);
    // 主公固定在 0 号位,其余角色随机
    const lord = CHARACTERS.find(c => c.name === '主公')!;
    const others = CHARACTERS.filter(c => c.name !== '主公');
    for (let i = others.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      const tmp = others[i]; others[i] = others[j]; others[j] = tmp;
    }
    const selected = [lord, ...others.slice(0, count - 1)];
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

    // 创建并洗牌
    const allCards = shuffle(createStandardDeck(), rng);
    const cardMap: GameState['cardMap'] = {};
    const deckIds: string[] = [];
    for (const card of allCards) {
      cardMap[card.id] = card;
      deckIds.push(card.id);
    }

    // 发初始手牌(每人4张)
    const handSize = 4;
    let cursor = 0;
    const players = selected.map((char, i) => {
      const hand = deckIds.slice(cursor, cursor + handSize);
      cursor += handSize;
      return {
        index: i,
        name: char.name,
        character: char.name,
        health: 4,
        maxHealth: 4,
        alive: true,
        hand,
        equipment: {},
        skills: [...char.skills, '回合管理', '装备通用'],
        vars: {},
        marks: [],
        pendingTricks: [],
      };
    });

    const state: GameState = {
      players,
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
      zones: { deck: deckIds.slice(cursor), discardPile: [], processing: [] },
      settlementStack: [],
      cardMap,
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

    // 触发第一次回合开始 → 阶段开始(准备)
    // 直接 dispatch 一个内部 action 来启动游戏
    const firstPlayer = state.players[0];
    if (firstPlayer) {
      const startMsg: EngineClientMessage = {
        skillId: '回合管理',
        actionType: 'start',
        ownerId: firstPlayer.name,
        params: {},
        baseSeq: 0,
      };
      this.state = await this.engine.dispatch(state, startMsg);
    } else {
      this.state = state;
    }

    this.actionLog = [];
    this.lastActivityAt = Date.now();

    setRoomStatus(this.room.id, '进行中');
    this.sendInitialViewToAll();
    return true;
  }

  async handleAction(playerId: string, action: EngineClientMessage, baseSeq?: number): Promise<void> {
    if (this.destroyed) return;
    if (!this.state || !this.engine) return;
    if (baseSeq !== undefined && baseSeq !== this.state.seq) {
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
        // 用客户端送来的 baseSeq(未传则为 -1 表示未参与 CAS),
        // 而不是 dispatch 推进后的 this.state.seq——后者会让重放时 CAS 错位。
        baseSeq: baseSeq ?? -1,
      });
      this.lastActivityAt = Date.now();
      this.persistAsync();
      this.broadcastNewState();
      this.checkGameEnd();
      this.schedulePendingTimeout();
    } catch (err) {
      this.logger.error('dispatch error', { err: String(err) });
      this.sendToPlayer(playerId, { type: 'error', message: '引擎内部错误' });
    }
  }

  /**
   * 检查 state.settlementStack 栈顶是否有等待回应;
   * 如有,按 pendingRequest.deadline 设置 setTimeout,到期后自动注入
   * 请求回应 atom 的 defaultChoice 作为玩家回应(防止掉线/不响应时
   * 整局卡死)。
   */
  private schedulePendingTimeout(): void {
    this.clearPendingTimeout();
    if (!this.state) return;
    const top = this.state.settlementStack[this.state.settlementStack.length - 1];
    if (!top || !top.pendingRequest || top.pendingRequest.status !== 'waiting') return;
    const pr = top.pendingRequest;
    const atom = pr.atom;
    if (atom.type !== '请求回应' && atom.type !== '询问闪' && atom.type !== '询问杀') return;
    const remaining = pr.deadline ? pr.deadline - Date.now() : 30_000;
    if (remaining <= 0) {
      // 立即超时
      void this.injectTimeoutResponse(atom);
      return;
    }
    this.pendingTimeout = setTimeout(() => {
      this.pendingTimeout = null;
      void this.injectTimeoutResponse(atom);
    }, remaining);
  }

  private clearPendingTimeout(): void {
    if (this.pendingTimeout !== null) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  /**
   * 把 atom 的 defaultChoice 作为目标玩家的"超时回应",走正常 handleAction。
   *
   * 实现策略:在 engine dispatch 走 'responded' 路径时(栈顶有 pendingRequest),
   * findActionEntry 找不到时 dispatch 会静默丢弃;为此我们直接走 settlement 内部:
   * 1. 标记栈顶 pendingRequest.status = 'resolved'
   * 2. 把 defaultChoice + requestType 注入 pending.params(供 frame.execute 后续读)
   * 3. 重新调一次 'no-op' 内部 dispatch(用 '__timeout__' skillId)
   */
  private async injectTimeoutResponse(atom: { type: '请求回应'; requestType?: string; defaultChoice?: unknown }): Promise<void> {
    if (!this.state || !this.engine) return;
    const top = this.state.settlementStack[this.state.settlementStack.length - 1];
    if (!top || !top.pendingRequest || top.pendingRequest.status !== 'waiting') return;
    const target = top.pendingRequest.target;
    if (!target) return;
    // 调 engine.dispatchTimeout:走和玩家回应等价的路径,
    // entry 不存在时仍然走"杀结算"代执行。
    this.state = await this.engine.dispatchTimeout(this.state);
    this.lastActivityAt = Date.now();
    this.persistAsync();
    this.broadcastNewState();
    this.checkGameEnd();
    this.schedulePendingTimeout();
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
