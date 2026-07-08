// @vitest-environment jsdom
// 前端渲染测试:开局身份揭示弹窗在选将之前/期间显示(zIndex 10000 > 选将遮罩 9999),
// 玩家点「确认」后才露出下方的选将界面。
// 场景:bootstrap 先抽身份再选将,身份分配后立即弹出身份牌,确认后进入选将。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView } from '../../src/engine/types';

function makePlayer(index: number, character: string, identity?: string) {
  return {
    index,
    name: `player-${index}`,
    character,
    health: 4,
    maxHealth: 4,
    alive: true,
    equipment: {},
    skills: character ? ['仁德'] : [],
    handCount: 0,
    marks: [],
    ...(identity !== undefined ? { identity } : {}),
  };
}

/** 主公正在选将:view.pending 指向 viewer(主公)的选将 slot */
function makeLordSelectingView(): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '准备',
    turn: { round: 1, phase: '准备', vars: {} },
    players: [makePlayer(0, '', '主公'), makePlayer(1, ''), makePlayer(2, ''), makePlayer(3, '')],
    cardMap: {},
    pending: {
      type: 'awaits',
      atom: {
        type: '选将询问',
        target: 0,
        candidates: [
          { name: '刘备', skills: ['仁德'] },
          { name: '曹操', skills: ['护甲'] },
        ],
      },
      prompt: { type: 'chooseCharacter', title: '请选择武将', candidates: [] },
      target: 0,
      deadline: Date.now() + 60000,
      totalMs: 60000,
    },
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

describe('GameView:身份揭示弹窗在选将之前/期间显示', () => {
  beforeEach(() => {
    clearRegistry();
    // 默认模拟首次进入(未确认身份)
    sessionStorage.clear();
  });

  it('主公选将阶段未确认身份:身份弹窗显示(盖在选将遮罩之上)', () => {
    const view = makeLordSelectingView();
    render(<GameViewComponent view={view} onAction={() => {}} />);

    // 身份揭示弹窗的"确认"按钮(身份弹窗独有)应存在——选将遮罩被它盖住
    const identityConfirm = screen.getAllByRole('button').find((b) => b.textContent === '确认');
    expect(identityConfirm).toBeDefined();

    // 身份弹窗内的身份文字可见(身份弹窗 + 选将遮罩都可能含"你的身份")
    expect(screen.getAllByText('你的身份').length).toBeGreaterThan(0);
    expect(screen.getAllByText('主公').length).toBeGreaterThan(0);

    // 选将遮罩仍在 DOM 中(被身份弹窗遮盖,但渲染了),确认选择按钮存在
    const charSelectConfirm = screen
      .getAllByRole('button')
      .find((b) => b.textContent === '确认选择');
    expect(charSelectConfirm).toBeDefined();
  });

  it('主公选将阶段已确认身份:身份弹窗消失,选将遮罩可见', () => {
    // 已确认身份(sessionStorage 标记) → 身份弹窗不显示
    sessionStorage.setItem('sgs_identity_shown', '1');
    const view = makeLordSelectingView();
    render(<GameViewComponent view={view} onAction={() => {}} />);

    // 身份弹窗的"确认"按钮不应存在
    const identityConfirm = screen.getAllByRole('button').find((b) => b.textContent === '确认');
    expect(identityConfirm).toBeUndefined();

    // 选将遮罩可见:标题"主公选将" + 候选人 + 选将倒计时
    expect(screen.getByText('主公选将')).toBeDefined();
    expect(screen.getByText('刘备')).toBeDefined();
    const countdownText = document.body.textContent ?? '';
    expect(countdownText).toMatch(/⏱\s*\d+s/);
  });

  it('选将完成后进入游戏阶段:身份揭示弹窗可显示(若未确认过)', () => {
    // 选将已完成,进入出牌阶段,identity 未确认过(sessionStorage clear)
    const view: GameView = {
      viewer: 0,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      players: [
        makePlayer(0, '刘备', '主公'),
        makePlayer(1, '曹操'),
        makePlayer(2, '孙权'),
        makePlayer(3, '关羽'),
      ],
      cardMap: {},
      pending: null,
      deadline: null,
      deadlineTotalMs: 0,
      log: [],
      settlementStack: [],
    };
    render(<GameViewComponent view={view} onAction={() => {}} />);

    // 此时不在选将阶段,身份揭示弹窗应该显示
    const identityConfirm = screen.getAllByRole('button').find((b) => b.textContent === '确认');
    expect(identityConfirm).toBeDefined();
  });
});
