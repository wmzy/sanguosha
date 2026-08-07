// tests/headless/viewMaintainer.test.ts
import { describe, it, expect } from 'vitest';
import { applyServerMessage } from '../../src/client/headless/viewMaintainer';
import type { GameView } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';

function makeBaseline(viewer: number): GameView {
  return {
    viewer,
    currentPlayerIndex: viewer,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: viewer,
        name: 'P0',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['仁德'],
        handCount: 4,
        hand: [],
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

describe('applyServerMessage', () => {
  it('initialView 建立 baseline view 并记录 lastSeq', () => {
    const baseline = makeBaseline(0);
    const msg: ServerMessage = { type: 'initialView', state: baseline, lastSeq: 7 };
    const out = applyServerMessage(null, 0, msg);
    expect(out.view).not.toBeNull();
    expect(out.view!.viewer).toBe(0);
    expect(out.lastSeq).toBe(7);
    expect(out.phaseChangedTo).toBe('playing');
  });

  it('event 的 view 增量更新经 viewReducer 且推进 lastSeq', () => {
    const baseline = makeBaseline(0);
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    // 使用 加标签 atom——无 applyView 副作用，viewReducer 安全跳过，不抛错
    const evt = {
      type: 'event',
      seq: 1,
      timestamp: 100,
      view: { type: '加标签', player: 0, tag: 'test' },
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    expect(out.lastSeq).toBe(1);
    expect(out.newEvents.length).toBeGreaterThan(0);
  });

  it('event 的 notify pendingResolved 清除匹配本座次的 pending', () => {
    const baseline = makeBaseline(0);
    baseline.pending = {
      type: 'awaits',
      atom: { type: '询问闪', player: 0 } as any,
      prompt: { type: 'useCard', cardFilter: { filter: () => true } } as any,
      target: 0,
      isBlocking: true,
    };
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const evt = {
      type: 'event',
      seq: 1,
      timestamp: 100,
      notify: { skillId: '', eventType: 'pendingResolved', data: { target: 0 } },
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    expect(out.view!.pending).toBeNull();
  });

  it('event 的 deadline 权威覆盖 view.deadline（无 pending 时）', () => {
    const baseline = makeBaseline(0);
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const evt = {
      type: 'event',
      seq: 1,
      timestamp: 100,
      deadline: { deadline: 9999, totalMs: 30000 },
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    expect(out.view!.deadline).toBe(9999);
    expect(out.view!.deadlineTotalMs).toBe(30000);
  });

  it('gameOver 切到 ended', () => {
    const baseline = makeBaseline(0);
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const out = applyServerMessage(start.view, start.lastSeq, { type: 'gameOver', winner: '主公' });
    expect(out.phaseChangedTo).toBe('ended');
    expect(out.gameOverWinner).toBe('主公');
  });

  it('room_joined 更新 playerId', () => {
    const out = applyServerMessage(null, 0, {
      type: 'room_joined',
      roomId: 'r1',
      playerId: 'pid-1',
      seatIndex: 0,
    });
    expect(out.playerId).toBe('pid-1');
    expect(out.seatIndex).toBe(0);
  });

  it('game_reset 清空 view、置 resetToLobby 标记、phase 切到 lobby', () => {
    const baseline = makeBaseline(0);
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 5 });
    expect(start.view).not.toBeNull();
    expect(start.lastSeq).toBe(5);
    // 再来一局:服务端广播 game_reset,客户端清场回到准备阶段
    const out = applyServerMessage(start.view, start.lastSeq, { type: 'game_reset' });
    expect(out.view).toBeNull();
    expect(out.lastSeq).toBe(0);
    expect(out.resetToLobby).toBe(true);
    expect(out.phaseChangedTo).toBe('lobby');
  });

  it('event 的 view 增量为 zones 创建新引用(避免 ZoneInfoBar memo 永远判等)', () => {
    // Bug 1 & Bug 2 回归:view={...view} 只浅拷贝顶层,zones 仍是同引用；
    // applyView 原地突变 zones 后,prev/next 的 zones 指向同一对象,memo 比较器
    // 读到的 deckCount/discardPileCount/processing 永远相同 → 永不重渲染。
    const baseline = makeBaseline(0);
    baseline.zones = { deckCount: 50, discardPileCount: 0, processing: [] };
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const prevZones = start.view!.zones!;
    const evt = {
      type: 'event',
      seq: 1,
      timestamp: 100,
      view: { type: '加标签', player: 0, tag: 'test' },
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    // zones 必须是新引用,否则 ZoneInfoBar memo 比较器判等跳过重渲染
    expect(out.view!.zones).not.toBe(prevZones);
    // processing 数组也必须是新引用(applyView 会 push/filter 它)
    expect(out.view!.zones!.processing).not.toBe(prevZones.processing);
    // 浅拷贝后值保持一致
    expect(out.view!.zones!.deckCount).toBe(50);
    expect(out.view!.zones!.discardPileCount).toBe(0);
  });

  it('event 的 view 增量为 log 创建新引用(避免 GameLog memo 永远判等)', () => {
    // 回归:viewReducer 会 view.log.push() 原地突变。若浅拷贝不复制 log 数组,
    // prev/next 共享同一引用 → prev.log.length === next.log.length 永远 true
    // → GameLog 的 gameLogPropsEqual 判等 → 日志面板冻结。
    const baseline = makeBaseline(0);
    baseline.log = [{ time: 0, player: 0, text: '回合开始' }];
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const prevLog = start.view!.log;
    const evt = {
      type: 'event',
      seq: 1,
      timestamp: 100,
      view: { type: '回合开始', player: 0 },
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    // log 必须是新引用,否则 GameLog memo 比较器判等跳过重渲染
    expect(out.view!.log).not.toBe(prevLog);
    // 新条目已 push
    expect(out.view!.log.length).toBe(2);
    expect(prevLog.length).toBe(1); // prev 未被污染
  });

  it('event 的 view 增量深拷贝 players(避免座位卡 HP 冻结 + 伤害动画失效)', () => {
    // 回归:viewReducer 原地突变 player 字段(扣减体力改 health 等)。若浅拷贝不复制
    // players 数组,prev/next 的 player 元素同引用 → playerVisibleEqual 比较同一对象
    // 永远判等 → 座位卡 HP 不更新(显示受伤前数值);且 useAnimationState 的
    // [view.players] 依赖不变 → 伤害闪烁/震动动画失效。深拷贝每个 player 让 memo
    // 比较器读到独立副本,正确触发重渲染。根因同 zones/log 浅拷贝遗漏。
    const baseline = makeBaseline(0);
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const prevPlayers = start.view!.players;
    const prevP0 = start.view!.players[0];
    const evt = {
      type: 'event',
      seq: 1,
      timestamp: 100,
      view: { type: '扣减体力', target: 0, amount: 1 },
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    // players 数组必须是新引用(否则 useAnimationState [view.players] 依赖不变)
    expect(out.view!.players).not.toBe(prevPlayers);
    // player 元素必须是新对象(否则 playerVisibleEqual 比较同一对象永远判等)
    expect(out.view!.players[0]).not.toBe(prevP0);
    // health 已扣减
    expect(out.view!.players[0].health).toBe(3);
    // prev 未被污染——viewReducer 突变的是新副本,不会回写 baseline
    expect(prevP0.health).toBe(4);
  });

  it('重复 event(seq<=prevSeq)被丢弃,applyView 不重复应用', () => {
    // 回归:重连/EventSource 自动重连/HMR 时服务端可能重放已处理的 event。
    // viewReducer 的 applyView 原地突变(marks/hand push),重复应用导致数组累积重复
    // (典型表现:热重载后前端手牌显示重复)。event case 必须按 seq 去重。
    const baseline = makeBaseline(0);
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const mark = { type: 'chain', source: -1 } as never;
    const evt = {
      type: 'event',
      seq: 1,
      timestamp: 0,
      view: { type: '加标记', player: 0, mark },
    } as ServerMessage;
    const out1 = applyServerMessage(start.view!, start.lastSeq, evt);
    expect(out1.view!.players[0].marks.length).toBe(1);
    expect(out1.lastSeq).toBe(1);
    // 同 seq 的 event 重放:必须丢弃
    const out2 = applyServerMessage(out1.view!, out1.lastSeq, evt);
    expect(out2.view).toBe(out1.view); // 未应用,引用不变
    expect(out2.lastSeq).toBe(1); // seq 不回退
    expect(out2.view!.players[0].marks.length).toBe(1); // 不重复
    // 更高 seq 的新 event 正常应用
    const evt2 = { ...evt, seq: 2 } as ServerMessage;
    const out3 = applyServerMessage(out1.view!, out1.lastSeq, evt2);
    expect(out3.view!.players[0].marks.length).toBe(2);
  });
});
