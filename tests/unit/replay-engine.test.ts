// 回放引擎纯函数测试。
// 验证 getViewAt 从 initialView 起步逐步 applyView 重建任意时刻视图。
// 使用真实 atom 事件(摸牌/造成伤害)验证 applyView 正确应用。

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getViewAt, totalSteps, availableSeats } from '../../src/client/replay/replayEngine';
import type { ReplayFile, SeatRecording } from '../../src/client/replay/types';
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

function makeSeat(events: SeatRecording['events']): SeatRecording {
  return {
    seatIndex: 0,
    playerName: '刘备',
    initialView: makeView(),
    events,
  };
}

function makeReplay(seats: Record<number, SeatRecording>): ReplayFile {
  return {
    format: 'sanguosha-replay',
    version: 1,
    meta: { createdAt: 1000, playerCount: 2, characters: ['刘备', '曹操'] },
    seats,
  };
}

describe('totalSteps', () => {
  it('返回 events 长度', () => {
    expect(totalSteps(makeSeat([{ seq: 0, time: 0, event: { type: '摸牌' } }]))).toBe(1);
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
          seq: 0,
          time: 0,
          event: { type: '造成伤害', target: 0, amount: 1, source: 1 },
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
      0: makeSeat([{ seq: 0, time: 0, event: { type: '造成伤害', target: 0, amount: 1, source: 1 } }]),
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
        { seq: 0, time: 0, event: { type: '造成伤害', target: 0, amount: 1, source: 1 } },
        { seq: 1, time: 0, event: { type: '造成伤害', target: 0, amount: 1, source: 1 } },
      ]),
    });
    expect(getViewAt(file, 0, 0)!.players[0].health).toBe(4);
    expect(getViewAt(file, 0, 1)!.players[0].health).toBe(3);
    expect(getViewAt(file, 0, 2)!.players[0].health).toBe(2);
  });

  it('不污染录像原始数据(initialView 保持初始值)', () => {
    const seat = makeSeat([
      { seq: 0, time: 0, event: { type: '造成伤害', target: 0, amount: 3, source: 1 } },
    ]);
    const file = makeReplay({ 0: seat });
    getViewAt(file, 0, 1);
    // 原始 initialView 不被突变
    expect(seat.initialView.players[0].health).toBe(4);
  });

  it('不同座次独立重建', () => {
    const file = makeReplay({
      0: makeSeat([
        { seq: 0, time: 0, event: { type: '造成伤害', target: 0, amount: 1, source: 1 } },
      ]),
      1: makeSeat([
        { seq: 0, time: 0, event: { type: '造成伤害', target: 1, amount: 2, source: 0 } },
      ]),
    });
    expect(getViewAt(file, 0, 1)!.players[0].health).toBe(3);
    expect(getViewAt(file, 1, 1)!.players[1].health).toBe(2);
  });
});
