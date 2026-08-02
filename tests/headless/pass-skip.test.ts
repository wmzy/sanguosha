// tests/headless/pass-skip.test.ts
// 验证 HeadlessGameClient.pass() 对广播型 pending(无懈可击)发 skip 而非 respond,
// 且 getAvailableActions() 包含跳过 action。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import type { GameView, PendingView, Card } from '../../src/engine/types';

function makeBroadcastPending(): PendingView {
  return {
    type: 'awaits',
    atom: {
      type: '请求回应',
      requestType: '无懈可击',
      target: -2,
      prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: () => true, min: 1, max: 1 } },
      timeout: 10,
    },
    prompt: { type: 'useCard', title: '是否打出无懈可击?', cardFilter: { filter: () => true, min: 1, max: 1 } },
    target: -2,
    isBlocking: true,
    deadline: Date.now() + 10000,
    totalMs: 10000,
  };
}

function makeBlockingPending(target: number): PendingView {
  return {
    type: 'awaits',
    atom: {
      type: '请求回应',
      requestType: '闪',
      target,
      prompt: { type: 'useCard', title: '是否打出闪?', cardFilter: { filter: () => true, min: 1, max: 1 } },
    },
    prompt: { type: 'useCard', title: '是否打出闪?', cardFilter: { filter: () => true, min: 1, max: 1 } },
    target,
    isBlocking: true,
    deadline: Date.now() + 30000,
    totalMs: 30000,
  };
}

function makeView(pending: PendingView | null, seat = 0): GameView {
  return {
    viewer: seat,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: 'P0',
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
        index: 1,
        name: 'P1',
        character: '',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 4,
        marks: [],
      },
    ],
    cardMap: {},
    pending,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

/** makeView 变体：指定 seat 玩家的手牌列表（用于 cardFilter 测试）。 */
function makeViewWithHand(pending: PendingView, seat: number, hand: Card[]): GameView {
  const view = makeView(pending, seat);
  view.players[seat].hand = hand;
  view.players[seat].handCount = hand.length;
  return view;
}

describe('HeadlessGameClient.pass() — 广播型 pending 发 skip', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('广播型 pending(无懈可击):pass() 发 skip action', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    (hgc as unknown as { _view: GameView | null })._view = makeView(makeBroadcastPending());

    const spy = vi.spyOn(hgc, 'sendAction');
    hgc.pass();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      skillId: '__skip',
      actionType: 'skip',
      ownerId: 0,
      params: {},
      baseSeq: 0,
    });
  });

  it('阻塞型 pending(询问闪):pass() 发 skip action', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 1;
    (hgc as unknown as { _view: GameView | null })._view = makeView(makeBlockingPending(1));

    const spy = vi.spyOn(hgc, 'sendAction');
    hgc.pass();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      skillId: '__skip',
      actionType: 'skip',
      ownerId: 1,
      params: {},
      baseSeq: 0,
    });
  });

  it('无 pending 时:pass() 走旧逻辑(发 respond)', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    (hgc as unknown as { _view: GameView | null })._view = makeView(null);

    const spy = vi.spyOn(hgc, 'sendAction');
    hgc.pass();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].actionType).toBe('respond');
  });
});

describe('HeadlessGameClient.getAvailableActions() — 广播型 pending 包含跳过', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('广播型 pending:availableActions 包含 skip action', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    (hgc as unknown as { _view: GameView | null })._view = makeView(makeBroadcastPending());

    const actions = hgc.getAvailableActions();
    const skipAction = actions.find((a) => a.category === 'skip');
    expect(skipAction).toBeDefined();
    expect(skipAction!.message.actionType).toBe('skip');
    expect(skipAction!.message.skillId).toBe('__skip');
    expect(skipAction!.description).toContain('跳过');
  });

  it('非广播型阻塞 pending:availableActions 包含 skip action（不出）', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 1;
    (hgc as unknown as { _view: GameView | null })._view = makeView(makeBlockingPending(1));

    const actions = hgc.getAvailableActions();
    const skipAction = actions.find((a) => a.category === 'skip');
    // 非广播型阻塞 pending（询问杀/闪等）也包含 skip action 表示「不出」
    expect(skipAction).toBeDefined();
  });
});

// 回归测试：0RXMwn / Jx58Hd — respond action 必须携带正确 params
//   杀.respond 空 params → validate 通过但 apply 跳过 → 杀没进处理区 → 受伤
//   突袭/trigger 空 params → choice=undefined → 被当作"不发动"
//   修复：appendRespondActions 按 pending 类型填充 cardId 或 choice
describe('HeadlessGameClient.getAvailableActions() — respond params 填充', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('询问杀 + 有杀牌:respond action 携带 cardId', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 1;
    const killCard: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
    const flashCard: Card = { id: 'f1', name: '闪', suit: '♥', color: '红', rank: '5', type: '基本牌' };
    (hgc as unknown as { _view: GameView | null })._view = makeViewWithHand(
      {
        type: 'awaits',
        atom: { type: '询问杀', target: 1, source: 0 },
        prompt: { type: 'confirm', title: '是否出杀？' },
        target: 1,
        isBlocking: true,
      },
      1,
      [killCard, flashCard],
    );

    const actions = hgc.getAvailableActions();
    const respondActions = actions.filter((a) => a.category === 'respond');
    // 应有一张带 cardId 的杀 respond（而非空 params）
    expect(respondActions.length).toBe(1);
    expect(respondActions[0].message.params).toEqual({ cardId: 'k1' });
    // 闪牌不应出现（cardFilter 只匹配杀）
    expect(respondActions.find((a) => a.message.params?.cardId === 'f1')).toBeUndefined();
  });

  it('突袭/trigger:respond 携带 choice:true / choice:false', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    (hgc as unknown as { _view: GameView | null })._view = makeViewWithHand(
      {
        type: 'awaits',
        atom: { type: '请求回应', requestType: '突袭/trigger', target: 0, prompt: { type: 'useCard', title: '是否发动突袭?', cardFilter: { filter: () => true, min: 1, max: 1 } } },
        prompt: { type: 'confirm', title: '是否发动突袭?', confirmLabel: '发动', cancelLabel: '不发动' },
        target: 0,
        isBlocking: true,
      },
      0,
      [],
    );

    const actions = hgc.getAvailableActions();
    const confirmAction = actions.find((a) => a.message.params?.choice === true);
    const cancelAction = actions.find((a) => a.message.params?.choice === false);
    expect(confirmAction).toBeDefined();
    expect(confirmAction!.message.skillId).toBe('突袭');
    expect(cancelAction).toBeDefined();
    expect(cancelAction!.message.params).toEqual({ choice: false });
  });

  it('询问杀 + 无杀牌:只有 skip（无空 params respond）', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 1;
    const flashCard: Card = { id: 'f1', name: '闪', suit: '♥', color: '红', rank: '5', type: '基本牌' };
    (hgc as unknown as { _view: GameView | null })._view = makeViewWithHand(
      {
        type: 'awaits',
        atom: { type: '询问杀', target: 1, source: 0 },
        prompt: { type: 'confirm', title: '是否出杀？' },
        target: 1,
        isBlocking: true,
      },
      1,
      [flashCard],
    );

    const actions = hgc.getAvailableActions();
    const respondActions = actions.filter((a) => a.category === 'respond');
    // 不应有空 params 的 respond（0RXMwn 根因）
    expect(respondActions.length).toBe(0);
    const skipAction = actions.find((a) => a.category === 'skip');
    expect(skipAction).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// 卡牌回应 silent 模式:target 有手牌但无匹配响应牌 → 不被询问。
// headless 不应为该 pending 生成 skip/respond action(否则 AI 提前 skip 绕过短延时,
// 暴露"无匹配牌"信息)。needsAction 也应为 false。
// ─────────────────────────────────────────────────────────────
describe('HeadlessGameClient — 卡牌回应 silent 模式不生成 action', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('询问杀 silent(target 无杀但有手牌):getAvailableActions 无 skip/respond,needsAction=false', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 1;
    const flashCard: Card = { id: 'f1', name: '闪', suit: '♥', color: '红', rank: '5', type: '基本牌' };
    (hgc as unknown as { _view: GameView | null })._view = makeViewWithHand(
      {
        type: 'awaits',
        atom: { type: '询问杀', target: 1, source: 0 },
        prompt: { type: 'confirm', title: '等待回应', cancelLabel: '' },
        target: 1,
        isBlocking: true,
        responseMode: 'silent',
      },
      1,
      [flashCard],
    );

    // needsAction=false:silent 模式下该座次不应被提示行动(让短延时自然超时)
    expect(hgc.needsAction()).toBe(false);
    const actions = hgc.getAvailableActions();
    // 不生成 skip/respond(避免 AI 提前 skip 绕过延时)
    expect(actions.filter((a) => a.category === 'respond')).toHaveLength(0);
    expect(actions.filter((a) => a.category === 'skip')).toHaveLength(0);
  });

  it('询问杀 normal(target 有杀):维持现状——生成 respond + skip', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 1;
    const killCard: Card = { id: 'k1', name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
    (hgc as unknown as { _view: GameView | null })._view = makeViewWithHand(
      {
        type: 'awaits',
        atom: { type: '询问杀', target: 1, source: 0 },
        prompt: { type: 'useCard', title: '是否出杀', cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 } },
        target: 1,
        isBlocking: true,
        responseMode: 'normal',
      },
      1,
      [killCard],
    );

    expect(hgc.needsAction()).toBe(true);
    const actions = hgc.getAvailableActions();
    expect(actions.filter((a) => a.category === 'respond').length).toBeGreaterThan(0);
    expect(actions.find((a) => a.category === 'skip')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// 广播无懈可击自动跳过:本座次无 respond/transform 能力(仅 skip action)时,
// handleRaw 收到新 view 后自动发 skip,省去 LLM 决策往返。以 deadline 去重同一窗口。
// ─────────────────────────────────────────────────────────────
describe('HeadlessGameClient — 自动跳过决策(通用)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('空手牌 + 无法响应 → act-now(立即同步发 skip)', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    // P0 空手牌(handCount=0),无转化技 → 公开无法响应 → 立即跳过
    (hgc as unknown as { _view: GameView | null })._view = makeView(makeBroadcastPending(), 0);
    const spy = vi.spyOn(hgc, 'sendAction');
    (hgc as unknown as { maybeAutoSkipBroadcast: () => void }).maybeAutoSkipBroadcast();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: '__skip', actionType: 'skip', ownerId: 0 }),
    );
  });

  it('有手牌但无法响应 → act-delayed(延迟发 skip,防泄露)', () => {
    vi.useFakeTimers();
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    // P0 有闪(无无懈) → 私有无法响应 → 延迟跳过
    const flashCard: Card = { id: 'f1', name: '闪', suit: '♥', color: '红', rank: '5', type: '基本牌' };
    (hgc as unknown as { _view: GameView | null })._view = makeViewWithHand(
      makeBroadcastPending(), 0, [flashCard],
    );
    const spy = vi.spyOn(hgc, 'sendAction');
    (hgc as unknown as { maybeAutoSkipBroadcast: () => void }).maybeAutoSkipBroadcast();
    expect(spy).not.toHaveBeenCalled(); // 尚未触发(延迟中)
    vi.advanceTimersByTime(2000); // 超过最大延迟 2000ms
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('持无懈可击 → 不自动跳过(有 respond action,canRespond=true)', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    const wuxieCard: Card = { id: 'w1', name: '无懈可击', suit: '♠', color: '黑', rank: 'J', type: '锦囊牌' };
    (hgc as unknown as { _view: GameView | null })._view = makeViewWithHand(
      makeBroadcastPending(), 0, [wuxieCard],
    );
    const spy = vi.spyOn(hgc, 'sendAction');
    (hgc as unknown as { maybeAutoSkipBroadcast: () => void }).maybeAutoSkipBroadcast();
    expect(spy).not.toHaveBeenCalled();
  });

  it('同一窗口(deadline)去重 → 不重复发 skip', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    // 空手牌 → act-now(同步),便于测去重
    (hgc as unknown as { _view: GameView | null })._view = makeView(makeBroadcastPending(), 0);
    const spy = vi.spyOn(hgc, 'sendAction');
    const maybe = (hgc as unknown as { maybeAutoSkipBroadcast: () => void }).maybeAutoSkipBroadcast.bind(hgc);
    maybe();
    maybe(); // 同一 deadline 不重复
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('新窗口(deadline 变化)→ 再次自动跳过', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    const pending1 = makeBroadcastPending();
    (hgc as unknown as { _view: GameView | null })._view = makeView(pending1, 0);
    const spy = vi.spyOn(hgc, 'sendAction');
    const maybe = (hgc as unknown as { maybeAutoSkipBroadcast: () => void }).maybeAutoSkipBroadcast.bind(hgc);
    maybe();
    // 新窗口(deadline 不同)
    const pending2 = makeBroadcastPending();
    pending2.deadline = (pending1.deadline ?? 0) + 5000;
    pending2.totalMs = 10000;
    (hgc as unknown as { _view: GameView | null })._view = makeView(pending2, 0);
    maybe();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('出牌窗口(isBlocking===false)→ 不自动跳过', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    const pending: PendingView = {
      type: 'awaits',
      atom: { type: '出牌窗口', player: 0 } as PendingView['atom'],
      prompt: { type: 'confirm', title: '出牌阶段' } as PendingView['prompt'],
      target: 0,
      isBlocking: false,
      deadline: Date.now() + 30000,
      totalMs: 30000,
    };
    (hgc as unknown as { _view: GameView | null })._view = makeView(pending, 0);
    const spy = vi.spyOn(hgc, 'sendAction');
    (hgc as unknown as { maybeAutoSkipBroadcast: () => void }).maybeAutoSkipBroadcast();
    expect(spy).not.toHaveBeenCalled();
  });

  it('旁观者 → 不自动跳过', () => {
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    (hgc as unknown as { _isSpectator: boolean })._isSpectator = true;
    (hgc as unknown as { _view: GameView | null })._view = makeView(makeBroadcastPending(), 0);
    const spy = vi.spyOn(hgc, 'sendAction');
    (hgc as unknown as { maybeAutoSkipBroadcast: () => void }).maybeAutoSkipBroadcast();
    expect(spy).not.toHaveBeenCalled();
  });

  it('策略跳过(optInSkip)→ 即使能响应也延迟跳过', () => {
    vi.useFakeTimers();
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    (hgc as unknown as { _autoSkipPrefs: unknown })._autoSkipPrefs = { optInSkip: { '无懈可击': true } };
    const wuxieCard: Card = { id: 'w1', name: '无懈可击', suit: '♠', color: '黑', rank: 'J', type: '锦囊牌' };
    (hgc as unknown as { _view: GameView | null })._view = makeViewWithHand(
      makeBroadcastPending(), 0, [wuxieCard],
    );
    const spy = vi.spyOn(hgc, 'sendAction');
    (hgc as unknown as { maybeAutoSkipBroadcast: () => void }).maybeAutoSkipBroadcast();
    expect(spy).not.toHaveBeenCalled(); // 延迟中
    vi.advanceTimersByTime(2000);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('延迟跳过期间 view 推进到新窗口 → 旧 skip 不误作用于新窗口(防串扰)', () => {
    // 复现南蛮入侵/决斗场景:无懈广播被延迟跳过,延迟期间 view 推进到杀问询。
    // 旧 setTimeout 触发时若不校验窗口,pass() 用实时 _lastSeq 会误跳过杀问询。
    vi.useFakeTimers();
    const hgc = new HeadlessGameClient('ws://localhost:0');
    (hgc as unknown as { _seatIndex: number })._seatIndex = 0;
    const maybe = (hgc as unknown as { maybeAutoSkipBroadcast: () => void })
      .maybeAutoSkipBroadcast.bind(hgc);
    const sendSpy = vi.spyOn(hgc, 'sendAction');
    const actionsSpy = vi.spyOn(hgc, 'getAvailableActions');

    // 窗口1:广播无懈,P0 有闪(无无懈)→ 维度1 act-delayed(设 setTimeout)
    const p1 = makeBroadcastPending();
    (hgc as unknown as { _view: GameView | null })._view = makeViewWithHand(p1, 0, [
      { id: 'f1', name: '闪', suit: '♥', color: '红', rank: '5', type: '基本牌' },
    ]);
    actionsSpy.mockReturnValueOnce([{ category: 'skip' }] as never);
    maybe();
    expect(sendSpy).not.toHaveBeenCalled(); // 延迟中

    // 窗口2:deadline 不同的新窗口,能响应 → wait(不应被跳过)
    const p2 = makeBroadcastPending();
    p2.deadline = (p1.deadline ?? 0) + 5000;
    (hgc as unknown as { _view: GameView | null })._view = makeViewWithHand(p2, 0, [
      { id: 'w1', name: '无懈可击', suit: '♠', color: '黑', rank: 'J', type: '锦囊牌' },
    ]);
    actionsSpy.mockReturnValueOnce([{ category: 'respond' }] as never);
    maybe(); // 能响应 → wait

    // 推进定时器:窗口1 的延迟 skip 到期
    vi.advanceTimersByTime(2000);

    // 旧 skip 不应作用于窗口2(玩家有无懈,应手动决策)
    expect(sendSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
