// @vitest-environment jsdom
// tests/client/useAutoSkip.test.tsx
// useAutoSkip hook 防串扰测试:延迟 skip 期间 view 推进到新窗口时,旧 skip 不得误发。
// 复现南蛮/决斗场景:无懈广播延迟跳过,延迟期内 view 推进到杀问询(有杀)。
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoSkip } from '../../src/client/hooks/useAutoSkip';
import type { Card, GameView, PendingView } from '../../src/engine/types';
import type { PendingRespondInfo } from '../../src/client/utils/pendingRespond';
import type { SkillActionDef } from '../../src/client/skillActionRegistry';

function makePlayer(idx: number, hand: Card[]) {
  return {
    index: idx, name: `P${idx}`, character: '', health: 4, maxHealth: 4, alive: true,
    equipment: {}, skills: [], handCount: hand.length, hand, marks: [],
  };
}

function makeView(pending: PendingView, hand: Card[], viewer = 0): GameView {
  return {
    viewer, currentPlayerIndex: 0, phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      makePlayer(0, viewer === 0 ? hand : []),
      makePlayer(1, viewer === 1 ? hand : []),
    ],
    cardMap: {}, pending, deadline: null, deadlineTotalMs: 0, log: [], settlementStack: [],
  } as unknown as GameView;
}

const wuxiePending = (deadline: number): PendingView => ({
  type: 'awaits',
  atom: { type: '请求回应', requestType: '无懈可击', target: -2 } as PendingView['atom'],
  prompt: { type: 'useCard', title: '是否打出无懈可击?' } as PendingView['prompt'],
  target: -2, isBlocking: true, deadline, totalMs: 10000,
});

const killPending = (deadline: number): PendingView => ({
  type: 'awaits',
  atom: { type: '询问杀', target: 0, source: 1 },
  prompt: {
    type: 'useCard', title: '是否出杀',
    cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
  },
  target: 0, isBlocking: true, deadline, totalMs: 15000,
});

const wuxieRespond: PendingRespondInfo = { skillId: '无懈可击', cardFilter: (c: Card) => c.name === '无懈可击' };
const killRespond: PendingRespondInfo = { skillId: '杀', cardFilter: (c: Card) => c.name === '杀' };

const flash: Card = { id: 'f1', name: '闪', suit: '♥', color: '红', rank: '5', type: '基本牌' };
const kill: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
const NO_ACTIONS: SkillActionDef[] = [];
const NO_PREFS = { optInSkip: {} };

describe('useAutoSkip — 延迟 skip 防串扰', () => {
  it('延迟跳过期间 view 推进到能响应的新窗口 → 旧 skip 不误发', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const markBroadcastSkipped = vi.fn();
    // 窗口1:广播无懈,P0 有闪(无无懈)→ 维度1 act-delayed(设 setTimeout)
    const v1 = makeView(wuxiePending(1000), [flash]);
    const { rerender } = renderHook(
      (props) => useAutoSkip(props),
      {
        initialProps: {
          view: v1, perspectiveIdx: 0, skillActions: NO_ACTIONS,
          pendingRespondInfo: wuxieRespond, prefs: NO_PREFS,
          canOperate: true, isPerspectiveAwaiting: true,
          markBroadcastSkipped, broadcastKey: 'k1', send,
        },
      },
    );
    expect(send).not.toHaveBeenCalled(); // 延迟中

    // 窗口2:杀问询,P0 有杀 → 能响应 → wait(不应被跳过)
    const v2 = makeView(killPending(2000), [kill]);
    rerender({
      view: v2, perspectiveIdx: 0, skillActions: NO_ACTIONS,
      pendingRespondInfo: killRespond, prefs: NO_PREFS,
      canOperate: true, isPerspectiveAwaiting: true,
      markBroadcastSkipped, broadcastKey: 'k2', send,
    });

    // 推进定时器:窗口1 的延迟 skip 到期
    vi.advanceTimersByTime(2000);

    // 旧 skip 不应误发(杀问询 P0 有杀,应手动操作)
    expect(send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('同一窗口内延迟到期 → 正常发 skip(防串扰校验不影响正常跳过)', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const markBroadcastSkipped = vi.fn();
    // 广播无懈,P0 有闪 → act-delayed
    const v1 = makeView(wuxiePending(1000), [flash]);
    renderHook(
      (props) => useAutoSkip(props),
      {
        initialProps: {
          view: v1, perspectiveIdx: 0, skillActions: NO_ACTIONS,
          pendingRespondInfo: wuxieRespond, prefs: NO_PREFS,
          canOperate: true, isPerspectiveAwaiting: true,
          markBroadcastSkipped, broadcastKey: 'k1', send,
        },
      },
    );
    expect(send).not.toHaveBeenCalled();
    // 推进定时器:同一窗口(deadline 未变)→ 正常发 skip
    vi.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('__skip', 'skip', {});
    vi.useRealTimers();
  });
});
