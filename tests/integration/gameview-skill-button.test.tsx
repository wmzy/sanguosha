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
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { GameViewComponent } from '../../src/client/components/GameView';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { QueuedEvent } from '../../src/client/hooks/useEventPlayback';
import type { GameView, Card, PendingView } from '../../src/engine/types';

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

// ─── chooseSuit(反间:目标猜花色)───
// 回归:此前 AwaitingPrompt 无 chooseSuit 分支,玩家只能超时走默认 ♠。
describe('GameView:chooseSuit(反间)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('渲染四种花色按钮,点击发送 respond {suit}', async () => {
    const pending: PendingView = {
      type: 'awaits',
      atom: {
        type: '请求回应',
        requestType: '反间/选花色',
        target: 0,
        prompt: { type: 'chooseSuit', title: '反间:选择一种花色' },
      },
      prompt: { type: 'chooseSuit', title: '反间:选择一种花色(猜对则不受伤害，猜错受1点伤害)' },
      target: 0,
      isBlocking: true,
    };
    const onAction = vi.fn();
    render(<GameViewComponent view={makeView({ pending })} onAction={onAction} />);

    // 四个花色按钮都在
    for (const suit of ['♠', '♥', '♣', '♦']) {
      expect(await screen.findByRole('button', { name: suit })).toBeDefined();
    }
    fireEvent.click(screen.getByRole('button', { name: '♥' }));

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: '反间', actionType: 'respond', params: { suit: '♥' } }),
    );
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

    const { container: _container } = render(<GameViewComponent view={view} onAction={() => {}} />);

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

// ─── chooseOption 选项选择(化身:选技能/选化身牌)───
// 覆盖技能:化身(标版/界版)的所有多选一交互。
// 修复前:化身用 confirm hack,候选技能名拼进 title,前端只渲染确定/取消两个按钮,无法选具体技能。
// 修复后:chooseOption prompt 渲染选项按钮列表,有 characterCards 时渲染武将牌面板(势力色+武将名+技能)。
describe('GameView:chooseOption 选项选择(化身场景)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('选技能:渲染选项按钮,点击提交 { option }', async () => {
    const view = makeView({
      pending: {
        type: 'awaits',
        atom: { type: '请求回应', requestType: '化身/选技能', target: 0 } as any,
        prompt: {
          type: 'chooseOption',
          title: '化身:从「司马懿」选择一个技能',
          options: [
            { value: '反馈', label: '反馈' },
            { value: '鬼才', label: '鬼才' },
          ],
        },
        target: 0,
        isBlocking: true,
      },
    });

    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} />);

    // 等待 prompt 标题出现
    await waitFor(() => {
      expect(screen.getAllByText(/选择一个技能/).length).toBeGreaterThan(0);
    });

    // 点击 「反馈」 按钮
    const feedbackBtn = screen.getByRole('button', { name: '反馈' });
    fireEvent.click(feedbackBtn);

    // 验证 onAction 以 { option: '反馈' } 提交
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'respond',
          params: expect.objectContaining({ option: '反馈' }),
        }),
      );
    });
  });

  it('选化身牌:渲染武将牌面板(势力色+武将名+技能)', async () => {
    const view = makeView({
      pending: {
        type: 'awaits',
        atom: { type: '请求回应', requestType: '化身/选化身牌', target: 0 } as any,
        prompt: {
          type: 'chooseOption',
          title: '化身:选择一张化身牌',
          options: [
            { value: '司马懿', label: '司马懿' },
            { value: '郭嘉', label: '郭嘉' },
          ],
          characterCards: {
            司马懿: { faction: '魏', skills: ['反馈', '鬼才'] },
            郭嘉: { faction: '魏', skills: ['天妒', '遗计'] },
          },
        },
        target: 0,
        isBlocking: true,
      },
    });

    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} />);

    // 等待武将牌面板出现
    await waitFor(() => {
      expect(screen.getAllByText(/选择一张化身牌/).length).toBeGreaterThan(0);
    });

    // 武将名和技能应被渲染
    expect(screen.getByText('司马懿')).toBeDefined();
    expect(screen.getByText('反馈 · 鬼才')).toBeDefined();
    expect(screen.getByText('郭嘉')).toBeDefined();
    expect(screen.getByText('天妒 · 遗计')).toBeDefined();

    // 点击 「司马懿」 提交 { option: '司马懿' }
    const simaBtn = screen.getByRole('button', { name: /司马懿/ });
    fireEvent.click(simaBtn);

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'respond',
          params: expect.objectContaining({ option: '司马懿' }),
        }),
      );
    });
  });
});

// 回归:主公技(护驾/激将/界血裔 等)仅在主公座次展示。界袁绍非主公时不应展示界血裔。
// 修复前:PlayerCardLarge/PlayerSeatView 的 visibleSkills 不过滤主公技,非主公主公技仍展示。
// 修复后:非主公(identity!=='主公')时隐藏 LORD_SKILLS 中的主公技。
describe('GameView:主公技仅在主公座次展示', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('主公主公技(激将)展示;非主公主公技(护驾)隐藏', () => {
    const base = makeView();
    const view: GameView = {
      ...base,
      players: [
        {
          ...base.players[0],
          name: '刘备',
          character: '刘备',
          identity: '主公',
          skills: ['仁德', '激将'],
        },
        {
          ...base.players[1],
          name: '曹操',
          character: '曹操',
          identity: '反贼',
          skills: ['护驾'],
        },
      ],
    };
    render(<GameViewComponent view={view} onAction={() => {}} />);
    // 主公刘备的激将(主公技)应展示
    expect(screen.getAllByText('激将').length).toBeGreaterThan(0);
    // 非主公曹操的护驾(主公技)不应展示
    expect(screen.queryByText('护驾')).toBeNull();
  });
});

// 武圣(关羽·转化技)回应路径:被询问杀(南蛮入侵/决斗)时,可用武圣把红色手牌当杀打出。
// Bug1:武圣缺少回应路径(无 declareAlternativeResponse + activeWhen askedKill),
// 导致被询问杀时按钮不出现/无法转化杀回应。修复后:回应上下文下武圣按钮可点 →
// 选红牌 → 提交 preceding=[武圣.transform] + 杀.respond。
describe('GameView:武圣回应(打出)路径', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('被询问杀时:武圣按钮出现 → 选红牌 → 提交 杀.respond + preceding', async () => {
    const redDodge: Card = {
      id: 'c1',
      name: '闪',
      suit: '♥',
      color: '红',
      rank: 'A',
      type: '基本牌',
    };
    const view: GameView = {
      viewer: 0,
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      players: [
        {
          index: 0,
          name: '关羽',
          character: '关羽',
          health: 4,
          maxHealth: 4,
          alive: true,
          equipment: {},
          skills: ['使用牌', '打出牌', '武圣'],
          handCount: 1,
          hand: [redDodge],
          marks: [],
        },
        {
          index: 1,
          name: '曹操',
          character: '曹操',
          health: 4,
          maxHealth: 4,
          alive: true,
          equipment: {},
          skills: ['使用牌', '打出牌'],
          handCount: 0,
          marks: [],
        },
      ],
      cardMap: { c1: redDodge },
      pending: {
        type: 'awaits',
        atom: { type: '询问杀', target: 0, source: 1 } as GameView['pending'] extends infer P
          ? P extends { atom: infer A }
            ? A
            : never
          : never,
        prompt: {
          type: 'useCard',
          title: '请打出杀',
          cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
        },
        target: 0,
        isBlocking: true,
        totalMs: 50000,
      },
      deadline: null,
      deadlineTotalMs: 0,
      log: [],
      settlementStack: [],
    };
    const onAction = vi.fn();
    const { container } = render(<GameViewComponent view={view} onAction={onAction} />);

    // 1. 武圣按钮出现(回应上下文下激活)
    const wsBtn = await screen.findByRole('button', { name: '武圣' });
    await act(async () => {
      fireEvent.click(wsBtn);
    });

    // 2. 选红牌 c1(转化模式,优先于回应拦截)
    await waitFor(() => expect(container.querySelector('[data-card-id="c1"]')).toBeTruthy());
    const cardEl = container.querySelector('[data-card-id="c1"]')!;
    await act(async () => {
      fireEvent.click(cardEl);
    });

    // 3. 使用杀按钮(回应路径无需选目标)
    const useBtn = await screen.findByRole('button', { name: /使用杀/ });
    await act(async () => {
      fireEvent.click(useBtn);
    });

    // 4. 提交 杀.respond + preceding
    expect(onAction).toHaveBeenCalled();
    const call = onAction.mock.calls[0][0];
    expect(call.skillId).toBe('杀');
    expect(call.actionType).toBe('respond');
    expect(call.params.cardId).toBe('c1#武圣');
    expect(call.preceding).toEqual([
      { skillId: '武圣', actionType: 'transform', params: { cardId: 'c1' } },
    ]);
  });
});

// 贯石斧(武器):使用杀被目标闪抵消后,引擎发 被动 distribute pending
//   requestType='贯石斧/select' prompt.type='distribute' mode='select'
//   source='handAndEquip' minTotal=2 maxTotal=2
// 人类(React)前端回归守卫:被动 distribute pending 应弹选牌面板——手牌/装备可点选
// 高亮 + 提交按钮,提交发出 贯石斧:respond {cardIds}。(该路径本就正常,本测试固化契约。)
// Bug4 真实根因在无头/AI 客户端 appendRespondActions(见 availableActions.test.ts):
// 缺 distribute 分支 → 只生成 skip → AI 不发动贯石斧。
describe('GameView:贯石斧被动 distribute(杀被闪抵消后选 2 张弃置强命)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('被动 distribute pending 渲染手牌候选 + 提交按钮,提交发出 贯石斧:respond cardIds', async () => {
    const base = makeView();
    const view: GameView = {
      ...base,
      viewer: 0,
      currentPlayerIndex: 0,
      players: [
        {
          ...base.players[0],
          index: 0,
          name: '界夏侯惇',
          character: '界夏侯惇',
          skills: ['使用牌', '打出牌'],
          hand: [makeCard('c1', '杀'), makeCard('c2', '桃'), makeCard('c5', '闪')],
          handCount: 3,
          equipment: { 武器: 'eq1' },
        },
        {
          ...base.players[1],
          name: '界孙策',
          character: '界孙策',
        },
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '桃'),
        c5: makeCard('c5', '闪'),
        eq1: { id: 'eq1', name: '贯石斧', suit: '♦', color: '红', rank: '5', type: '装备牌' },
      },
      pending: {
        type: 'awaits',
        atom: {
          type: '请求回应',
          requestType: '贯石斧/select',
          target: 0,
        } as GameView['pending'] extends infer P
          ? P extends { atom: infer A }
            ? A
            : never
          : never,
        prompt: {
          type: 'distribute',
          title: '贯石斧:选择 2 张牌弃置强命(不选则不发动)',
          mode: 'select',
          source: 'handAndEquip',
          minTotal: 2,
          maxTotal: 2,
        },
        target: 0,
        isBlocking: true,
      },
    };

    const onAction = vi.fn();
    const { container } = render(<GameViewComponent view={view} onAction={onAction} />);

    // handHeader 提示应出现
    await waitFor(() => {
      expect(screen.getAllByText(/贯石斧:选择 2 张牌弃置强命/).length).toBeGreaterThan(0);
    });

    // 手牌候选可点选(c2 桃)
    const c2El = container.querySelector('[data-card-id="c2"]');
    expect(c2El).not.toBeNull();
    fireEvent.click(c2El!);
    // 选第二张(c5 闪)
    const c5El = container.querySelector('[data-card-id="c5"]');
    expect(c5El).not.toBeNull();
    fireEvent.click(c5El!);

    // 提交按钮(确认(N)),应可点
    const submitBtn = await screen.findByRole('button', { name: /确认/ });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submitBtn);

    // 提交发出 贯石斧:respond {cardIds:[c2,c5]}
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: '贯石斧',
          actionType: 'respond',
          params: expect.objectContaining({
            cardIds: expect.arrayContaining(['c2', 'c5']),
          }),
        }),
      );
    });
  });

  // 火攻等展示手牌操作的粘性展示卡:展示事件(useEventPlayback STICKY_REVEAL_TYPES)
  // 退出 banner 定时队列,由 GameView 从 ingested 派生常驻显示——翻入后停住不淡出,
  // 展示期间玩家照常操作(AwaitingPrompt 不被 isPlayingFlipAnim 门控),
  // 任何动作提交(send 唯一出口)后立即消失。回归前:展示按 600ms/3s 定时淡出且
  // 门控询问,玩家要么看不清、要么被迫干等动画播完才能弃牌。
  // 来源:2026-08 前端体验修复;若未来有专门的横幅/EventBanner 测试文件可归并。
  it('展示事件渲染粘性卡:常驻+不门控询问,提交动作后立即消失', async () => {
    const view = makeView();
    const withPending: GameView = {
      ...view,
      viewer: 0,
      players: [
        { ...view.players[0], name: 'P1', skills: ['使用牌', '打出牌'] },
        { ...view.players[1], name: 'P2' },
      ],
      pending: {
        type: 'awaits',
        atom: {
          type: '请求回应',
          requestType: '火攻/弃牌',
          target: 0,
        } as GameView['pending'] extends infer P
          ? P extends { atom: infer A }
            ? A
            : never
          : never,
        // 火攻使用者视角:看完展示的♦后要挑同花色♦弃置——询问必须与展示同时可见
        prompt: { type: 'confirm', title: '是否弃置一张♦牌?' },
        target: 0,
        isBlocking: true,
      },
    };
    const ingested = [
      {
        seq: 1,
        event: {
          type: '展示',
          player: 1,
          cardId: 'r1',
          card: { name: '杀', suit: '♦', rank: '3' },
          effect: { sound: 'flip', animation: 'flip', duration: 700 },
        },
      },
    ] as unknown as QueuedEvent[];
    const onAction = vi.fn();
    const { container } = render(
      <GameViewComponent view={withPending} onAction={onAction} ingestedEvents={ingested} />,
    );

    // 1. 粘性卡渲染:入场动画时长取事件 duration(700ms),牌面 ♦3 杀 + 展示者标签可见
    const revealEl = container.querySelector('[style*="--flip-duration"]');
    expect(revealEl).not.toBeNull();
    expect((revealEl as HTMLElement).style.getPropertyValue('--flip-duration')).toBe('700ms');
    expect(revealEl!.textContent).toContain('P2 展示');
    expect(revealEl!.textContent).toContain('杀');
    expect(revealEl!.textContent).toContain('♦');
    expect(revealEl!.textContent).toContain('3');

    // 2. 不门控:询问标题与粘性卡同时可见(玩家边看展示边决策)
    expect(screen.getAllByText(/是否弃置一张♦牌/).length).toBeGreaterThan(0);

    // 3. 提交动作 → 粘性卡立即消失(confirm 按钮走 send 唯一出口)
    const confirmBtn = await screen.findByRole('button', { name: '确认' });
    fireEvent.click(confirmBtn);
    expect(onAction).toHaveBeenCalled();
    expect(container.querySelector('[style*="--flip-duration"]')).toBeNull();
    // 询问面板仍在(消失的只是展示卡)
    expect(screen.getAllByText(/是否弃置一张♦牌/).length).toBeGreaterThan(0);
  });

  // 展示结束事件(引擎收尾信号)驱动收卡:火攻使用者弃牌/不弃/超时后引擎广播
  // 「展示结束」;本地 send 清除只覆盖使用者本人——旁观/回放/其他座次没有本地动作,
  // 且「不弃/超时」路径后续无任何事件可推断收尾,只能靠此事件收卡。
  // 引擎侧发射契约见 tests/skill-tests/火攻.test.ts 用例 11。
  it('展示结束事件到达 → 粘性卡收起(无本地动作,事件驱动)', async () => {
    const view = makeView();
    const withPending: GameView = {
      ...view,
      viewer: 1, // 其他座次视角:自己无操作,粘性卡只能靠事件收起
      players: [
        { ...view.players[0], name: 'P1', skills: ['使用牌', '打出牌'] },
        { ...view.players[1], name: 'P2', hand: [], handCount: 0 },
      ],
      pending: null,
    };
    const revealBatch = [
      {
        seq: 1,
        event: {
          type: '展示',
          player: 0,
          cardId: 'r1',
          card: { name: '杀', suit: '♦', rank: '3' },
          effect: { sound: 'flip', animation: 'flip', duration: 700 },
        },
      },
    ] as unknown as QueuedEvent[];
    const { container, rerender } = render(
      <GameViewComponent view={withPending} onAction={() => {}} ingestedEvents={revealBatch} />,
    );

    // 1. 粘性卡渲染
    expect(container.querySelector('[style*="--flip-duration"]')).not.toBeNull();

    // 2. 展示结束事件批次到达(如 P1 弃完牌/超时不弃)→ 粘性卡收起
    const endBatch = [
      { seq: 2, event: { type: '展示结束', player: 0, cardId: 'r1' } },
    ] as unknown as QueuedEvent[];
    rerender(
      <GameViewComponent view={withPending} onAction={() => {}} ingestedEvents={endBatch} />,
    );
    expect(container.querySelector('[style*="--flip-duration"]')).toBeNull();
  });
});

// ─── selectTarget 型主动技(挑衅/反间/强袭/攻心/雄乱 等)────────────────
// 回归根因:PlayerCardLarge.triggerableActions 只收 confirm/choosePlayer/
// (useCardAndTarget+transform)/distribute —— selectTarget 型主动技整类无按钮,
// 浏览器里点不到(与 distribute 漏网同因);且没有任何"进入选目标模式"的入口,
// 座位环永不进入可选目标态 → 即便有按钮也拿不到 target。
// 另:handleSkillAction 的 selectTarget 分支只发 params.target,而反间/攻心/雄乱
// 读 params.targets → 即使有按钮也会被 validate 拒(「需要指定一名目标」)。
describe('GameView:selectTarget 型主动技按钮', () => {
  beforeEach(() => {
    clearRegistry();
  });

  /** 视角玩家 P1 持有 selectTarget 型主动技 skillId 的 view。 */
  function makeSelectTargetView(skillId: string): GameView {
    const base = makeView();
    return makeView({
      players: [
        { ...base.players[0], skills: [skillId] },
        { ...base.players[1], name: 'P2', character: 'P2' },
      ],
    });
  }

  it('挑衅:出牌阶段渲染按钮;点按钮进入选目标模式 → 点目标座位即提交 { target, targets }', async () => {
    const view = makeSelectTargetView('挑衅');
    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} />);

    // 注册技能 actions 是 async(dynamic import),等按钮出现
    const btn = await screen.findByRole('button', { name: '挑衅' });

    // 第一步:点技能按钮 → 进入选目标模式(尚未提交)
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onAction).not.toHaveBeenCalled();

    // 第二步:点目标座位 → 单选技能直接提交(反间/攻心/雄乱 读 targets,故两者都发)
    await act(async () => {
      fireEvent.click(document.querySelector('[data-player-name="P2"]')!);
    });

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: '挑衅',
          actionType: 'use',
          params: expect.objectContaining({ target: 1, targets: [1] }),
        }),
      );
    });
  });

  it('强袭:paramVariants 代价二选一 → 两个按钮,选目标后提交携带对应 cost', async () => {
    const view = makeSelectTargetView('强袭');
    const onAction = vi.fn();
    render(<GameViewComponent view={view} onAction={onAction} />);

    const hpBtn = await screen.findByRole('button', { name: /强袭·失去1点体力/ });
    const discardBtn = screen.getByRole('button', { name: /强袭·弃一张武器牌/ });

    // 点"弃一张武器牌"变体按钮 → 进入选目标模式,携带 cost
    await act(async () => {
      fireEvent.click(discardBtn);
    });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-player-name="P2"]')!);
    });

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: '强袭',
          actionType: 'use',
          params: expect.objectContaining({ target: 1, cost: 'discard' }),
        }),
      );
    });
    expect(hpBtn).toBeDefined();
  });

  // 回归:弃武器变体需要一张武器牌(引擎 validate 要求 cardId),旧实现没有任何客户端
  // 提供它 —— 浏览器没有选牌步骤、无头枚举只发 {cost:'discard'} → 提交恒拒
  // 「弃武器需要 cardId」。现在:先选中一张武器牌再点变体按钮 → 提交携带 cardId。
  it('强袭·弃一张武器牌:先选中武器牌 → 提交携带 cardId', async () => {
    const base = makeView();
    const weapon: Card = {
      id: 'w1',
      name: '青釭剑',
      suit: '♠',
      color: '黑',
      rank: '6',
      type: '装备牌',
      subtype: '武器',
    };
    const view: GameView = makeView({
      players: [
        {
          ...base.players[0],
          skills: ['强袭'],
          handCount: 2,
          hand: [weapon, makeCard('c9', '杀')],
        },
        { ...base.players[1], name: 'P2', character: 'P2' },
      ],
      cardMap: { ...base.cardMap, w1: weapon },
    });
    const onAction = vi.fn();
    const { container } = render(<GameViewComponent view={view} onAction={onAction} />);

    // 先选中武器牌(武器牌以「装备」入口渲染,选中后变体提交才能带上 cardId)
    const weaponEl = await waitFor(() => {
      const el = container.querySelector('[data-card-id="w1"]');
      expect(el).toBeTruthy();
      return el!;
    });
    await act(async () => {
      fireEvent.click(weaponEl);
    });

    const discardBtn = await screen.findByRole('button', { name: /强袭·弃一张武器牌/ });
    await act(async () => {
      fireEvent.click(discardBtn);
    });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-player-name="P2"]')!);
    });

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: '强袭',
          actionType: 'use',
          params: expect.objectContaining({ target: 1, cost: 'discard', cardId: 'w1' }),
        }),
      );
    });
  });
});

// ─── 转化技回应窗口:倾国(黑牌当闪)──────────────────────────────
// 回归根因:triggerableActions 不收 useCard+transform(倾国/看破 型转化技) → 回应窗口里
// 没有技能按钮;且 handleTransformPlay 的回应分支只认 isKillRespondContext(被询问杀)
// → 即便点了按钮也会走 use 路径,提交出错误的 action。AI 侧同源缺口见
// tests/headless/availableActions.test.ts「转化技回应窗口」。
describe('GameView:转化技回应窗口(倾国 黑牌当闪)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('被询问闪时:倾国按钮出现 → 选黑牌 → 提交 闪.respond + preceding transform', async () => {
    const blackKill: Card = {
      id: 'k1',
      name: '杀',
      suit: '♠',
      color: '黑',
      rank: '7',
      type: '基本牌',
    };
    const view: GameView = {
      viewer: 0,
      currentPlayerIndex: 1, // 别人回合:被杀指定
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      players: [
        {
          index: 0,
          name: '甄姬',
          character: '甄姬',
          health: 3,
          maxHealth: 3,
          alive: true,
          equipment: {},
          skills: ['使用牌', '打出牌', '倾国'],
          handCount: 1,
          hand: [blackKill],
          marks: [],
        },
        {
          index: 1,
          name: 'P1',
          character: 'P1',
          health: 4,
          maxHealth: 4,
          alive: true,
          equipment: {},
          skills: ['使用牌', '打出牌'],
          handCount: 0,
          marks: [],
        },
      ],
      cardMap: { k1: blackKill },
      pending: {
        type: 'awaits',
        atom: { type: '询问闪', target: 0, source: 1 } as never,
        prompt: {
          type: 'useCard',
          title: '请打出闪',
          cardFilter: { filter: (c: Card) => c.name === '闪', min: 1, max: 1 },
        },
        target: 0,
        isBlocking: true,
        totalMs: 50000,
      },
      deadline: null,
      deadlineTotalMs: 0,
      log: [],
      settlementStack: [],
    };
    const onAction = vi.fn();
    const { container } = render(<GameViewComponent view={view} onAction={onAction} />);

    // 1. 倾国按钮出现(回应窗口激活)
    const qgBtn = await screen.findByRole('button', { name: '倾国' });
    await act(async () => {
      fireEvent.click(qgBtn);
    });

    // 2. 选黑牌 k1(转化模式:黑牌可选,字面闪过滤器不拦)
    const cardEl = container.querySelector('[data-card-id="k1"]')!;
    expect(cardEl).toBeTruthy();
    await act(async () => {
      fireEvent.click(cardEl);
    });

    // 3. 提交:主 action = 闪.respond(影子牌) + preceding 倾国.transform
    const useBtn = await screen.findByRole('button', { name: /使用闪/ });
    await act(async () => {
      fireEvent.click(useBtn);
    });

    expect(onAction).toHaveBeenCalled();
    const call = onAction.mock.calls[0][0];
    expect(call.skillId).toBe('闪');
    expect(call.actionType).toBe('respond');
    expect(call.params.cardId).toBe('k1#倾国');
    expect(call.preceding).toEqual([
      { skillId: '倾国', actionType: 'transform', params: { cardId: 'k1' } },
    ]);
  });
});

// 回归:chooseOption 型主动技(决堰:废除哪个装备栏)在浏览器无按钮、无法发动。
// PlayerCardLarge 的 triggerableActions 过滤缺 chooseOption → 按钮不渲染;
// handleSkillAction 也没有提交 params.option 的分支(default 只发 extraParams)。
// 无头/AI 客户端(availableActions 的 enumeratePromptActions)早已支持 chooseOption,
// 只有浏览器整类不可达 —— 玩家点不到按钮,技能在真实对局里等于不存在。
describe('GameView:chooseOption 型主动技按钮(决堰)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('决堰渲染为按选项展开的按钮,点击提交 {option}', async () => {
    const onAction = vi.fn();
    const view = makeView({
      players: [
        {
          index: 0,
          name: 'P1',
          character: '陆抗',
          health: 4,
          maxHealth: 4,
          alive: true,
          equipment: {},
          skills: ['决堰'],
          handCount: 1,
          hand: [makeCard('c1', '杀')],
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
          skills: [],
          handCount: 1,
          marks: [],
        },
      ],
    });
    render(<GameViewComponent view={view} onAction={onAction} />);

    // 每个选项一个按钮(武器/防具/坐骑/宝物)
    const weaponBtn = await screen.findByRole('button', { name: '决堰·武器' });
    expect(screen.getByRole('button', { name: '决堰·防具' })).toBeDefined();
    expect(screen.getByRole('button', { name: '决堰·坐骑' })).toBeDefined();
    expect(screen.getByRole('button', { name: '决堰·宝物' })).toBeDefined();

    await act(async () => {
      fireEvent.click(weaponBtn);
    });

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: '决堰',
          actionType: 'use',
          params: expect.objectContaining({ option: '武器' }),
        }),
      );
    });
  });
});

// ─── 同 skillId 多 action 的技能按钮(界父魂 transform + 武圣transform)─────────
// 回归根因:PlayerCardLarge 按 skillId 过滤出多个 action 后 flatMap 展开,
// skillActionVariants 对 useCard/useCardAndTarget 类恒返回 label:'' →
// key 塌缩成重复的 skillId(React duplicate key 警告),且 action 自身的 label
// (界父魂 的 '父魂'/'武圣')被丢弃——两个按钮渲染成同名 '父魂',无法区分。
// 修复:btns.length > 1 时把 action 的 label(或 actionType)作为变体 label
// 纳入 key/children,保证按钮可区分、key 唯一。
describe('GameView:同 skillId 多 action 技能按钮(界父魂)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('两个 transform 入口渲染为可区分按钮,且无重复 key 警告;各按钮接线独立', async () => {
    const redPeach: Card = {
      id: 'p1',
      name: '桃',
      suit: '♥',
      color: '红',
      rank: 'A',
      type: '基本牌',
    };
    const view = makeView({
      players: [
        {
          index: 0,
          name: '关索',
          character: '关索',
          health: 4,
          maxHealth: 4,
          alive: true,
          equipment: {},
          skills: ['使用牌', '界父魂'],
          handCount: 3,
          hand: [makeCard('k1', '杀'), redPeach, makeCard('d1', '闪')],
          marks: [],
          // 已获授武圣(杀/unlimited/父魂):武圣transform 入口激活
          turnUsage: { '杀/unlimited/父魂': true },
        },
        makeView().players[1],
      ],
      cardMap: {
        k1: makeCard('k1', '杀'),
        p1: redPeach,
        d1: makeCard('d1', '闪'),
      },
    });
    const onAction = vi.fn();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<GameViewComponent view={view} onAction={onAction} />);

    try {
      // 两个按钮:父魂(2 张牌转化)与 父魂·武圣(红色手牌转化),label 不同可区分
      const fuhunBtn = await screen.findByRole('button', { name: '父魂' });
      const wushengBtn = await screen.findByRole('button', { name: '父魂·武圣' });
      expect(fuhunBtn).not.toBe(wushengBtn);
      // 无重复 key:修复前两个按钮 key 均为 '界父魂',React 会发出 duplicate key 警告
      const keyWarnings = errSpy.mock.calls.filter((args) =>
        String(args[0]).match(/same key|unique "key"/),
      );
      expect(keyWarnings).toEqual([]);

      // 接线独立:点 父魂·武圣 进入单卡红牌转化模式 → 黑牌不可选、红牌可选
      await act(async () => {
        fireEvent.click(wushengBtn);
      });
      const blackCard = container.querySelector('[data-card-id="k1"]')!;
      await act(async () => {
        fireEvent.click(blackCard);
      });
      expect(screen.queryByRole('button', { name: /使用杀/ })).toBeNull();
      const redCard = container.querySelector('[data-card-id="p1"]')!;
      await act(async () => {
        fireEvent.click(redCard);
      });
      expect(screen.getByRole('button', { name: /使用杀/ })).toBeDefined();
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ─── 多卡转化 comboFilter(乱击 两张同花色)与「使用」按钮禁用态 ────────────────
// 回归根因:CenterActionBar 多卡转化的 canSubmit 内联为 enough && (!needsTarget ||
// !!selectedTarget),漏 comboFilter(乱击/界乱击 两张须同花色)——异花色组合下按钮
// 可点但 handleTransformPlay 静默 return(点了没反应)。修复:canSubmit/needsTarget
// 以 play.transformSubmit(含 comboOk)为唯一判定源。
describe('GameView:乱击 comboFilter 异花色组合禁用「使用」按钮', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('选两张异花色 → 使用按钮 disabled;换同花色 → 可提交', async () => {
    const redPeach: Card = {
      id: 'p1',
      name: '桃',
      suit: '♥',
      color: '红',
      rank: 'A',
      type: '基本牌',
    };
    const view = makeView({
      players: [
        {
          index: 0,
          name: '袁绍',
          character: '袁绍',
          health: 4,
          maxHealth: 4,
          alive: true,
          equipment: {},
          skills: ['使用牌', '乱击'],
          handCount: 3,
          hand: [makeCard('s1', '杀'), redPeach, makeCard('d1', '闪')],
          marks: [],
        },
        makeView().players[1],
      ],
      cardMap: {
        s1: makeCard('s1', '杀'),
        p1: redPeach,
        d1: makeCard('d1', '闪'),
      },
    });
    const onAction = vi.fn();
    const { container } = render(<GameViewComponent view={view} onAction={onAction} />);

    // 进入乱击转化模式(手牌存在 ♠ 对,activeWhen 满足)
    const luanjiBtn = await screen.findByRole('button', { name: '乱击' });
    await act(async () => {
      fireEvent.click(luanjiBtn);
    });

    // 选中 ♠杀 + ♥桃(异花色):张数 enough 但 comboFilter 不满足 → 按钮必须 disabled
    const cardS1 = container.querySelector('[data-card-id="s1"]')!;
    const cardP1 = container.querySelector('[data-card-id="p1"]')!;
    await act(async () => {
      fireEvent.click(cardS1);
      fireEvent.click(cardP1);
    });
    const useBtn = await screen.findByRole('button', { name: '使用万箭齐发' });
    expect(useBtn).toBeDisabled();
    // 点击禁用按钮不触发提交
    await act(async () => {
      fireEvent.click(useBtn);
    });
    expect(onAction).not.toHaveBeenCalled();

    // 换成 ♠杀 + ♠闪(同花色):combo 满足 → 按钮可点并正常提交
    await act(async () => {
      fireEvent.click(cardP1); // 取消 ♥桃(toggle)
      fireEvent.click(container.querySelector('[data-card-id="d1"]')!);
    });
    const useBtnOk = screen.getByRole('button', { name: '使用万箭齐发' });
    expect(useBtnOk).toBeEnabled();
    await act(async () => {
      fireEvent.click(useBtnOk);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    const call = onAction.mock.calls[0][0];
    expect(call.skillId).toBe('万箭齐发');
    expect(call.actionType).toBe('use');
    expect(call.params.cardId).toBe('s1#d1#乱击');
    expect(call.preceding).toEqual([
      { skillId: '乱击', actionType: 'transform', params: { cardIds: ['s1', 'd1'] } },
    ]);
  });
});
