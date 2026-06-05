// engine/logger.ts — GameLogger + Operation 派生
//
// 把引擎广播的 ServerEvent[] 和玩家发送的 GameAction 转译为人类可读的
// Operation[]，按 serverOps（完整）+ playerOps[playerName]（视角隔离）积累。
//
// 设计依据：docs/design/日志与重播设计.md

import type { GameAction, GameState, ServerEvent, EquipSlot } from './types';
import type { Operation, GameLog } from '../shared/log';

const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: '武器',
  armor: '防具',
  horsePlus: '防御马',
  horseMinus: '进攻马',
};

const UNKNOWN_CARD = '未知牌';

function lookupCardName(state: GameState, cardId: string | undefined): string {
  return state.cardMap[cardId ?? '']?.name ?? UNKNOWN_CARD;
}

// ── 单事件 → Operation（server 视角，含完整信息） ─────────────────────

export function eventToServerOp(
  event: ServerEvent,
  state: GameState,
): Operation | null {
  const p = event.payload as Record<string, unknown>;
  const ts = event.timestamp;

  switch (event.type) {
    case 'damage': {
      const target = String(p.target ?? '');
      const amount = Number(p.amount ?? 0);
      const source = typeof p.source === 'string' ? p.source : '';
      const sourceLabel = source ? `${source}对${target}` : `${target}`;
      const cardId = typeof p.cardId === 'string' ? p.cardId : undefined;
      const cardLabel = cardId ? `（${lookupCardName(state, cardId)}）` : '';
      return {
        seq: 0,
        timestamp: ts,
        type: 'damage',
        data: { source, target, amount, cardId },
        description: `${sourceLabel}造成了${amount}点伤害${cardLabel}`,
      };
    }
    case 'heal': {
      const target = String(p.target ?? '');
      const amount = Number(p.amount ?? 0);
      const newHealth = state.players[target]?.health ?? 0;
      return {
        seq: 0,
        timestamp: ts,
        type: 'heal',
        data: { player: target, amount, newHealth },
        description: `${target}回复了${amount}点体力（当前${newHealth}）`,
      };
    }
    case 'cardsDiscarded': {
      const player = String(p.player ?? '');
      const cardIds = Array.isArray(p.cardIds) ? (p.cardIds as string[]) : [];
      const names = cardIds.map((id) => lookupCardName(state, id)).join('、');
      return {
        seq: 0,
        timestamp: ts,
        type: 'discard',
        data: { player, cards: cardIds },
        description: names
          ? `${player}弃了${cardIds.length}张牌（${names}）`
          : `${player}弃了${cardIds.length}张牌`,
      };
    }
    case 'equip': {
      const player = String(p.player ?? '');
      const cardId = String(p.cardId ?? '');
      const slot = String(p.slot ?? '') as EquipSlot;
      const slotLabel = SLOT_LABELS[slot] ?? slot;
      return {
        seq: 0,
        timestamp: ts,
        type: 'equip',
        data: { player, cardId, slot },
        description: `${player}装备了${lookupCardName(state, cardId)}（${slotLabel}）`,
      };
    }
    case 'unequip': {
      const player = String(p.player ?? '');
      const slot = String(p.slot ?? '') as EquipSlot;
      const slotLabel = SLOT_LABELS[slot] ?? slot;
      return {
        seq: 0,
        timestamp: ts,
        type: 'equip',
        data: { player, slot },
        description: `${player}卸下了${slotLabel}`,
      };
    }
    case 'setPhase': {
      const phase = String(p.phase ?? '');
      const player = String(p.player ?? '');
      return {
        seq: 0,
        timestamp: ts,
        type: 'phaseChange',
        data: { phase, player },
        description: `进入${phase}阶段（${player}）`,
      };
    }
    case 'nextPlayer': {
      const from = String(p.from ?? '');
      const to = String(p.to ?? '');
      const turnNumber = Number(p.turnNumber ?? 0);
      const round = Number(p.round ?? 0);
      return {
        seq: 0,
        timestamp: ts,
        type: 'turnChange',
        data: { from, to, turnNumber, round },
        description: `${to}的回合开始（第${round}轮·第${turnNumber}回合）`,
      };
    }
    case 'turnStart': {
      return null;
    }
    case 'kill': {
      const player = String(p.player ?? '');
      const source = typeof p.source === 'string' ? p.source : undefined;
      return {
        seq: 0,
        timestamp: ts,
        type: 'damage',
        data: { kill: true, player, source },
        description: source ? `${player}阵亡（来源：${source}）` : `${player}阵亡`,
      };
    }
    case 'dying': {
      const player = String(p.player ?? '');
      return {
        seq: 0,
        timestamp: ts,
        type: 'damage',
        data: { dying: true, player },
        description: `${player}濒死`,
      };
    }
    case 'addSkill': {
      const player = String(p.player ?? '');
      const skillId = String(p.skillId ?? '');
      return {
        seq: 0,
        timestamp: ts,
        type: 'skillActivate',
        data: { player, skillId },
        description: `${player}获得了技能【${skillId}】`,
      };
    }
    default:
      return null;
  }
}

// ── 视角裁剪：单事件 → Operation（player 视角） ──────────────────────

export function eventToPlayerOp(
  event: ServerEvent,
  state: GameState,
  playerName: string,
): Operation | null {
  if (event.type === 'draw') {
    const p = event.payload as Record<string, unknown>;
    const drawer = String(p.player ?? '');
    const count = Number(p.count ?? 0);
    const cardIds = Array.isArray(p.cards) ? (p.cards as string[]) : [];
    if (drawer === playerName) {
      const names = cardIds.map((id) => lookupCardName(state, id)).join('、');
      return {
        seq: 0,
        timestamp: event.timestamp,
        type: 'draw',
        data: { player: drawer, count, cards: cardIds },
        description: names
          ? `${drawer}摸了${count}张牌（${names}）`
          : `${drawer}摸了${count}张牌`,
      };
    }
    return {
      seq: 0,
      timestamp: event.timestamp,
      type: 'draw',
      data: { player: drawer, count },
      description: `${drawer}摸了${count}张牌`,
    };
  }

  return eventToServerOp(event, state);
}

// ── GameAction → Operation ──────────────────────────────────────────

export function actionToOp(action: GameAction, state: GameState): Operation | null {
  const ts = Date.now();
  switch (action.type) {
    case 'startGame':
      return {
        seq: 0,
        timestamp: ts,
        type: 'gameStart',
        data: {},
        description: '游戏开始',
      };
    case 'playCard': {
      const cardId = String(action.cardId ?? '');
      const target = action.target;
      return {
        seq: 0,
        timestamp: ts,
        type: 'play',
        data: { player: action.player, cardId, target },
        description: target
          ? `${action.player}使用了${lookupCardName(state, cardId)}（目标：${target}）`
          : `${action.player}使用了${lookupCardName(state, cardId)}`,
      };
    }
    case 'respond': {
      const cardId = action.cardId ?? action.cardIds?.[0];
      return {
        seq: 0,
        timestamp: ts,
        type: 'play',
        data: { player: action.player, cardId },
        description: `${action.player}打出了${lookupCardName(state, cardId)}响应`,
      };
    }
    case 'useSkill': {
      const skillId = String(action.skillId ?? '');
      return {
        seq: 0,
        timestamp: ts,
        type: 'skillActivate',
        data: { player: action.player, skillId },
        description: `${action.player}发动了技能【${skillId}】`,
      };
    }
    case 'skillChoice':
      return {
        seq: 0,
        timestamp: ts,
        type: 'skillActivate',
        data: { player: action.player },
        description: `${action.player}选择技能选项`,
      };
    case 'endTurn':
    case 'discard':
    case 'toggleAutoSkipWuxie':
      return null;
    default:
      return null;
  }
}

// ── GameLogger 类 ───────────────────────────────────────────────────

export interface RecordBatchResult {
  serverOps: Operation[];
  playerOps: Record<string, Operation[]>;
}

export class GameLogger {
  private meta: GameLog['meta'];
  private _serverOps: Operation[] = [];
  private _playerOps: Record<string, Operation[]> = {};
  private serverSeq = 0;
  private playerSeqs: Record<string, number> = {};

  constructor(meta: GameLog['meta'], players: string[]) {
    this.meta = meta;
    for (const p of players) this._playerOps[p] = [];
  }

  private nextServerSeq(): number {
    return this.serverSeq++;
  }

  private nextPlayerSeq(player: string): number {
    const seq = (this.playerSeqs[player] ?? -1) + 1;
    this.playerSeqs[player] = seq;
    return seq;
  }

  recordBatch(
    action: GameAction | null,
    serverEvents: ServerEvent[],
    state: GameState,
  ): RecordBatchResult {
    const serverOps: Operation[] = [];
    const playerOps: Record<string, Operation[]> = {};
    for (const player of Object.keys(this._playerOps)) {
      playerOps[player] = [];
    }

    if (action) {
      const op = actionToOp(action, state);
      if (op) {
        op.seq = this.nextServerSeq();
        op.timestamp = op.timestamp || Date.now();
        this._serverOps.push(op);
        serverOps.push(op);
        for (const player of Object.keys(this._playerOps)) {
          const pOp: Operation = { ...op, seq: this.nextPlayerSeq(player) };
          this._playerOps[player].push(pOp);
          playerOps[player].push(pOp);
        }
      }
    }

    for (const event of serverEvents) {
      const serverOp = eventToServerOp(event, state);
      if (serverOp) {
        serverOp.seq = this.nextServerSeq();
        this._serverOps.push(serverOp);
        serverOps.push(serverOp);
      }
      for (const player of Object.keys(this._playerOps)) {
        const playerOp = eventToPlayerOp(event, state, player);
        if (playerOp) {
          playerOp.seq = this.nextPlayerSeq(player);
          playerOp.timestamp = playerOp.timestamp || event.timestamp;
          this._playerOps[player].push(playerOp);
          playerOps[player].push(playerOp);
        }
      }
    }

    return { serverOps, playerOps };
  }

  export(): GameLog {
    return {
      meta: { ...this.meta },
      serverOps: [...this._serverOps],
      playerOps: Object.fromEntries(
        Object.entries(this._playerOps).map(([k, v]) => [k, [...v]]),
      ),
    };
  }

  getServerOps(): Operation[] {
    return [...this._serverOps];
  }

  getPlayerOps(playerName: string): Operation[] {
    return [...(this._playerOps[playerName] ?? [])];
  }

  rebuildFromLog(state: GameState, serverLog: ServerEvent[]): void {
    this._serverOps = [];
    this._playerOps = {};
    for (const p of state.playerOrder) this._playerOps[p] = [];
    this.serverSeq = 0;
    this.playerSeqs = {};
    for (const event of serverLog) {
      this.recordBatch(null, [event], state);
    }
  }
}
