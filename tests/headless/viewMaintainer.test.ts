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
    players: [{
      index: viewer, name: 'P0', character: '刘备', health: 4, maxHealth: 4,
      alive: true, equipment: {}, skills: ['仁德'], handCount: 4, hand: [], marks: [],
    }],
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
      type: 'event', seq: 1, timestamp: 100,
      view: { type: '加标签', player: 0, tag: 'test' } as any,
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    expect(out.lastSeq).toBe(1);
    expect(out.newEvents.length).toBeGreaterThan(0);
  });

  it('event 的 notify pendingResolved 清除匹配本座次的 pending', () => {
    const baseline = makeBaseline(0);
    baseline.pending = {
      type: 'awaits', atom: { type: '询问闪', player: 0 } as any,
      prompt: { type: 'useCard', cardFilter: { filter: () => true } } as any,
      target: 0, isBlocking: true,
    };
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const evt = {
      type: 'event', seq: 1, timestamp: 100,
      notify: { skillId: '', eventType: 'pendingResolved', data: { target: 0 } },
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    expect(out.view!.pending).toBeNull();
  });

  it('event 的 deadline 权威覆盖 view.deadline（无 pending 时）', () => {
    const baseline = makeBaseline(0);
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const evt = {
      type: 'event', seq: 1, timestamp: 100,
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
    const out = applyServerMessage(null, 0, { type: 'room_joined', roomId: 'r1', playerId: 'pid-1', seatIndex: 0 });
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
});
