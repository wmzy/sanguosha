// @vitest-environment jsdom
// 前端渲染测试:仁德/制衡等 distribute 主动技能在出牌阶段渲染为可点击按钮,
// 点击后进入 distribute 模式:候选牌在手牌区选,提示在 handHeader,提交按钮在 actionBar。
// (DistributeUI 分配面板已移除,目标选择统一到座位区点击)
//
// 回归根因:GameView 的 triggerableActions 过滤条件此前只包含
//   confirm/choosePlayer/(useCardAndTarget+transform),
// 导致 useCard/useCardAndTarget(无 transform)的技能(仁德/制衡)无法显示按钮。
// 修复:把 distribute prompt 加入 triggerableActions,并改仁德/制衡 prompt 为 distribute。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView, Card } from '../../src/engine/types';

function makeCard(id: string, name: string): Card {
  return { id, name, suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
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
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
    ...overrides,
  };
}

describe('GameView:仁德/制衡 distribute 主动技按钮', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('仁德在出牌阶段渲染为可点击按钮(非纯文本标签)', async () => {
    const view = makeView();
    render(<GameViewComponent view={view} onAction={() => {}} />);

    // registerSkillActions 是 async(dynamic import),需等待按钮出现
    // 按钮文本是技能名 '仁德'(skillRow 里 visibleSkills 渲染)
    const rendeBtn = await screen.findByRole('button', { name: '仁德' });
    expect(rendeBtn).toBeDefined();
  });

  it('点击仁德按钮后进入 distribute 模式(handHeader 提示)', async () => {
    const view = makeView();
    render(<GameViewComponent view={view} onAction={() => {}} />);

    const rendeBtn = await screen.findByRole('button', { name: '仁德' });
    fireEvent.click(rendeBtn);

    // 弹窗标题应包含 '仁德'(prompt.title),且 DistributeUI allocate 模式会显示手牌按钮 + 玩家分配按钮
    await waitFor(() => {
      // 标题区 + DistributeUI 内部都有该文本,用 getAllByText
      expect(screen.getAllByText(/仁德：选择要送出的手牌和目标角色/).length).toBeGreaterThan(0);
    });
    // externalTargetSelection 模式:显示提示文字"已选 0 张"
    expect(screen.getByText(/已选/)).toBeDefined();
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
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '桃'),
        c3: makeCard('c3', '闪'),
        c4: makeCard('c4', '杀'),
      },
    });
    render(<GameViewComponent view={view} onAction={() => {}} />);

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
    const { container } = render(<GameViewComponent view={view} onAction={onAction} />);

    const rendeBtn = await screen.findByRole('button', { name: '仁德' });
    fireEvent.click(rendeBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/仁德：选择要送出的手牌和目标角色/).length).toBeGreaterThan(0);
    });

    // 选一张手牌(杀)给 P2
    // 手牌渲染为 <div data-card-id="c1">,不是 button
    const killCardEl = container.querySelector('[data-card-id="c1"]');
    expect(killCardEl).toBeDefined();
    fireEvent.click(killCardEl!);
    // externalTargetSelection 模式:目标由座位区点选(点 P2 座位元素)
    // P2 座位名渲染在 <span> 内,点击冒泡到 PlayerSeatView 的 onClick
    const p2SeatName = screen.getByText('P2');
    expect(p2SeatName).toBeDefined();
    fireEvent.click(p2SeatName);

    // externalTargetSelection 模式:确定按钮(非"提交分配")
    const submitBtn = screen.getByRole('button', { name: /确定/ });
    fireEvent.click(submitBtn);

    // allocation 格式: [{target: 1, cardIds: ['c1']}]
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: '仁德',
          actionType: 'use',
          params: expect.objectContaining({
            allocation: expect.arrayContaining([
              expect.objectContaining({ target: 1, cardIds: expect.arrayContaining(['c1']) }),
            ]),
          }),
        }),
      );
    });
  });
});

// ─── distribute 外部候选区(牌堆顶/目标牌等不在手牌区的候选)───
// 覆盖技能:观星/界观星/界恂恂/界称象(牌堆顶牌)、界破军/界镇军(目标的牌)。
// 这些技能的 prompt.cardIds 包含不在操作者手牌/装备区的 id,前端需单独渲染为
// 独立候选排,否则人类玩家无法在 UI 上选牌(AI 玩家通过 respond 直接提交不受影响)。
describe('GameView:distribute 外部候选区(观星类场景)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('distribute pending 候选牌不在手牌区时,渲染独立候选排 + 牌内容', async () => {
    // 模拟观星:pending cardIds 是牌堆顶 3 张牌(d1/d2/d3),不在 P1 手牌(c1/c2)里
    const view = makeView({
      pending: {
        type: 'awaits',
        atom: { type: '请求回应', requestType: '观星/arrange', target: 0 } as any,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: '观星：排列牌堆顶牌',
          cardIds: ['d1', 'd2', 'd3'],
          minTotal: 0,
          maxTotal: 3,
        },
        target: 0,
        isBlocking: true,
      },
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '桃'),
        d1: { id: 'd1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' },
        d2: { id: 'd2', name: '闪', suit: '♥', color: '红', rank: 'J', type: '基本牌' },
        d3: { id: 'd3', name: '桃', suit: '♦', color: '红', rank: '3', type: '基本牌' },
      },
    });

    const { container } = render(<GameViewComponent view={view} onAction={() => {}} />);

    // 等待外部候选区出现(标题包含 '观星')
    await waitFor(() => {
      expect(screen.getAllByText(/观星：排列牌堆顶牌/).length).toBeGreaterThan(0);
    });

    // 3 张外部候选牌都应被渲染为独立卡片(data-card-id 来自原 HandCard 语义)
    // 这里用牌内容文本 '闪'(只在外部候选区出现,手牌里是杀/桃)验证
    expect(screen.getByText('闪')).toBeDefined();
    expect(screen.getAllByText('杀').length).toBeGreaterThanOrEqual(2); // 手牌 c1 + 外部 d1

    // P1 自己的手牌(c1/c2)不应出现在外部候选区
    // (间接验证:外部候选区的牌张数 = 3,手牌区 = 2)
  });

  it('点击外部候选牌 → 进入选中态(类名变化),再点 → 回退', async () => {
    const view = makeView({
      pending: {
        type: 'awaits',
        atom: { type: '请求回应', requestType: '观星/arrange', target: 0 } as any,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: '观星',
          cardIds: ['d1', 'd2'],
          minTotal: 0,
          maxTotal: 2,
        },
        target: 0,
        isBlocking: true,
      },
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '桃'),
        d1: { id: 'd1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' },
        d2: { id: 'd2', name: '闪', suit: '♥', color: '红', rank: 'J', type: '基本牌' },
      },
    });

    const { container } = render(<GameViewComponent view={view} onAction={() => {}} />);

    // 等待候选区出现
    await waitFor(() => {
      expect(screen.getAllByText(/观星/).length).toBeGreaterThan(0);
    });

    // 找到外部候选区中 d2 的卡片元素(通过 data-card-id)
    const externalD2 = container.querySelector('[data-card-id="d2"]');
    expect(externalD2).not.toBeNull();

    // 用更精确的 label 文本(prompt.title · 已选 N),避免「已选」匹配 ActionBar 里其他文本
    const labelOf = (n: number) => screen.getByText(`观星 · 已选 ${n}`);
    // 初始:已选 0
    expect(labelOf(0)).toBeDefined();
    // 点击 d2 选中 → 已选 1
    fireEvent.click(externalD2!);
    expect(labelOf(1)).toBeDefined();
    // 再点回退 → 已选 0
    fireEvent.click(externalD2!);
    expect(labelOf(0)).toBeDefined();
  });
});
