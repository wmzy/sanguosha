// @vitest-environment jsdom
// 前端渲染测试:回放只读模式(readOnly)下,选将/身份揭示遮罩不渲染,
// 避免回放初始画面(initialView 的 pending 是选将询问)被遮罩遮挡。
// Bug 6: 游戏重播时卡在选将界面。
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

/** 主公正在选将:view.pending 指向 viewer(主公)的选将 slot。
 *  模拟回放 initialView 的典型状态(开局选将阶段)。 */
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

describe('GameView:回放只读模式(readOnly)禁用阻塞性遮罩', () => {
  beforeEach(() => {
    clearRegistry();
    sessionStorage.clear();
  });

  it('readOnly=false(默认):选将遮罩正常渲染', () => {
    const view = makeLordSelectingView();
    sessionStorage.setItem('sgs_identity_shown', '1');
    render(<GameViewComponent view={view} onAction={() => {}} />);

    // 选将遮罩可见:标题 + 候选人
    expect(screen.getByText('主公选将')).toBeDefined();
    expect(screen.getByText('刘备')).toBeDefined();
  });

  it('readOnly=true:选将遮罩不渲染(回放不卡在选将)', () => {
    const view = makeLordSelectingView();
    sessionStorage.setItem('sgs_identity_shown', '1');
    render(<GameViewComponent view={view} onAction={() => {}} readOnly />);

    // 选将遮罩标题不应出现
    const titles = screen.queryAllByText('主公选将');
    expect(titles).toHaveLength(0);
    // 候选人名也不应在遮罩中渲染
    expect(screen.queryAllByText('刘备')).toHaveLength(0);
    // 选将确认按钮不存在
    const charSelectConfirm = screen
      .queryAllByRole('button')
      .find((b) => b.textContent === '确认选择');
    expect(charSelectConfirm).toBeUndefined();
  });

  it('readOnly=true:身份揭示遮罩也不渲染', () => {
    // 未确认身份(sessionStorage clear) + 选将阶段 → 正常会显示身份弹窗
    const view = makeLordSelectingView();
    render(<GameViewComponent view={view} onAction={() => {}} readOnly />);

    // 身份弹窗的"确认"按钮不应存在
    const identityConfirm = screen.queryAllByRole('button').find((b) => b.textContent === '确认');
    expect(identityConfirm).toBeUndefined();
  });

  it('readOnly 默认为 false:未传该 prop 时保持原有行为(正式模式不受影响)', () => {
    const view = makeLordSelectingView();
    sessionStorage.setItem('sgs_identity_shown', '1');
    // 不传 readOnly
    render(<GameViewComponent view={view} onAction={() => {}} />);

    // 选将遮罩照常渲染
    expect(screen.getByText('主公选将')).toBeDefined();
  });
});
