// 前端渲染测试:判定翻牌动画(blockUntilDone, effect.animation='flip')期间,
// 询问类 pending(如八卦阵判定后弹出的「是否出闪」)应延迟渲染,
// 让玩家先看清判定结果,再弹出询问。
//
// 来源:修复「八卦阵确认发动后没等判定结果就直接询问闪」。
// 根因:useEventPlayback 是非阻塞调度,而询问闪的 applyView 同步写 view.pending,
// 导致黑色判定时判定牌还在翻(EventBanner flip 1800ms)询问闪面板就已经弹出。
// 修复:GameView 计算 isPlayingFlipAnim(flip 动画播放中),期间延迟 AwaitingPrompt。
//
// 归并建议:若未来有统一的 GameView 渲染时序测试文件,可并入。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
      { index: 0, name: 'P1', character: '测试', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [], handCount: 0, hand: [], marks: [], pendingTricks: [] },
      { index: 1, name: 'P2', character: '测试', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [], handCount: 1, marks: [], pendingTricks: [] },
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
  prompt: { type: 'useCard', title: '是否出闪', cardFilter: { filter: () => true, min: 1, max: 1 } },
  target: 0,
  isBlocking: true,
  deadline: Date.now() + 15000,
  totalMs: 15000,
} as unknown as PendingView;

// 判定翻牌事件(effect.animation='flip', EventBanner 会渲染翻牌)
const judgeFlipEvent = {
  seq: 10,
  event: { type: '判定', player: 0, judgeType: '八卦阵', cardId: 'j1', card: { name: '桃', suit: '♥', rank: '5' } },
};

describe('GameView:判定翻牌动画期间延迟询问类 pending', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('判定 flip 动画播放中 → 询问闪面板不渲染(让玩家先看清判定结果)', () => {
    const view = makeView(dodgePending);
    render(<GameViewComponent view={view} onAction={() => {}} currentEvent={judgeFlipEvent as any} />);
    // AwaitingPrompt 头部「⚡ 需要回应」不应出现
    expect(screen.queryByText(/需要回应/)).toBeNull();
  });

  it('判定 flip 动画播完后(currentEvent=null) → 询问闪面板正常渲染', () => {
    const view = makeView(dodgePending);
    render(<GameViewComponent view={view} onAction={() => {}} currentEvent={null} />);
    expect(screen.getByText(/需要回应/)).toBeDefined();
  });
});
