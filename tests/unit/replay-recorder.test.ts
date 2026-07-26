// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ReplayRecorder } from '../../src/client/replay/recorder';
import type { GameView, ViewEvent } from '../../src/engine/types';
import type { ReplayMeta } from '../../src/client/replay/types';

/** 造最小 GameView(只含回放引擎需要的字段)。
 *  character 默认 = playerName(选将完成后的真实状态);传 '' 模拟选将未完成。 */
function makeView(viewer: number, playerName: string, character = playerName): GameView {
  return {
    viewer,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: viewer,
        name: playerName,
        character,
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

function makeEvent(type: string, extra: Record<string, unknown> = {}): ViewEvent {
  return { type, ...extra };
}

const META: ReplayMeta = {
  createdAt: 1000,
  playerCount: 1,
  characters: ['刘备'],
};

describe('ReplayRecorder', () => {
  it('首次 record 捕获 initialView', () => {
    const r = new ReplayRecorder();
    const view = makeView(0, '刘备');
    r.record(0, view, []);
    const file = r.finalize(META);
    expect(file.seats[0]).toBeDefined();
    expect(file.seats[0].initialView.players[0].name).toBe('刘备');
  });

  it('累积 events,seq 递增', () => {
    const r = new ReplayRecorder();
    const view = makeView(0, '刘备');
    r.record(0, view, [makeEvent('回合开始'), makeEvent('摸牌')]);
    r.record(0, view, [makeEvent('出牌')]);
    const file = r.finalize(META);
    expect(file.seats[0].events).toHaveLength(3);
    expect(file.seats[0].events.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('view 为 null 时不捕获 initialView,后续事件丢弃', () => {
    const r = new ReplayRecorder();
    r.record(0, null, [makeEvent('回合开始')]);
    expect(r.hasData()).toBe(false);
    const file = r.finalize(META);
    expect(file.seats[0]).toBeUndefined();
  });

  it('选将未完成(存在 character 为空的玩家)时跳过捕获与记录', () => {
    // Bug: initialView 捕获于抽身份/选将询问阶段时,所有 character 为空,
    // 回放初始帧(step=0)全部武将名显示「未知」。
    // 修复:recorder 等所有玩家 character 非空(选将完成)后才捕获 baseline。
    const r = new ReplayRecorder();
    // 选将阶段:character 空 → 不捕获、不记录
    r.record(0, makeView(0, 'player-0', ''), [makeEvent('分配武将')]);
    expect(r.hasData()).toBe(false);
    // 选将完成后:character 满 → 捕获 initialView,开始记录
    r.record(0, makeView(0, '刘备'), [makeEvent('回合开始')]);
    expect(r.hasData()).toBe(true);
    const file = r.finalize(META);
    expect(file.seats[0]).toBeDefined();
    // initialView 捕获于选将完成后,武将名非空
    expect(file.seats[0].initialView.players[0].character).toBe('刘备');
    // 选将阶段的「分配武将」事件被丢弃,只记录选将完成后的「回合开始」
    expect(file.seats[0].events).toHaveLength(1);
    expect(file.seats[0].events[0].event.type).toBe('回合开始');
  });

  it('多座次独立录制', () => {
    const r = new ReplayRecorder();
    r.record(0, makeView(0, '刘备'), [makeEvent('摸牌')]);
    r.record(1, makeView(1, '曹操'), [makeEvent('摸牌'), makeEvent('摸牌')]);
    const file = r.finalize({ ...META, playerCount: 2, characters: ['刘备', '曹操'] });
    expect(Object.keys(file.seats).sort()).toEqual(['0', '1']);
    expect(file.seats[0].events).toHaveLength(1);
    expect(file.seats[1].events).toHaveLength(2);
  });

  it('initialView 是深拷贝(后续 view 变化不影响)', () => {
    const r = new ReplayRecorder();
    const view = makeView(0, '刘备');
    r.record(0, view, []);
    // 突变原始 view
    view.players[0].health = 1;
    const file = r.finalize(META);
    expect(file.seats[0].initialView.players[0].health).toBe(4);
  });

  it('reset 清空所有座次', () => {
    const r = new ReplayRecorder();
    r.record(0, makeView(0, '刘备'), [makeEvent('摸牌')]);
    r.reset();
    expect(r.hasData()).toBe(false);
    const file = r.finalize(META);
    expect(file.seats[0]).toBeUndefined();
  });

  it('finalize 生成正确的 format/version', () => {
    const r = new ReplayRecorder();
    const file = r.finalize(META);
    expect(file.format).toBe('sanguosha-replay');
    expect(file.version).toBe(1);
    expect(file.meta).toEqual(META);
  });

  it('time 字段记录调用时间', () => {
    const r = new ReplayRecorder();
    r.record(0, makeView(0, '刘备'), [makeEvent('摸牌')], 12345);
    const file = r.finalize(META);
    expect(file.seats[0].events[0].time).toBe(12345);
  });
});
