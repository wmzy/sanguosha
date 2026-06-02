import type { GameAction, GameState, ClientPlayer, GameView, ValidAction, PendingView } from '../engine/types';
import type { ServerMessage } from './protocol';
import type { Room } from './room';
import { createInitialState, getPlayer } from '../engine/state';
import { engine } from '../engine/engine';
import { serialize as serializeState, deserialize as deserializeState } from '../engine/serializer';
import { registerCharacterTriggers } from '../engine/skill';
import { computeValidActions } from '../engine/validate';
import { allCharacters } from '../shared/characters';
import { serialize } from './protocol';
import { setRoomStatus } from './room';
import type { Role } from '../shared/types';
import { createLogger } from './logger';
import { createRng } from '../shared/rng';

const characterMap = Object.fromEntries(allCharacters.map(c => [c.name, c]));

function assignRoles(count: number): Role[] {
  if (count === 2) return ['主公', '反贼'];
  if (count === 3) return ['主公', '反贼', '内奸'];
  if (count === 4) return ['主公', '忠臣', '反贼', '反贼'];
  const roles: Role[] = ['主公', '忠臣', '内奸'];
  for (let i = 3; i < count; i++) roles.push('反贼');
  return roles;
}

function buildGameView(state: GameState, playerName: string): GameView {
  const clientPlayers: Record<string, ClientPlayer> = {};

  for (const name of state.playerOrder) {
    const p = getPlayer(state, name);
    const isSelf = name === playerName;
    const hand = isSelf
      ? p.hand.map(id => state.cardMap[id])
      : [];
    const equipment: Record<string, import('../shared/types').Card | undefined> = {};
    if (p.equipment.weapon) equipment.weapon = state.cardMap[p.equipment.weapon];
    if (p.equipment.armor) equipment.armor = state.cardMap[p.equipment.armor];
    if (p.equipment.horsePlus) equipment.horsePlus = state.cardMap[p.equipment.horsePlus];
    if (p.equipment.horseMinus) equipment.horseMinus = state.cardMap[p.equipment.horseMinus];

    clientPlayers[name] = {
      name,
      health: p.health,
      maxHealth: p.maxHealth,
      hand,
      handCount: p.hand.length,
      equipment,
      characterId: p.info.characterId,
      role: p.info.role,
      alive: p.info.alive,
      gender: p.info.gender,
      faction: p.info.faction,
      vars: p.vars,
    };
  }

  let pending: PendingView | undefined;
  if (state.pending) {
    const p = state.pending;
    switch (p.type) {
      case 'responseWindow':
        pending = {
          id: p.id,
          type: p.window.type,
          prompt: getPendingPrompt(p.window.type),
          validCards: p.window.validCards,
          timeout: p.timeout,
          deadline: p.deadline,
        };
        break;
      case 'discardPhase':
        pending = {
          id: p.id,
          type: 'discard',
          prompt: `请弃掉 ${p.min}~${p.max} 张牌`,
          timeout: p.timeout,
          deadline: p.deadline,
        };
        break;
      case 'dyingWindow':
        pending = {
          id: p.id,
          type: 'dying',
          prompt: `${p.dyingPlayer} 濒死，是否出桃？`,
          timeout: p.timeout,
          deadline: p.deadline,
        };
        break;
      case 'skillPrompt':
        pending = {
          id: p.id,
          type: 'skillChoice',
          prompt: p.prompt.text,
          options: p.prompt.options,
          timeout: p.timeout,
          deadline: p.deadline,
        };
        break;
      case 'selectCard':
        pending = {
          id: p.id,
          type: 'selectCard',
          prompt: p.mode === 'steal' ? '顺手牵羊：选择要获得的牌' : '过河拆桥：选择要弃掉的牌',
          timeout: p.timeout,
          deadline: p.deadline,
        };
        break;
      case 'harvestSelection':
        pending = {
          id: p.id,
          type: 'harvestSelection',
          prompt: `五谷丰登：${p.pickOrder[p.currentPickerIndex]} 选牌`,
          timeout: p.timeout,
          deadline: p.deadline,
        };
        break;
      case 'playPhase':
        pending = {
          id: p.id,
          type: 'playPhase',
          prompt: '请出牌或结束回合',
          timeout: p.timeout,
          deadline: p.deadline,
        };
        break;
    }
  }

  const actions: ValidAction[] = computeValidActions(state, playerName);

  return {
    state: {
      self: playerName,
      players: clientPlayers,
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      turn: { killsPlayed: state.turn.killsPlayed },
      zones: {
        discardPile: state.zones.discardPile.map(id => state.cardMap[id]),
        deckCount: state.zones.deck.length,
      },
    },
    pending,
    actions,
  };
}

function getPendingPrompt(windowType: string): string {
  switch (windowType) {
    case 'killResponse': return '请选择是否出闪';
    case 'aoeResponse': return '请选择是否响应';
    case 'dyingResponse': return '请选择是否出桃';
    case 'duelResponse': return '请选择是否出杀';
    case 'trickResponse': return '请选择是否响应';
    default: return '请响应';
  }
}

/** 玩家断线后等待重连的宽限期（毫秒）。超时则结束游戏。 */
const RECONNECT_GRACE_MS = 30_000;

export class GameSession {
  private state: GameState | null = null;
  private room: Room;
  private debug: boolean;
  private playerNames = new Map<string, string>();
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectedAt = new Map<string, number>();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private logger = createLogger('session');
  private sessionSeed: number;

  constructor(room: Room, debug = false, sessionSeed?: number) {
    this.room = room;
    this.debug = debug;
    this.sessionSeed = sessionSeed ?? Date.now();
  }

  startGame(playerCount?: number): boolean {
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

    // 触发 startGame 自动阶段推进（准备→判定→摸牌→出牌）
    const startResult = engine(state, { type: 'startGame' });
    state = startResult.state;

    this.state = state;

    this.scheduleTimeout();

    setRoomStatus(this.room.id, '进行中');
    this.broadcastGameView();
    return true;
  }

  handleAction(playerId: string, action: GameAction): void {
    if (!this.state) {
      this.sendToPlayer(playerId, { type: 'error', message: '游戏未开始' });
      return;
    }

    let fullAction: GameAction;
    if (this.debug) {
      fullAction = action;
    } else {
      const playerName = this.playerNames.get(playerId);
      if (!playerName) {
        this.sendToPlayer(playerId, { type: 'error', message: '玩家不在游戏中' });
        return;
      }
      fullAction = { ...action, player: playerName } as GameAction;
    }

    if (this.state.meta.status === '已结束') {
      this.sendToPlayer(playerId, { type: 'error', message: '游戏已结束' });
      return;
    }

    const result = engine(this.state, fullAction);

    if (result.error) {
      this.sendToPlayer(playerId, { type: 'error', message: result.error });
      return;
    }

    this.state = result.state;

    this.broadcastEvents(result.events);
    this.checkGameEnd();
    this.scheduleTimeout();
    this.broadcastGameView();
  }

  private broadcastEvents(events: import('../engine/types').ServerEvent[]): void {
    if (events.length === 0) return;

    const eventMsg = {
      type: 'events' as const,
      events: events.map(ev => ({
        id: ev.id,
        type: ev.type,
        timestamp: ev.timestamp,
        payload: ev.payload,
      })),
    };

    if (this.debug) {
      const realPlayerId = this.room.players.keys().next().value;
      if (realPlayerId) this.sendToPlayer(realPlayerId, eventMsg);
      return;
    }

    for (const [pid] of this.playerNames) {
      this.sendToPlayer(pid, eventMsg);
    }
  }

  private broadcastGameView(): void {
    if (!this.state) return;

    if (this.debug) {
      const playerId = this.room.players.keys().next().value;
      if (playerId) {
        this.sendToPlayer(playerId, { type: 'debugGameState', state: this.state });
      }
      return;
    }

    if (this.state.meta.status !== '进行中') return;

    for (const [playerId, playerName] of this.playerNames) {
      const view = buildGameView(this.state, playerName);
      this.sendToPlayer(playerId, { type: 'gameView', view });
    }
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
    this.timeoutTimer = null;
    if (!this.state?.pending) return;

    const onTimeout = this.state.pending.onTimeout;
    const result = engine(this.state, onTimeout);

    if (result.error) {
      this.logger.warn(`[Timeout] engine error: ${result.error}`);
      return;
    }

    this.state = result.state;
    this.broadcastEvents(result.events);
    this.checkGameEnd();
    this.scheduleTimeout();
    this.broadcastGameView();
  }

  /**
   * 按当前 pending 的 deadline 调度单次 setTimeout。
   *
   * TODO: 当前需要在每个会改变 state.pending 的方法（startGame / handleAction /
   * checkTimeout / reconnectPlayer）末尾显式调用本方法，否则新设置的 pending
   * 永远不会触发超时。理想的"零遗漏"设计是引入一个统一的 state 写入 hook
   * （例如 withPending 包装器），让所有 pushPending / popPending 都自动
   * reschedule。重构前请确保新增的会修改 state.pending 的方法都调用本方法。
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

  destroy(): void {
    this.clearTimeoutTimer();
    this.clearGraceTimer();
    this.state = null;
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

  reconnectPlayer(playerId: string, ws: import('hono/ws').WSContext): boolean {
    if (this.state?.meta.status !== '进行中') return false;
    const wasDisconnected = this.disconnectedAt.delete(playerId);
    // 任何玩家重新上线即取消结束计时：只要还有人在就不应结束游戏
    this.clearGraceTimer();
    this.room.players.set(playerId, ws);
    this.broadcastGameView();
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
