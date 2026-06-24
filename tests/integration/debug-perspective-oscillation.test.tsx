// 回归测试:debug 模式自动切换视角在「问询场景」(杀/决斗/南蛮)下不再死循环。
//
// 背景:buildView 对非 target viewer 会投影一个「观察型 pending」(target 指向被问询者)。
// 旧版 auto-switch 把这个 target 当成「该切过去的座次」,导致:
//   current 玩家(观察者,target=被问询者)→ 切到被问询者
//   被问询者视角(currentPlayer !== 自己)→ 切回 current 玩家
//   → 0↔2 死循环,React "Maximum update depth exceeded"。
//
// 修复:只有「自己专属 pending」(target === 当前 viewer)才保持视角;否则跟随 currentPlayer。
//
// 本文件来源:auto-switch 死循环 bug 修复。若后续合并 debug 视角测试,可并入
// tests/integration/debug-*.test.tsx 系列。

import { describe, it, expect } from 'vitest';
import { useState, type ReactNode } from 'react';
import { render, act } from '@testing-library/react';
import { useDebugPerspective } from '../../src/client/hooks/useDebugPerspective';
import { SubmittedCharSelectProvider } from '../../src/client/hooks/SubmittedCharSelectCtx';
import type { GameView, Atom } from '../../src/engine/types';

// 模块级 perspective 变化追踪(测试用)
let perspectiveTrace: number[] = [];

function makePlayer(index: number, character: string): GameView['players'][number] {
  return {
    index,
    name: character || `player-${index}`,
    character,
    health: 4,
    maxHealth: 4,
    alive: true,
    equipment: {},
    skills: character ? ['回合管理'] : [],
    handCount: 4,
    marks: [],
  };
}

/** 构建多 viewer 视图:游戏进行中,currentPlayer 出杀问询 target。
 *  viewer-filtering + observer-pending fallback:
 *    - target viewer: 自己专属 pending(target === viewer)
 *    - 其他 viewer(含 currentPlayer): 观察型 pending(target 指向被问询者) */
function makeAskViews(
  playerCount: number,
  currentPlayer: number,
  askTarget: number,
): Map<number, GameView> {
  const players = Array.from({ length: playerCount }, (_, i) => makePlayer(i, `P${i}`));
  const views = new Map<number, GameView>();
  for (let v = 0; v < playerCount; v++) {
    // 该 viewer 看到的 pending.target:
    //  - 被问询者自己 → askTarget(专属)
    //  - 其他人(观察者) → askTarget(观察型投影)
    const pendingTarget = askTarget;
    views.set(v, {
      viewer: v,
      currentPlayerIndex: currentPlayer,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      players: players.map((p, i) => ({ ...p, hand: i === v ? [] : undefined })),
      cardMap: {},
      pending: { type: 'awaits', atom: { type: '询问闪' } as unknown as Atom, prompt: { type: 'useCard', title: '请出闪', cardFilter: { min: 1, max: 1 } }, target: pendingTarget },
      deadline: null,
      deadlineTotalMs: 0,
      log: [],
    });
  }
  return views;
}

/** 测试 wrapper:捕获 perspective 的变化序列(用于检测死循环)。
 *  initialPerspective:起始视角。 */
function PerspectiveTracker({
  views, playerCount, initialPerspective = 0,
}: {
  views: Map<number, GameView>;
  playerCount: number;
  initialPerspective?: number;
}) {
  const [perspective, setPerspective] = useState(initialPerspective);
  // 记录每次 perspective 变化
  if (perspectiveTrace[perspectiveTrace.length - 1] !== perspective) perspectiveTrace.push(perspective);

  useDebugPerspective(views, perspective, playerCount, setPerspective);
  return null;
}

function renderWithProvider(ui: ReactNode) {
  return render(<SubmittedCharSelectProvider>{ui}</SubmittedCharSelectProvider>);
}

describe('useDebugPerspective:问询场景不死循环', () => {
  it('杀问询期间:从观察者(非 current/非 target)开始 → 稳定跟到 currentPlayer', async () => {
    // player 2(current)出杀问询 player 0;无 __出牌 pending(出牌循环挂起)
    const views = makeAskViews(5, 2, 0);
    perspectiveTrace = [];

    // 从观察者 player 1 开始(既不是 current 也不是 target)
    renderWithProvider(<PerspectiveTracker views={views} playerCount={5} initialPerspective={1} />);
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    const trace = perspectiveTrace;
    // 不应震荡(旧版会 0↔2 死循环)
    expect(trace.length).toBeLessThan(10);
    // 观察者无自己专属 pending → 跟随 currentPlayer(2)
    expect(trace[trace.length - 1]).toBe(2);
  });

  it('杀问询期间:从被问询者开始 → 保持(看自己被问询),不跳走', async () => {
    const views = makeAskViews(5, 2, 0);
    perspectiveTrace = [];

    // 从被问询者 player 0 开始(自己专属 pending)
    renderWithProvider(<PerspectiveTracker views={views} playerCount={5} initialPerspective={0} />);
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    const trace = perspectiveTrace;
    expect(trace.length).toBeLessThan(10);
    // 被问询者有自己专属 pending → 保持
    expect(trace[trace.length - 1]).toBe(0);
  });

  it('决斗轮流问询:从 current 玩家(观察者)开始 → 保持看自己', async () => {
    // player 2 出决斗给 player 0,round 0: 问询 player 0。player 2 是观察者(无专属 pending)
    const views = makeAskViews(5, 2, 0);
    perspectiveTrace = [];

    renderWithProvider(<PerspectiveTracker views={views} playerCount={5} initialPerspective={2} />);
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    const trace = perspectiveTrace;
    expect(trace.length).toBeLessThan(10);
    // current 玩家无专属 pending(target=0 !== p=2),但 currentPlayer === p → 保持
    expect(trace[trace.length - 1]).toBe(2);
  });

  it('南蛮入侵多目标问询:观察者跟随 current,不震荡', async () => {
    // player 2 出南蛮,问询 player 1(观察者 projection target=1)
    const views = makeAskViews(5, 2, 1);
    perspectiveTrace = [];

    // 从观察者 player 3 开始(既不是 current 也不是 target)
    renderWithProvider(<PerspectiveTracker views={views} playerCount={5} initialPerspective={3} />);
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    const trace = perspectiveTrace;
    expect(trace.length).toBeLessThan(10);
    expect(trace[trace.length - 1]).toBe(2);
  });
});
