// @vitest-environment jsdom
// 前端渲染测试:debug 模式并行选将的 single-view 渲染回归。
//
// 新模型(真 viewer 隔离 + 多 WS):
//   每个座次是独立 viewer,各自连接服务端,只看自己的 view.pending。
//   选将时:viewer(主公)的 view.pending 可能是 null(viewer 已选完,轮到他人选时 viewer 这边空闲)。
//   跨座代打 = 上层把 perspective 切到目标座次的 WS 连接,看到的就是该连接自己的 pending。
//   GameView.allCharSelectSlots 字段已删除 — 不再支持单 view 内同时看多座选将 pending。
//
// 本文件只覆盖 single-view 渲染回归:viewer 已选完,phase 仍为'准备',他人未选时,
// 本连接渲染 CharSelectWaitingOverlay(viewer 自己的已选武将卡 + 切换按钮)。
//
// 跨座代打(切到目标连接后看其选将界面并提交)需要 multi-WS 集成测试覆盖 —
// 旧的 debug-parallel-charselect 4 个用例全部依赖本文件 single-view wrapper 模拟跨座代打,
// 在新模型下不成立,已删除。后续在 tests/integration/multi-ws-charselect.test.tsx
// (或 e2e)里用多 WS 多 view 跑代打链路。

import { describe, it, expect, beforeEach } from 'vitest';
import { useState, useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import type { ActionMsg } from '../../src/client/types';
import { useDebugPerspective } from '../../src/client/hooks/useDebugPerspective';
import { SubmittedCharSelectProvider } from '../../src/client/hooks/SubmittedCharSelectCtx';
import { DebugPerspectiveBar } from '../../src/client/components/DebugPerspectiveBar';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView } from '../../src/engine/types';

/** 测试 wrapper:模拟 DebugLobby 的 DebugGameView(用 useDebugPerspective 驱动视角)。
 *  注:在 single-view 测试中 currentView 固定为 viewer 连接,模拟一个 WS 连接的画面。
 *      多 WS 集成测试中应当用 Map<viewer, GameView> + 切 connection 才能跨座。 */
function TestGameView({ view, onAction }: { view: GameView; onAction: (a: ActionMsg) => void }) {
  const [perspective, setPerspective] = useState(view.viewer);
  const views = new Map<number, GameView>([[view.viewer, view]]);
  const { switchPerspective, goToCurrentPlayer, autoSwitchCtl } = useDebugPerspective(
    views,
    perspective,
    view.players.length,
    setPerspective,
  );
  const perspectiveName = view.players[perspective]?.name ?? `P${perspective}`;
  const bar = (
    <DebugPerspectiveBar
      perspectiveName={perspectiveName}
      onSwitchPerspective={switchPerspective}
      onGoToCurrentPlayer={goToCurrentPlayer}
      autoSwitchCtl={autoSwitchCtl}
    />
  );
  return <GameViewComponent view={view} onAction={onAction} headerSlot={bar} overlaySlot={bar} />;
}

function makeView(): GameView {
  // debug 模式:viewer=0(主公,已选刘备)。P1/P2 未选,本连接 viewer 的 view.pending 为 null。
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '准备',
    turn: { round: 1, phase: '准备', vars: {} },
    players: [
      {
        index: 0,
        name: 'player-0',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['仁德'],
        handCount: 0,
        marks: [],
        identity: '主公',
      },
      {
        index: 1,
        name: 'player-1',
        character: '',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
      {
        index: 2,
        name: 'player-2',
        character: '',
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
    pending: null, // viewer(主公)连接:viewer 已选完,本连接无 pending
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

describe('GameView:debug 模式 viewer 已选完 — single-view 等待遮罩渲染', () => {
  beforeEach(() => {
    clearRegistry();
    // 关闭身份揭示遮罩(避免盖住选将界面)
    sessionStorage.setItem('sgs_identity_shown', '1');
  });

  it('viewer 已选完、phase=准备、他人未选时,本连接渲染 CharSelectWaitingOverlay(viewer 已选武将卡 + 切换视角按钮)', () => {
    // 新模型下:viewer 连接 view.pending=null → useDebugPerspective 自动跟随没有 pending target,
    // 退化为跟随 currentPlayerIndex(=0)→ perspective 保持 0(viewer 自己)。
    // 渲染条件:!isCharSelectPending && charSelectInProgress(phase=准备 && 仍有 player.character 为空)
    //          && perspectiveCharSelected(perspective=0 已选刘备) → 显示 CharSelectWaitingOverlay。
    const view = makeView();
    render(<TestGameView view={view} onAction={() => {}} />);

    // 1. 等待遮罩文案
    expect(screen.getByText(/已选择武将,等待其他玩家选将/)).toBeDefined();
    // 2. 中央展示当前 perspective(主公)已选武将卡
    expect(screen.getByText('你的选择')).toBeDefined();
    expect(screen.getAllByText('刘备').length).toBeGreaterThan(0);
    expect(screen.getByText('蜀')).toBeDefined();
    expect(screen.getAllByText(/仁德/).length).toBeGreaterThan(0);
    // 3. 等待遮罩列出"还在选将"的玩家名(P1/P2)
    expect(screen.getAllByText(/player-1.*player-2|player-2.*player-1/).length).toBeGreaterThan(0);
    // 4. debug 模式下视角控制由上层通过 headerSlot/overlaySlot 注入(header + 等待遮罩角落各渲染一个"视角: player-0"按钮)
    expect(screen.getAllByRole('button', { name: /视角: player-0/ }).length).toBeGreaterThan(0);
    // 5. 不展示 CharSelectOverlay(本连接 viewer.pending 为空,viewer 自己看不到选将界面)
    expect(screen.queryByRole('button', { name: /确认选择/ })).toBeNull();
    expect(screen.queryByText(/P0 选将中/)).toBeNull();
    // 6. 不暴露他人连接的选将候选人(隔离)
    expect(screen.queryByText('孙权')).toBeNull();
  });
});

// ── 选将阶段自动跟随回归(hook 级)──
// 第二轮重构统一了选将/非选将的 auto-follow,破坏了「选将阶段应停在最后一个待选者」。
// 复现:P0/P1 已选,P2 是最后一个待选者(P2 连接有 选将询问 pending)。
// 期望:无论起始视角在哪,自动跟随都收敛到 P2,且稳定不震荡。
import { act } from '@testing-library/react';
import { useDebugPerspective as _useDebugPerspective } from '../../src/client/hooks/useDebugPerspective';

function makeLastPendingViews(): Map<number, GameView> {
  const players = [
    {
      index: 0,
      name: 'player-0',
      character: '刘备',
      health: 4,
      maxHealth: 4,
      alive: true,
      equipment: {},
      skills: ['仁德'],
      handCount: 0,
      marks: [],
      identity: '主公',
    },
    {
      index: 1,
      name: 'player-1',
      character: '关羽',
      health: 4,
      maxHealth: 4,
      alive: true,
      equipment: {},
      skills: ['武圣'],
      handCount: 0,
      marks: [],
    },
    {
      index: 2,
      name: 'player-2',
      character: '',
      health: 4,
      maxHealth: 4,
      alive: true,
      equipment: {},
      skills: [],
      handCount: 0,
      marks: [],
    },
  ];
  const views = new Map<number, GameView>();
  for (let v = 0; v < 3; v++) {
    views.set(v, {
      viewer: v,
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
      players: players.map((p, i) => ({ ...p, hand: i === v ? [] : undefined })),
      cardMap: {},
      pending:
        v === 2
          ? {
              type: 'awaits',
              atom: {
                type: '选将询问',
                target: 2,
                candidates: [{ name: '张飞', skills: ['咆哮'] }],
              } as never,
              prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: [] },
              target: 2,
              deadline: Date.now() + 60000,
              totalMs: 60000,
            }
          : null,
      deadline: null,
      deadlineTotalMs: 0,
      log: [],
      settlementStack: [],
    });
  }
  return views;
}

describe('useDebugPerspective:选将阶段自动跟随最后一个待选者', () => {
  it('从已选完玩家 P0 起 → 收敛到唯一待选者 P2,不震荡', async () => {
    const views = makeLastPendingViews();
    let finalPerspective = -1;
    function Tracker() {
      const [perspective, setPerspective] = useState(0);
      finalPerspective = perspective;
      _useDebugPerspective(views, perspective, 3, setPerspective);
      return null;
    }
    render(
      <SubmittedCharSelectProvider>
        <Tracker />
      </SubmittedCharSelectProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(finalPerspective).toBe(2);
  });

  it('已经是最后一个待选者 P2 → 保持 P2,不被 currentPlayer(主公 P0)拉走', async () => {
    const views = makeLastPendingViews();
    let finalPerspective = -1;
    function Tracker() {
      const [perspective, setPerspective] = useState(2);
      finalPerspective = perspective;
      _useDebugPerspective(views, perspective, 3, setPerspective);
      return null;
    }
    render(
      <SubmittedCharSelectProvider>
        <Tracker />
      </SubmittedCharSelectProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // P2 是选将阶段唯一需操作的玩家 → 必须保持,不能切到 currentPlayer(主公 0)
    expect(finalPerspective).toBe(2);
  });

  it('最后一人 pending 还在、但已被乐观标记提交 → 仍保持该座次(竞态不丢)', async () => {
    // 并行选将偶发 bug:P2 点了确认 → markSubmitted(2) 乐观标记,但引擎 pending 尚未 resolve
    // (view.pending 仍指向 P2)。此竞态下 must not 把视角拉走,否则最后一人选不上。
    const views = makeLastPendingViews();
    let finalPerspective = -1;
    const { useMarkCharSelectSubmitted } =
      await import('../../src/client/hooks/SubmittedCharSelectCtx');
    function Tracker() {
      const [perspective, setPerspective] = useState(2);
      finalPerspective = perspective;
      const markSubmitted = useMarkCharSelectSubmitted();
      // 挂载即乐观标记 P2 已提交(模拟点确认后、引擎 confirm 前的竞态)
      useEffect(() => {
        markSubmitted(2);
      }, [markSubmitted]);
      _useDebugPerspective(views, perspective, 3, setPerspective);
      return null;
    }
    render(
      <SubmittedCharSelectProvider>
        <Tracker />
      </SubmittedCharSelectProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // hasCharSelectPending 不看乐观提交集合,只看引擎真实状态(P2 pending 在)→ 保持 P2
    expect(finalPerspective).toBe(2);
  });
});
