// src/client/replay/recorder.ts
// 录制器:收集各座次的 ViewEvent,结束时组装为 v2 ReplayFile(baseline + delta)。
//
// 本类现为服务端对局历史组装专用(src/server/gameHistory.ts 复用它把
// 「开局基线视图 + 差量事件」组装成与本地录制格式一致的录像),客户端不再接入
// (录像下载统一走服务端导出,连接层已移除录制逻辑)。
//
// 内部仍逐座次收集完整 initialView(深拷贝),在 finalize 时:
//   1. 取最小座次的 initialView 提取公共 baseline(cardMap/log/turn/公开玩家信息…)
//   2. 为每座次计算私有 delta(viewer 手牌 + 身份可见性 + 事件流[去冗余 seq])
// 这样录制逻辑零改动,去重归并集中在 finalize 一步。

import type { GameView, ViewEvent } from '../../engine/types';
import type {
  ReplayBaseline,
  ReplayEvent,
  ReplayFile,
  ReplayMeta,
  SeatDelta,
} from './types';

/** 深拷贝 GameView(剥离函数引用,保证 JSON 可序列化) */
function cloneView(view: GameView): GameView {
  return JSON.parse(JSON.stringify(view)) as GameView;
}

/** recorder 内部中间结构:完整 initialView + 带 seq 的 events(录制期用) */
interface InternalSeat {
  seatIndex: number;
  playerName: string;
  initialView: GameView;
  events: Array<{ seq: number; time: number; event: ViewEvent }>;
}

/** 从某座次 initialView 提取公共 baseline(剥离 viewer-dependent 字段) */
function extractBaseline(view: GameView): ReplayBaseline {
  const {
    cardMap,
    log,
    turn,
    phase,
    currentPlayerIndex,
    zones,
    settlementStack,
    pending,
    deadline,
    deadlineTotalMs,
    players,
  } = view;
  return {
    cardMap,
    log,
    turn,
    phase,
    currentPlayerIndex,
    zones,
    settlementStack,
    pending,
    deadline,
    deadlineTotalMs,
    // players 剥离 hand/identity/identityHidden(这三个是 viewer-dependent)
    players: players.map((p) => {
      const { hand: _hand, identity: _identity, identityHidden: _hidden, ...pub } = p;
      return pub;
    }),
  };
}

/** 从内部座次记录提取私有 delta */
function extractDelta(rec: InternalSeat): SeatDelta {
  const v = rec.initialView;
  const privateHands: SeatDelta['privateHands'] = [];
  const identityView: SeatDelta['identityView'] = [];
  for (const p of v.players) {
    if (p.hand !== undefined) {
      privateHands.push({ index: p.index, hand: p.hand });
    }
    identityView.push({
      index: p.index,
      identity: p.identity,
      identityHidden: p.identityHidden,
    });
  }
  const events: ReplayEvent[] = rec.events.map((e) => ({ time: e.time, event: e.event }));
  return {
    viewer: v.viewer,
    playerName: rec.playerName,
    privateHands,
    identityView,
    events,
  };
}

export class ReplayRecorder {
  /** seatIndex → 内部录像 */
  private seats = new Map<number, InternalSeat>();
  /** 各座次内部 seq 计数器 */
  private seqCounters = new Map<number, number>();
  /** 各座次是否已捕获 initialView */
  private initialized = new Set<number>();

  /**
   * 记录某座次收到的事件批次。
   *
   * @param seat 座次下标
   * @param view 该座次当前 GameView(用于首次捕获 initialView)
   * @param events 本次新事件
   */
  record(seat: number, view: GameView | null, events: ViewEvent[], now: number = Date.now()): void {
    // 首次产生「选将已完成」的 view 时才捕获 initialView。
    // 选将阶段(存在 character 为空的玩家)的 view 不捕获、事件也不记录——
    // 否则 initialView 会捕获于抽身份/选将询问阶段(所有 character 为空),
    // 回放初始帧(step=0)全部武将名显示「未知」。选将完成后的第一个 view
    // 已包含所有玩家的武将名/势力/体力,作为录像起点语义完整;
    // 选将阶段事件(抽身份/发牌/分配武将)的结果均已体现在此 baseline。
    if (view && !this.initialized.has(seat)) {
      if (view.players.length === 0 || !view.players.every((p) => p.character)) {
        return;
      }
      this.seats.set(seat, {
        seatIndex: seat,
        playerName: view.players[seat]?.name ?? (seat < 0 ? '旁观' : `P${seat}`),
        initialView: cloneView(view),
        events: [],
      });
      this.seqCounters.set(seat, 0);
      this.initialized.add(seat);
    }

    const rec = this.seats.get(seat);
    if (!rec) return; // 座次未初始化(还没有 view),丢弃事件

    let seq = this.seqCounters.get(seat) ?? 0;
    for (const event of events) {
      rec.events.push({ seq, time: now, event });
      seq++;
    }
    this.seqCounters.set(seat, seq);
  }

  /** 是否有可导出的录像数据(至少一个座次已初始化) */
  hasData(): boolean {
    return this.initialized.size > 0;
  }

  /** 组装最终录像文件(v2: baseline + delta)。游戏结束时调用。 */
  finalize(meta: ReplayMeta): ReplayFile {
    const entries = [...this.seats.entries()].sort((a, b) => a[0] - b[0]);
    if (entries.length === 0) {
      // 无数据:返回空 baseline(调用方一般先 hasData 检查)
      return {
        format: 'sanguosha-replay',
        version: 2,
        meta,
        baseline: {
          cardMap: {},
          log: [],
          turn: { round: 0, phase: '准备', vars: {} },
          phase: '准备',
          currentPlayerIndex: 0,
          zones: { deckCount: 0, discardPileCount: 0, processing: [] },
          settlementStack: [],
          pending: null,
          deadline: null,
          deadlineTotalMs: 0,
          players: [],
        },
        seats: {},
      };
    }

    // 取最小玩家座次的 initialView 作为 baseline 基准(旁观座次 -1 排序最前,
    // 但公开部分与玩家座次一致;优先真实座次,保持与旧格式文件同构)
    const playerEntry = entries.find(([seat]) => seat >= 0) ?? entries[0];
    const [, base] = playerEntry;
    const baseline = extractBaseline(base.initialView);

    const seats: Record<number, SeatDelta> = {};
    for (const [seat, rec] of entries) {
      seats[seat] = extractDelta(rec);
    }
    return { format: 'sanguosha-replay', version: 2, meta, baseline, seats };
  }

  /** 清空(新一局重置) */
  reset(): void {
    this.seats.clear();
    this.seqCounters.clear();
    this.initialized.clear();
  }
}
