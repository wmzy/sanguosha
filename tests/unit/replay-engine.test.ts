// 回放引擎纯函数测试。
// 验证 getViewAt 从 baseline + seatDelta 重建 initialView,逐步 applyView 重建任意时刻视图。
// 使用真实 atom 事件(摸牌/造成伤害)验证 applyView 正确应用。

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getViewAt, totalSteps, availableSeats } from '../../src/client/replay/replayEngine';
import type {
  ReplayFile,
  SeatDelta,
  ReplayBaseline,
  ReplayEvent,
} from '../../src/client/replay/types';
import type { GameView } from '../../src/engine/types';

function makeView(): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: '刘备',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
      {
        index: 1,
        name: '曹操',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
    ],
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

/** 从 makeView() 拆出跨座次共享的公共部分(players 去掉 viewer-dependent 的私有字段)。 */
function makeBaseline(): ReplayBaseline {
  const view = makeView();
  return {
    cardMap: view.cardMap,
    log: view.log,
    turn: view.turn,
    phase: view.phase,
    currentPlayerIndex: view.currentPlayerIndex,
    zones: view.zones,
    settlementStack: view.settlementStack,
    pending: view.pending,
    deadline: view.deadline,
    deadlineTotalMs: view.deadlineTotalMs,
    players: view.players.map((p) => {
      const { hand: _hand, identity: _identity, identityHidden: _identityHidden, ...pub } = p;
      return pub;
    }),
  };
}

/** 构造单座次私有差异。makeView() 的 players 不含 hand 字段,privateHands 为空;
 *  identityView 全部映射(身份均为 undefined,即未分配)。 */
function makeSeat(events: ReplayEvent[], viewer = 0): SeatDelta {
  const view = makeView();
  return {
    viewer,
    playerName: view.players[viewer]?.name ?? `P${viewer}`,
    privateHands: view.players
      .filter((p) => p.hand !== undefined)
      .map((p) => ({ index: p.index, hand: p.hand! })),
    identityView: view.players.map((p) => ({
      index: p.index,
      identity: p.identity,
      identityHidden: p.identityHidden,
    })),
    events,
  };
}

function makeReplay(seats: Record<number, SeatDelta>): ReplayFile {
  return {
    format: 'sanguosha-replay',
    version: 2,
    meta: { createdAt: 1000, playerCount: 2, characters: ['刘备', '曹操'] },
    baseline: makeBaseline(),
    seats,
  };
}

describe('totalSteps', () => {
  it('返回 events 长度', () => {
    expect(totalSteps(makeSeat([{ time: 0, event: { type: '摸牌' } }]))).toBe(1);
  });

  it('undefined 返回 0', () => {
    expect(totalSteps(undefined)).toBe(0);
  });
});

describe('availableSeats', () => {
  it('返回座次升序', () => {
    const file = makeReplay({
      1: makeSeat([]),
      0: makeSeat([]),
    });
    expect(availableSeats(file)).toEqual([0, 1]);
  });
});

describe('getViewAt', () => {
  it('step=0 返回 initialView', () => {
    const file = makeReplay({ 0: makeSeat([]) });
    const view = getViewAt(file, 0, 0)!;
    expect(view.players[0].health).toBe(4);
  });

  it('造成伤害 applyView 生效:step=1 时目标血量 -1', () => {
    const file = makeReplay({
      0: makeSeat([
        {
          time: 0,
          event: { type: '扣减体力', target: 0, amount: 1 },
        },
      ]),
    });
    const v0 = getViewAt(file, 0, 0)!;
    const v1 = getViewAt(file, 0, 1)!;
    expect(v0.players[0].health).toBe(4);
    expect(v1.players[0].health).toBe(3);
  });

  it('不存在的座次返回 null', () => {
    const file = makeReplay({ 0: makeSeat([]) });
    expect(getViewAt(file, 99, 0)).toBeNull();
  });

  it('step 超出范围 clamp 到 totalSteps', () => {
    const file = makeReplay({
      0: makeSeat([{ time: 0, event: { type: '扣减体力', target: 0, amount: 1 } }]),
    });
    // step=100 远超 events.length=1,应 clamp 到 1
    const view = getViewAt(file, 0, 100)!;
    expect(view.players[0].health).toBe(3);
  });

  it('负数 step clamp 到 0', () => {
    const file = makeReplay({ 0: makeSeat([]) });
    const view = getViewAt(file, 0, -5)!;
    expect(view.players[0].health).toBe(4);
  });

  it('多步累积:连续两次伤害血量 -2', () => {
    const file = makeReplay({
      0: makeSeat([
        { time: 0, event: { type: '扣减体力', target: 0, amount: 1 } },
        { time: 0, event: { type: '扣减体力', target: 0, amount: 1 } },
      ]),
    });
    expect(getViewAt(file, 0, 0)!.players[0].health).toBe(4);
    expect(getViewAt(file, 0, 1)!.players[0].health).toBe(3);
    expect(getViewAt(file, 0, 2)!.players[0].health).toBe(2);
  });

  it('不污染录像原始数据(baseline 保持初始值)', () => {
    const seat = makeSeat([
      { time: 0, event: { type: '扣减体力', target: 0, amount: 3 } },
    ]);
    const file = makeReplay({ 0: seat });
    getViewAt(file, 0, 1);
    // 原始 baseline 不被突变(reconstructInitialView 深拷贝 baseline)
    expect(file.baseline.players[0].health).toBe(4);
  });

  it('不同座次独立重建', () => {
    const file = makeReplay({
      0: makeSeat([
        { time: 0, event: { type: '扣减体力', target: 0, amount: 1 } },
      ]),
      1: makeSeat([{ time: 0, event: { type: '扣减体力', target: 1, amount: 2 } }], 1),
    });
    expect(getViewAt(file, 0, 1)!.players[0].health).toBe(3);
    expect(getViewAt(file, 1, 1)!.players[1].health).toBe(2);
  });
});
