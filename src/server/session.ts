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
      // debug 模式:单玩家控制所有角色
      // playerNames 用 playerId:character 格式(重连时需要),同时设置 playerId→主公
      for (let i = 0; i < count; i++) {
        this.playerNames.set(`${playerId}:${selected[i].name}`, selected[i].name);
      }
      // 直接映射 playerId→主公,让 handleAction 能通过 expectedName 检查
      this.playerNames.set(playerId, selected[0].name);
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
        skills: [...char.skills, '回合管理', '装备通用', '杀', '闪', '桃', '酒', '过河拆桥', '顺手牵羊', '无中生有', '桃园结义', '借刀杀人', '决斗', '南蛮入侵', '万箭齐发', '乐不思蜀', '无懈可击', '反馈'],
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
      const result = await this.engine.dispatch(state, startMsg);
      this.state = result.state;
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
    // debug 模式:允许以任意角色名发 action
    // 非 debug 模式:校验 ownerId 必须匹配预期玩家
    const expectedName = this.playerNames.get(playerId);
    if (!expectedName && !this.debug) return;
    if (!this.debug && action.ownerId !== expectedName) {
      this.logger.warn('ownerId mismatch', { actionOwner: action.ownerId, expected: expectedName });
      return;
    }
    try {
      const result = await this.engine.dispatch(this.state, action);
      if (result.error) {
        this.sendToPlayer(playerId, { type: 'error', message: result.error });
        return;
      }
      this.state = result.state;
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now() - this.state.startedAt,
        message: action,
        baseSeq: baseSeq ?? -1,
      };
      this.actionLog.push(entry);
      this.state.actionLog.push(entry);
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
   * 设置空闲超时定时器。两类场景:
   * 1. 栈顶有 pendingRequest:按其 deadline 自动注入 defaultChoice
   * 2. 玩家处于"出牌"或"弃牌"阶段且无 pendingRequest:N 秒内无操作
   *    自动 dispatch 回合管理 end 动作,避免回合卡死
   */
  private schedulePendingTimeout(): void {
    this.clearPendingTimeout();
    if (!this.state) return;
    const top = this.state.settlementStack[this.state.settlementStack.length - 1];
    // 场景 1:有 pendingSlot,等回应超时
    if (top && top.pendingSlot) {
      const slot = top.pendingSlot;
      const atom = slot.atom;
      if (atom.type !== '请求回应' && atom.type !== '询问闪' && atom.type !== '询问杀') return;
      const remaining = slot.deadline ? slot.deadline - Date.now() : 30_000;
      if (remaining <= 0) {
        void this.injectTimeoutResponse(atom);
        return;
      }
      this.pendingTimeout = setTimeout(() => {
        this.pendingTimeout = null;
        void this.injectTimeoutResponse(atom);
      }, remaining);
      return;
    }
    // 场景 2:出牌/弃牌阶段无 pendingSlot,空闲超时自动 end
    const phase = this.state.phase;
    if (phase !== '出牌' && phase !== '弃牌') return;
    const currentPlayer = this.state.players[this.state.currentPlayerIndex];
    if (!currentPlayer || !currentPlayer.alive) return;
    const IDLE_MS = 50_000;
    this.pendingTimeout = setTimeout(() => {
      this.pendingTimeout = null;
      void this.autoEndTurn(currentPlayer.name);
    }, IDLE_MS);
  }

  /**
   * 自动结束当前玩家的回合(空闲超时)。
   * 等价于该玩家主动点击"结束回合"。
   */
  private async autoEndTurn(ownerName: string): Promise<void> {
    if (!this.state || !this.engine) return;
    // 仅在"出牌"或"弃牌"阶段且当前玩家匹配时触发
    const cur = this.state.players[this.state.currentPlayerIndex];
    if (!cur || cur.name !== ownerName) return;
    if (this.state.phase !== '出牌' && this.state.phase !== '弃牌') return;
    const top = this.state.settlementStack[this.state.settlementStack.length - 1];
    if (top && top.pendingSlot) return;
    try {
      const result = await this.engine.dispatch(this.state, {
        skillId: '回合管理',
        actionType: 'end',
        ownerId: ownerName,
        params: {},
        baseSeq: this.state.seq,
      });
      this.state = result.state;
      this.actionLog.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now() - this.state.startedAt,
        message: { skillId: '回合管理', actionType: 'end', ownerId: ownerName, params: {}, baseSeq: -1 },
        baseSeq: -1,
      });
      this.lastActivityAt = Date.now();
      this.persistAsync();
      this.broadcastNewState();
      this.checkGameEnd();
      this.schedulePendingTimeout();
    } catch (e) {
      this.logger.error('autoEndTurn error', { err: String(e) });
    }
  }

  private clearPendingTimeout(): void {
    if (this.pendingTimeout !== null) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  /**
   * 超时注入：调用 engine.dispatchTimeout 执行 onTimeout 并消费 pending。
   */
  private async injectTimeoutResponse(_atom: { type: string }): Promise<void> {
    if (!this.state || !this.engine) return;
    const top = this.state.settlementStack[this.state.settlementStack.length - 1];
    if (!top || !top.pendingSlot) return;
    try {
      const result = await this.engine.dispatchTimeout(this.state);
      this.state = result;
    } catch (e) {
      this.logger.error('injectTimeoutResponse error', { err: String(e) });
      return;
    }
    this.lastActivityAt = Date.now();
    this.persistAsync();
    this.broadcastNewState();
    this.checkGameEnd();
    this.schedulePendingTimeout();
  }

  private broadcastNewState(): void {
    if (!this.state) return;
    if (this.debug) {
      // debug 模式:发给房间内所有连接的玩家(支持重连后新 playerId)
      const view = buildView(this.state, 0, true);
      for (const [pid] of this.room.players) {
        this.sendToPlayer(pid, { type: 'debugGameState', state: view, lastSeq: this.state.seq });
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
    const view = buildView(this.state, 0, true);
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
    return buildView(this.state, 0, true);
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
