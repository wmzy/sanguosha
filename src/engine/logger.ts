// engine/logger.ts — GameLogger + Operation 派生
//
// 把引擎广播的 ServerEvent[] 和玩家发送的 GameAction 转译为人类可读的
// Operation[]，按 serverOps（完整）+ playerOps[playerName]（视角隔离）积累。
//
// 设计依据：docs/design/日志与重播设计.md

import type { GameAction, GameState, Atom, AtomLogEntry, EquipSlot } from './types';
import type { Operation, GameLog } from '../shared/log';

const SLOT_LABELS: Record<EquipSlot, string> = {
  武器: '武器',
  防具: '防具',
  防御马: '防御马',
  进攻马: '进攻马',
};

const UNKNOWN_CARD = '未知牌';

function lookupCardName(state: GameState, cardId: string | undefined): string {
  return state.cardMap[cardId ?? '']?.name ?? UNKNOWN_CARD;
}

// ── 单事件 → Operation（server 视角，含完整信息） ─────────────────────

export function eventToServerOp(
  event: AtomLogEntry,
  state: GameState,
): Operation | null {
  const p = event.atom as unknown as Record<string, unknown>;
  const ts = event.timestamp;
  const type = event.atom.type;
  switch (type) {
    case '造成伤害': {
      const target = String(p.target ?? '');
      const amount = Number(p.amount ?? 0);
      const source = typeof p.source === 'string' ? p.source : '';
      const sourceLabel = source ? `${source}对${target}` : `${target}`;
      const cardId = typeof p.cardId === 'string' ? p.cardId : undefined;
      const cardLabel = cardId ? `（${lookupCardName(state, cardId)}）` : '';
      return {
        seq: 0,
        timestamp: ts,
        type: '造成伤害',
        data: { source, target, amount, cardId },
        description: `${sourceLabel}造成了${amount}点伤害${cardLabel}`,
      };
    }
    case '回复体力': {
      const target = String(p.target ?? '');
      const amount = Number(p.amount ?? 0);
      const newHealth = state.players[target]?.health ?? 0;
      return {
        seq: 0,
        timestamp: ts,
        type: '回复体力',
        data: { player: target, amount, newHealth },
        description: `${target}回复了${amount}点体力（当前${newHealth}）`,
      };
    }
    case '弃置': {
      const player = String(p.player ?? '');
      const cardIds = Array.isArray(p.cardIds) ? (p.cardIds as string[]) : [];
      const names = cardIds.map((id) => lookupCardName(state, id)).join('、');
      return {
        seq: 0,
        timestamp: ts,
        type: '弃置',
        data: { player, cards: cardIds },
        description: names
          ? `${player}弃了${cardIds.length}张牌（${names}）`
          : `${player}弃了${cardIds.length}张牌`,
      };
    }
    case '装备': {
      const player = String(p.player ?? '');
      const cardId = String(p.cardId ?? '');
      const slot = String(p.slot ?? '') as EquipSlot;
      const slotLabel = SLOT_LABELS[slot] ?? slot;
      return {
        seq: 0,
        timestamp: ts,
        type: '装备',
        data: { player, cardId, slot },
        description: `${player}装备了${lookupCardName(state, cardId)}（${slotLabel}）`,
      };
    }
    case '卸下': {
      const player = String(p.player ?? '');
      const slot = String(p.slot ?? '') as EquipSlot;
      const slotLabel = SLOT_LABELS[slot] ?? slot;
      return {
        seq: 0,
        timestamp: ts,
        type: '装备',
        data: { player, slot },
        description: `${player}卸下了${slotLabel}`,
      };
    }
    case '设阶段': {
      const phase = String(p.phase ?? '');
      const player = String(p.player ?? '');
      return {
        seq: 0,
        timestamp: ts,
        type: '阶段变更',
        data: { phase, player },
        description: `进入${phase}阶段（${player}）`,
      };
    }
    case '下一玩家': {
      const from = String(p.from ?? '');
      const to = String(p.to ?? '');
      const turnNumber = Number(p.turnNumber ?? 0);
      const round = Number(p.round ?? 0);
      return {
        seq: 0,
        timestamp: ts,
        type: '回合变更',
        data: { from, to, turnNumber, round },
        description: `${to}的回合开始（第${round}轮·第${turnNumber}回合）`,
      };
    }
    case '回合开始': {
      return null;
    }
    case '击杀': {
      const player = String(p.player ?? '');
      const source = typeof p.source === 'string' ? p.source : undefined;
      return {
        seq: 0,
        timestamp: ts,
        type: '造成伤害',
        data: { kill: true, player, source },
        description: source ? `${player}阵亡（来源：${source}）` : `${player}阵亡`,
      };
    }
    case '濒死': {
      const player = String(p.player ?? '');
      return {
        seq: 0,
        timestamp: ts,
        type: '造成伤害',
        data: { dying: true, player },
        description: `${player}濒死`,
      };
    }
    case '加技能': {
      const player = String(p.player ?? '');
      const skillId = String(p.skillId ?? '');
      return {
        seq: 0,
        timestamp: ts,
        type: '技能发动',
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
  event: AtomLogEntry,
  state: GameState,
  playerName: string,
): Operation | null {
  const type = event.atom.type;
  if (type === '摸牌') {
    const p = event.atom as unknown as Record<string, unknown>;
    const drawer = String(p.player ?? '');
    const count = Number(p.count ?? 0);
    const cardIds = Array.isArray(p.cards) ? (p.cards as string[]) : [];
    if (drawer === playerName) {
      const names = cardIds.map((id) => lookupCardName(state, id)).join('、');
      return {
        seq: 0,
        timestamp: event.timestamp,
        type: '摸牌',
        data: { player: drawer, count, cards: cardIds },
        description: names
          ? `${drawer}摸了${count}张牌（${names}）`
          : `${drawer}摸了${count}张牌`,
      };
    }
    return {
      seq: 0,
      timestamp: event.timestamp,
      type: '摸牌',
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
    case '开始':
      return {
        seq: 0,
        timestamp: ts,
        type: '游戏开始',
        data: {},
        description: '游戏开始',
      };
    case '打出一张牌': {
      const cardId = String(action.cardId ?? '');
      const target = action.target;
      return {
        seq: 0,
        timestamp: ts,
        type: '出牌',
        data: { player: action.player, cardId, target },
        description: target
          ? `${action.player}使用了${lookupCardName(state, cardId)}（目标：${target}）`
          : `${action.player}使用了${lookupCardName(state, cardId)}`,
      };
    }
    case '打出': {
      const cardId = action.cardId ?? action.cardIds?.[0];
      return {
        seq: 0,
        timestamp: ts,
        type: '出牌',
        data: { player: action.player, cardId },
        description: `${action.player}打出了${lookupCardName(state, cardId)}响应`,
      };
    }
    case '使用技能': {
      const skillId = String(action.skillId ?? '');
      return {
        seq: 0,
        timestamp: ts,
        type: '技能发动',
        data: { player: action.player, skillId },
        description: `${action.player}发动了技能【${skillId}】`,
      };
    }
    case '技能选择':
      return {
        seq: 0,
        timestamp: ts,
        type: '技能发动',
        data: { player: action.player },
        description: `${action.player}选择技能选项`,
      };
    case '结束回合':
    case '弃置':
    case '切换自动跳过无懈可击':
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
    serverEntries: AtomLogEntry[],
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

    for (const entry of serverEntries) {
      const serverOp = eventToServerOp(entry, state);
      if (serverOp) {
        serverOp.seq = this.nextServerSeq();
        this._serverOps.push(serverOp);
        serverOps.push(serverOp);
      }
      for (const player of Object.keys(this._playerOps)) {
        const playerOp = eventToPlayerOp(entry, state, player);
        if (playerOp) {
          playerOp.seq = this.nextPlayerSeq(player);
          playerOp.timestamp = playerOp.timestamp || entry.timestamp;
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

  rebuildFromLog(state: GameState, serverLog: AtomLogEntry[]): void {
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
