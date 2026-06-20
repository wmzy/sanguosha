// 前端渲染测试:仁德/制衡等 distribute 主动技能在出牌阶段渲染为可点击按钮,
// 点击后弹出 DistributeUI 选牌/分配弹窗(而非 useCard/useCardAndTarget 那样只显示文本标签)。
//
// 回归根因:GameView 的 triggerableActions 过滤条件此前只包含
//   confirm/choosePlayer/(useCardAndTarget+transform),
// 导致 useCard/useCardAndTarget(无 transform)的技能(仁德/制衡)无法显示按钮。
// 修复:把 distribute prompt 加入 triggerableActions,并改仁德/制衡 prompt 为 distribute。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView, Card } from '../../engine/types';

function makeCard(id: string, name: string): Card {
  return { id, name, suit: '♠', rank: 'A', type: '基本牌' };
}

function makeView(overrides: Partial<GameView> = {}): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: 'P1',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['仁德'],
        handCount: 2,
        hand: [makeCard('c1', '杀'), makeCard('c2', '桃')],
        marks: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '孙权',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: ['制衡'],
        handCount: 2,
        marks: [],
      },
    ],
    cardMap: { c1: makeCard('c1', '杀'), c2: makeCard('c2', '桃') },
    pending: null,
    turnDeadline: null,
    log: [],
    ...overrides,
  };
}

describe('GameView:仁德/制衡 distribute 主动技按钮', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('仁德在出牌阶段渲染为可点击按钮(非纯文本标签)', async () => {
    const view = makeView();
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    // registerSkillActions 是 async(dynamic import),需等待按钮出现
    // 按钮文本是技能名 '仁德'(skillRow 里 visibleSkills 渲染)
    const rendeBtn = await screen.findByRole('button', { name: '仁德' });
    expect(rendeBtn).toBeDefined();
  });

  it('点击仁德按钮后弹出 distribute 分配弹窗(含 DistributeUI)', async () => {
    const view = makeView();
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    const rendeBtn = await screen.findByRole('button', { name: '仁德' });
    fireEvent.click(rendeBtn);

    // 弹窗标题应包含 '仁德'(prompt.title),且 DistributeUI allocate 模式会显示手牌按钮 + 玩家分配按钮
    await waitFor(() => {
      // 标题区 + DistributeUI 内部都有该文本,用 getAllByText
      expect(screen.getAllByText(/仁德：选择要送出的手牌和目标角色/).length).toBeGreaterThan(0);
    });
    // allocate 模式:显示提示文字"已分配 0/2"
    expect(screen.getByText(/已分配/)).toBeDefined();
  });

  it('切换视角到孙权(P1)且为孙权回合:制衡按钮渲染并可点击弹出 select 弹窗', async () => {
    const view = makeView({
      viewer: 1,
      currentPlayerIndex: 1,
      players: [
        makeView().players[0],
        {
          ...makeView().players[1],
          hand: [makeCard('c3', '闪'), makeCard('c4', '杀')],
          handCount: 2,
        },
      ],
      cardMap: {
        c1: makeCard('c1', '杀'), c2: makeCard('c2', '桃'),
        c3: makeCard('c3', '闪'), c4: makeCard('c4', '杀'),
      },
    });
    render(<GameViewComponent view={view} onAction={() => {}} onDeleteRoom={() => {}} perspective={view.viewer} />);

    const zhihengBtn = await screen.findByRole('button', { name: '制衡' });
    fireEvent.click(zhihengBtn);

    // select 模式:标题含 '制衡',且有 '确认' 提交按钮(DistributeUI select 分支)
    await waitFor(() => {
      expect(screen.getAllByText(/制衡：选择要弃置的牌/).length).toBeGreaterThan(0);
    });
  });

  it('点击仁德按钮选牌并手动提交分配,onAction 以 allocation 格式提交', async () => {
    const view = makeView();
    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} onDeleteRoom={() => {}} perspective={view.viewer} />);

    const rendeBtn = await screen.findByRole('button', { name: '仁德' });
    fireEvent.click(rendeBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/仁德：选择要送出的手牌和目标角色/).length).toBeGreaterThan(0);
    });

    // 选一张手牌(杀)给 P2,然后手动点"提交分配"
    const allButtons = screen.getAllByRole('button');
    const killCardBtn = allButtons.find(b => /^杀/.test(b.textContent ?? ''));
    expect(killCardBtn).toBeDefined();
    fireEvent.click(killCardBtn!);
    // 第一次点 P2:分配 1 张,按钮 name 变为 'P2 (1/99)';用模糊匹配
    const p2Btn = screen.getByRole('button', { name: /P2/ });
    fireEvent.click(p2Btn);

    // 手动提交(allocate 模式有"提交分配"按钮,minTotal=1 已满足)
    const submitBtn = screen.getByRole('button', { name: /提交分配/ });
    fireEvent.click(submitBtn);

    // allocation 格式: [{target: 1, cardIds: ['c1']}]
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
        skillId: '仁德',
        actionType: 'use',
        params: expect.objectContaining({
          allocation: expect.arrayContaining([
            expect.objectContaining({ target: 1, cardIds: expect.arrayContaining(['c1']) }),
          ]),
        }),
      }));
    });
  });
});
