// @vitest-environment jsdom
// 前端渲染测试:奋威多选 choosePlayer 面板。
// 验证 AwaitingPrompt 对 choosePlayer(max>1)的渲染:
//   候选目标(引擎注入的 candidates)渲染为可点按钮,多选累积后确认提交 { targets: [...] }。
//
// 根因:ChoosePlayerPrompt.filter 是函数,跨进程序列化(SSE/JSON)丢失,
// 前端拿不到 filter 无法计算合法目标。修复:引擎投影层注入可序列化 candidates,
// 前端直接用 candidates 渲染。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView, Card } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makeFenweiView(): GameView {
  const south = makeCard('south', '南蛮入侵', '♠', 'A');
  return {
    viewer: 0,
    currentPlayerIndex: 1,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: 'P1',
        character: '界甘宁',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['奇袭', '奋威'],
        handCount: 0,
        hand: [],
        marks: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['南蛮入侵'],
        handCount: 1,
        marks: [],
      },
      {
        index: 2,
        name: 'P3',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
    ],
    cardMap: { south },
    // 奋威多选面板:candidates 由引擎投影层注入,filter 跨进程丢失(模拟真实对局)
    pending: {
      type: 'awaits',
      atom: {
        type: '请求回应',
        requestType: '奋威/choose',
        target: 0,
      } as never,
      prompt: {
        type: 'choosePlayer',
        title: '奋威:选择要令其无效的目标(可多选)',
        min: 1,
        max: 2,
        candidates: [0, 2],
      } as never,
      target: 0,
      isBlocking: true,
      deadline: Date.now() + 30000,
      totalMs: 30000,
    },
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    zones: { deckCount: 18, processing: ['south'], discardPileCount: 0 },
    settlementStack: [],
  } as unknown as GameView;
}

describe('奋威多选 choosePlayer 面板(choosePlayer + candidates)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('渲染 candidates 中每个目标为可点按钮(P1, P3)', async () => {
    const view = makeFenweiView();
    render(<GameViewComponent view={view} onAction={() => {}} />);

    await waitFor(() => {
      // 两个候选目标 P1(座次0) 和 P3(座次2) 各一个按钮
      expect(screen.getByRole('button', { name: 'P1' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'P3' })).toBeDefined();
    });
    // 非候选的 P2 不渲染为候选按钮(可能作为座次卡出现,但不是 choosePlayer 按钮)
  });

  it('多选累积后点确认以 { targets: [...] } 格式提交 respond', async () => {
    const view = makeFenweiView();
    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'P1' })).toBeDefined();
    });

    // 选 P1 再选 P3
    fireEvent.click(screen.getByRole('button', { name: 'P1' }));
    fireEvent.click(screen.getByRole('button', { name: 'P3' }));

    // 确认按钮应可点(已选 2 个,满足 min=1 max=2)
    const confirmBtn = screen.getByRole('button', { name: /确认\(2\/2\)/ });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: '奋威',
          actionType: 'respond',
          params: expect.objectContaining({ targets: [0, 2] }),
        }),
      );
    });
  });

  it('未选足 min 时确认按钮禁用', async () => {
    const view = makeFenweiView();
    render(<GameViewComponent view={view} onAction={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'P1' })).toBeDefined();
    });

    // 确认按钮(0/2)应禁用
    const confirmBtn = screen.getByRole('button', { name: /确认\(0\/2\)/ });
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);
  });
});
