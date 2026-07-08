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
      prompt: { type: 'useCard', title: '是否打出无懈可击?' },
      timeout: 10,
    },
    prompt: { type: 'useCard', title: '是否打出无懈可击?' },
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
      prompt: { type: 'useCard', title: '是否打出闪?' },
    },
    prompt: { type: 'useCard', title: '是否打出闪?' },
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
        atom: { type: '询问杀', target: 1 },
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
        atom: { type: '请求回应', requestType: '突袭/trigger', target: 0 },
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
        atom: { type: '询问杀', target: 1 },
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
