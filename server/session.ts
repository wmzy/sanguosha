import type { GameAction, GameState, ClientPlayer, GameView, ValidAction, PendingView } from '../engine/v2/types';
import type { ServerMessage } from './protocol';
import type { Room } from './room';
import { createInitialState, getPlayer, getAlivePlayerNames } from '../engine/v2/state';
import { engine } from '../engine/v2/engine';
import { serialize as serializeState, deserialize as deserializeState } from '../engine/v2/serializer';
import { registerCharacterTriggers } from '../engine/v2/skill';
import { computeValidActions } from '../engine/v2/validate';
import { allCharacters } from '../shared/characters';
import { serialize } from './protocol';
import { setRoomStatus } from './room';
import type { Role } from '../shared/types';
import { createLogger } from './logger';

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
          type: p.window.type,
          prompt: getPendingPrompt(p.window.type),
          validCards: p.window.validCards,
          timeout: p.timeout,
          deadline: p.deadline,
        };
        break;
      case 'discardPhase':
        pending = {
          type: 'discard',
          prompt: `请弃掉 ${p.min}~${p.max} 张牌`,
          timeout: p.timeout,
          deadline: p.deadline,
        };
        break;
      case 'dyingWindow':
        pending = {
          type: 'dying',
          prompt: `${p.dyingPlayer} 濒死，是否出桃？`,
          timeout: p.timeout,
          deadline: p.deadline,
        };
        break;
      case 'skillPrompt':
        pending = {
          type: 'skillChoice',
          prompt: p.prompt.text,
          options: p.prompt.options,
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

export class GameSession {
  private state: GameState | null = null;
  private room: Room;
  private playerNames = new Map<string, string>();
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;
  private logger = createLogger('./logger');

  constructor(room: Room) {
    this.room = room;
  }

  startGame(): boolean {
    if (this.room.players.size < 2) return false;

    const seed = Date.now();
    const shuffled = [...allCharacters].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, this.room.players.size);
    const roles = assignRoles(this.room.players.size);

    const playerIds = [...this.room.players.keys()];
    const players = playerIds.map((id, i) => ({
      name: selected[i].name,
      characterId: selected[i].name,
      role: roles[i],
    }));

    for (let i = 0; i < playerIds.length; i++) {
      this.playerNames.set(playerIds[i], selected[i].name);
    }

    let state = createInitialState({
      players,
      seed,
      characterMap,
    });

    for (const playerName of state.playerOrder) {
      state = registerCharacterTriggers(state, playerName, { characterMap });
    }

    this.state = state;

    import('../engine/v2/skills/index');

    this.timeoutTimer = setInterval(() => this.checkTimeout(), 1000);

    setRoomStatus(this.room.id, '进行中');
    this.broadcastGameView();
    return true;
  }

  handleAction(playerId: string, action: GameAction): void {
    if (!this.state) {
      this.sendToPlayer(playerId, { type: 'error', message: '游戏未开始' });
      return;
    }

    const playerName = this.playerNames.get(playerId);
    if (!playerName) {
      this.sendToPlayer(playerId, { type: 'error', message: '玩家不在游戏中' });
      return;
    }

    if (this.state.meta.status === '已结束') {
      this.sendToPlayer(playerId, { type: 'error', message: '游戏已结束' });
      return;
    }

    const fullAction: GameAction = { ...action, player: playerName } as GameAction;

    const result = engine(this.state, fullAction);

    if (result.error) {
      this.sendToPlayer(playerId, { type: 'error', message: result.error });
      return;
    }

    this.state = result.state;

    this.broadcastEvents(result.events);
    this.checkGameEnd();
    this.broadcastGameView();
  }

  private broadcastEvents(events: import('../engine/v2/types').ServerEvent[]): void {
    if (events.length === 0) return;

    for (const [pid] of this.playerNames) {
      this.sendToPlayer(pid, {
        type: 'events',
        events: events.map(ev => ({
          id: ev.id,
          type: ev.type,
          timestamp: ev.timestamp,
          payload: ev.payload,
        })),
      });
    }
  }

  private broadcastGameView(): void {
    if (this.state?.meta.status !== '进行中') return;

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
    if (!this.state || !this.state.pending) return;
    if (Date.now() < this.state.pending.deadline) return;

    const onTimeout = this.state.pending.onTimeout;
    const result = engine(this.state, onTimeout);

    if (result.error) {
      this.logger.warn(`[Timeout] engine error: ${result.error}`);
      return;
    }

    this.state = result.state;
    this.broadcastEvents(result.events);
    this.checkGameEnd();
    this.broadcastGameView();
  }

  private clearTimeoutTimer(): void {
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  handleDisconnect(playerId: string): void {
    if (!this.state) return;

    const playerName = this.playerNames.get(playerId) ?? '未知玩家';
    if (this.state.meta.status === '进行中') {
      this.clearTimeoutTimer();
      setRoomStatus(this.room.id, '已结束');
      this.broadcast({ type: 'error', message: `${playerName} 断开连接，游戏结束` });
    }
  }

  getPlayerName(playerId: string): string | undefined {
    return this.playerNames.get(playerId);
  }

  getPending(): import('../engine/v2/types').PendingAction | null {
    return this.state?.pending ?? null;
  }

  reconnectPlayer(playerId: string, ws: import('hono/ws').WSContext): boolean {
    if (!this.state || this.state.meta.status !== '进行中') return false;
    this.room.players.set(playerId, ws);
    this.broadcastGameView();
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
    if (ws) {
      try {
        ws.send(serialize(message));
      } catch {
        // 忽略发送失败
      }
    }
  }

  private broadcast(message: ServerMessage): void {
    const data = serialize(message);
    for (const [, ws] of this.room.players) {
      try {
        ws.send(data);
      } catch {
        // 忽略发送失败
      }
    }
  }
}
