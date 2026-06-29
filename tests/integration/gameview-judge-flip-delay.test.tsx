// 前端渲染测试:GameView 中待回应区(pending)相关 UI 的渲染时序与显示控制。
//
// 涵盖:
//   1) 判定翻牌动画(blockUntilDone, effect.animation='flip')期间,询问类 pending
//      (如八卦阵判定后弹出的「是否出闪」)应延迟渲染,让玩家先看清判定结果,再弹出询问。
//   2) 广播型 pending(无懈可击)点击「不回应」后,当前用户的倒计时和「不回应」按钮应隐藏
//      (其他座次的倒计时保留,因为广播型所有玩家共享 pending)。
//
// 该文件即「统一的 GameView 渲染时序测试文件」,后续同类问题可并入。
//
// 来源:修复「八卦阵确认发动后没等判定结果就直接询问闪」。
// 根因:useEventPlayback 是非阻塞调度,而询问闪的 applyView 同步写 view.pending,
// 导致黑色判定时判定牌还在翻(EventBanner flip 1800ms)询问闪面板就已经弹出。
// 修复:GameView 计算 isPlayingFlipAnim(flip 动画播放中),期间延迟 AwaitingPrompt。
//
// 归并建议:若未来有统一的 GameView 渲染时序测试文件,可并入。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView, PendingView } from '../../src/engine/types';

function makeView(pending: PendingView | null): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 1,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: 'P1',
        character: '测试',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        hand: [],
        marks: [],
        pendingTricks: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '测试',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 1,
        marks: [],
        pendingTricks: [],
      },
    ],
    cardMap: {},
    pending,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  } as unknown as GameView;
}

// 询问闪 pending(询问闪 atom applyView 写入的结构)
const dodgePending = {
  type: 'awaits',
  atom: { type: '询问闪', target: 0, source: 1 },
  prompt: {
    type: 'useCard',
    title: '是否出闪',
    cardFilter: { filter: () => true, min: 1, max: 1 },
  },
  target: 0,
  isBlocking: true,
  deadline: Date.now() + 15000,
  totalMs: 15000,
} as unknown as PendingView;

// 判定翻牌事件(effect.animation='flip', EventBanner 会渲染翻牌)
const judgeFlipEvent = {
  seq: 10,
  event: {
    type: '判定',
    player: 0,
    judgeType: '八卦阵',
    cardId: 'j1',
    card: { name: '桃', suit: '♥', color: '红', rank: '5' },
  },
};

describe('GameView:判定翻牌动画期间延迟询问类 pending', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('判定 flip 动画播放中 → 询问闪面板不渲染(让玩家先看清判定结果)', () => {
    const view = makeView(dodgePending);
    render(
      <GameViewComponent view={view} onAction={() => {}} currentEvent={judgeFlipEvent as any} />,
    );
    // AwaitingPrompt 头部「⚡ 需要回应」不应出现
    expect(screen.queryByText(/需要回应/)).toBeNull();
  });

  it('判定 flip 动画播完后(currentEvent=null) → 询问闪面板正常渲染', () => {
    const view = makeView(dodgePending);
    render(<GameViewComponent view={view} onAction={() => {}} currentEvent={null} />);
    expect(screen.getByText(/需要回应/)).toBeDefined();
  });
});

// 广播型无懈可击 pending(target=-1,所有玩家可回应)
const wuxieBroadcastPending = {
  type: 'awaits',
  atom: { type: '请求回应', target: -1, requestType: '无懈可击' },
  prompt: {
    type: 'useCard',
    title: '打出无懈可击',
    cardFilter: { filter: () => true, min: 1, max: 1 },
  },
  target: -1,
  isBlocking: true,
  deadline: Date.now() + 15000,
  totalMs: 15000,
} as unknown as PendingView;

describe('GameView:广播型 pending(无懈可击)点击不回应后隐藏当前用户的倒计时和按钮', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('点击「不回应」后:当前用户的「不回应」按钮隐藏', () => {
    const view = makeView(wuxieBroadcastPending);
    render(<GameViewComponent view={view} onAction={() => {}} currentEvent={null} />);
    // 初始:不回应按钮存在
    expect(screen.getByRole('button', { name: '不回应' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '不回应' }));
    // 点击后:不回应按钮消失
    expect(screen.queryByRole('button', { name: '不回应' })).toBeNull();
  });

  it('点击「不回应」后:当前用户的倒计时隐藏,其他座次倒计时保留', () => {
    const view = makeView(wuxieBroadcastPending);
    render(<GameViewComponent view={view} onAction={() => {}} currentEvent={null} />);
    // 初始:当前用户 + P2 座次各一条倒计时
    expect(screen.getAllByText(/⏱/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '不回应' }));
    // 点击后:当前用户倒计时隐藏,P2 座次倒计时保留(广播型 pending 仍在)
    expect(screen.getAllByText(/⏱/)).toHaveLength(1);
  });
});
