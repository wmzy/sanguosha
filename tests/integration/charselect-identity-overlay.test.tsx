// 前端渲染测试:选将阶段身份揭示弹窗不覆盖选将界面。
// 场景:开局抽身份后,身份揭示弹窗(IdentityRevealOverlay, zIndex=10000)与
// 选将遮罩(CharSelectOverlay, zIndex=9999)同时渲染,前者会完全盖住后者,
// 导致玩家看不到候选人列表和选将倒计时。
//
// 修复:选将阶段(isCharSelectPending 或 charSelectInProgress)强制隐藏身份揭示弹窗——
// 选将遮罩已含"你的身份"信息,不需要额外弹窗。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView } from '../../engine/types';

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
    players: [
      makePlayer(0, '', '主公'),
      makePlayer(1, ''),
      makePlayer(2, ''),
      makePlayer(3, ''),
    ],
    cardMap: {},
    pending: {
      type: 'awaits',
      atom: {
        type: '选将询问', target: 0,
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
    allCharSelectSlots: undefined,
    turnDeadline: null,
    log: [],
  };
}

describe('GameView:选将阶段身份揭示弹窗不覆盖选将界面', () => {
  beforeEach(() => {
    clearRegistry();
    // 强制身份揭示弹窗显示(模拟首次进入)
    sessionStorage.clear();
  });

  it('主公选将阶段:身份揭示弹窗不显示,选将遮罩可见(含身份信息)', () => {
    const view = makeLordSelectingView();
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    // 选将遮罩可见:标题"主公选将" + 候选人"刘备"
    expect(screen.getByText('主公选将')).toBeDefined();
    expect(screen.getByText('刘备')).toBeDefined();

    // 身份揭示弹窗的"确认"按钮(身份弹窗独有)不应存在
    // 选将遮罩的按钮是"确认选择",与身份弹窗的"确认"不同
    const confirmButtons = screen.getAllByRole('button').filter(b =>
      b.textContent === '确认' || b.textContent === '确认选择'
    );
    const identityConfirm = confirmButtons.find(b => b.textContent === '确认');
    expect(identityConfirm).toBeUndefined();

    // 选将遮罩的"确认选择"按钮存在
    const charSelectConfirm = confirmButtons.find(b => b.textContent === '确认选择');
    expect(charSelectConfirm).toBeDefined();

    // 身份信息通过选将遮罩显示(viewer 身份 = 主公)
    // 选将遮罩里有"你的身份"标签 + 身份值
    expect(screen.getByText('你的身份')).toBeDefined();
    expect(screen.getAllByText('主公').length).toBeGreaterThan(0);
  });

  it('选将阶段倒计时可见(不被身份弹窗遮挡)', () => {
    const view = makeLordSelectingView();
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    // CountdownBar 渲染剩余秒数(60s timeout,deadline 是 now+60s)
    // 选将遮罩里的倒计时文字应该可见
    const countdownText = document.body.textContent ?? '';
    // 倒计时显示为 "⏱ Ns" 或类似格式
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
      allCharSelectSlots: undefined,
      turnDeadline: null,
      log: [],
    };
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    // 此时不在选将阶段,身份揭示弹窗应该显示
    const confirmButtons = screen.getAllByRole('button').filter(b =>
      b.textContent === '确认' || b.textContent === '确认选择'
    );
    const identityConfirm = confirmButtons.find(b => b.textContent === '确认');
    expect(identityConfirm).toBeDefined();
  });
});
