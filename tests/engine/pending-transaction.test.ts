import { describe, expect, it, vi } from 'vitest';
import { dispatch, fireTimeout, registerSkillsFromState } from '../../src/engine/index';
import { VirtualClock } from '../../src/engine/core/clock';
import { applyAtom } from '../../src/engine/core/apply';
import { registerAction } from '../../src/engine/core/skill';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState, PendingSlot, PlayerState } from '../../src/engine/types';
import '../../src/engine/atoms';

function player(index: number, hand: string[]): PlayerState {
  return {
    index,
    name: `P${index}`,
    character: '',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand,
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function card(id: string, name: string): Card {
  return { id, name, suit: '♥', color: '红', rank: 'A', type: '基本牌' };
}

function state(players: PlayerState[], cardMap: Record<string, Card>): GameState {
  return createGameState({
    players,
    cardMap,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

function fakeSlot(target: number, createdSeq: number): PendingSlot {
  let claimed = false;
  let resolved = false;
  let paused = false;
  return {
    atom: { type: '请求回应', requestType: 'test', target, prompt: { type: 'confirm', title: 'test' } },
    definition: {} as PendingSlot['definition'],
    startTime: 0,
    deadline: 999,
    resolvedTimeoutMs: 999,
    isBlocking: true,
    createdSeq,
    resolve: () => {
      resolved = true;
    },
    get isTimeout() {
      return false;
    },
    get isPaused() {
      return paused;
    },
    pause: () => {
      paused = true;
    },
    claim: () => {
      if (claimed || resolved || paused) return false;
      claimed = true;
      return true;
    },
    releaseClaim: () => {
      if (!resolved && !paused) claimed = false;
    },
    get isClaimed() {
      return claimed;
    },
    _fireTimeoutNow: undefined,
    get _testResolved() {
      return resolved;
    },
  } as PendingSlot;
}

describe('dispatch preceding transaction and pending ownership', () => {
  it('真实无懈窗口并发只消耗一张牌,新反无懈窗口仍可继续', async () => {
    const s = state([player(0, ['trick', 'wx0']), player(1, ['wx1', 'hidden'])], {
      trick: { ...card('trick', '过河拆桥'), type: '锦囊牌' },
      wx0: { ...card('wx0', '无懈可击'), type: '锦囊牌' },
      wx1: { ...card('wx1', '无懈可击'), type: '锦囊牌' },
      hidden: card('hidden', '桃'),
    });
    s.clock = new VirtualClock();
    for (const p of s.players) p.skills = ['使用牌', '打出牌'];
    await registerSkillsFromState(s);
    const played = await dispatch(s, {
      skillId: '过河拆桥', actionType: 'use', ownerId: 0,
      params: { cardId: 'trick', targets: [1] }, baseSeq: s.seq,
    });
    expect(played.accepted).toBe(true);
    await played.settle;
    const firstWindow = s.pendingSlots.get(-2)!;
    const responses = await Promise.all([0, 1].map((ownerId) => dispatch(s, {
      skillId: '无懈可击', actionType: 'respond', ownerId,
      params: { cardId: `wx${ownerId}` }, baseSeq: s.seq, pendingSeq: firstWindow.createdSeq,
    })));
    expect(responses.map((result) => result.accepted)).toEqual([true, false]);
    await responses[0].settle;
    expect(s.players[1].hand).toEqual(['wx1', 'hidden']);
    expect(s.settlementStack.map((frame) => frame.cards)).toEqual([['trick'], ['wx0']]);
    const secondWindow = s.pendingSlots.get(-2)!;
    expect(secondWindow).not.toBe(firstWindow);
    const counter = await dispatch(s, {
      skillId: '无懈可击', actionType: 'respond', ownerId: 1,
      params: { cardId: 'wx1' }, baseSeq: s.seq, pendingSeq: secondWindow.createdSeq,
    });
    expect(counter.accepted).toBe(true);
    await counter.settle;
    expect(s.settlementStack.map((frame) => frame.cards)).toEqual([['trick'], ['wx0'], ['wx1']]);
    for (let i = 0; i < 8 && s.settlementStack.length; i++) {
      await fireTimeout(s);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    await vi.waitFor(() => expect(s.settlementStack).toEqual([]));
    expect(s.players[1].hand).toEqual([]);
    expect(new Set(s.zones.discardPile)).toEqual(new Set(['trick', 'wx0', 'wx1', 'hidden']));
  });

  it('前置执行部分完成后抛错也调用回滚,恢复数组顺序与缓冲', async () => {
    const s = state([player(0, ['a', 'b'])], { a: card('a', '杀'), b: card('b', '桃') });
    registerAction(s, '异常转化', 0, 'transform', () => null, async (st) => {
      await applyAtom(st, { type: '当作', player: 0, cardIds: ['a'], shadowId: 'shadow', outputName: '决斗' });
      throw new Error('partial transform');
    }, (st) => { delete st.cardMap.shadow; });
    const before = s.seq;
    const result = await dispatch(s, {
      skillId: 'missing', actionType: 'use', ownerId: 0, params: {}, baseSeq: before,
      preceding: [{ skillId: '异常转化', actionType: 'transform', params: {} }],
    });
    expect(result.accepted).toBe(false);
    expect(s.players[0].hand).toEqual(['a', 'b']);
    expect(s.cardMap.shadow).toBeUndefined();
    expect(s.seq).toBe(before);
    expect(s.viewBuffering).toBe(false);
    expect(s.atomStack).toEqual([]);
  });

  it('main validate throws after preceding: rolls back state/history and resumes broadcasting', async () => {
    const original = card('c1', '闪');
    const s = state([player(0, ['c1']), player(1, [])], { c1: original });
    const beforeHistory = s.atomHistory.length;
    let broadcasts = 0;
    s.onStateChange = () => {
      broadcasts += 1;
    };
    registerAction(
      s,
      '前置转化',
      0,
      'transform',
      () => null,
      async (st) => {
        await applyAtom(st, {
          type: '当作',
          player: 0,
          cardIds: ['c1'],
          shadowId: 'c1#前置转化',
          outputName: '决斗',
        });
      },
      (st) => {
        delete st.cardMap['c1#前置转化'];
        const idx = st.players[0].hand.indexOf('c1#前置转化');
        if (idx >= 0) st.players[0].hand[idx] = 'c1';
      },
    );
    registerAction(s, '主动作', 0, 'use', () => {
      throw new Error('主 validate failure');
    }, async () => {});

    const result = await dispatch(s, {
      skillId: '主动作',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: 'c1#前置转化' },
      preceding: [{ skillId: '前置转化', actionType: 'transform', params: { cardId: 'c1' } }],
      baseSeq: s.seq,
    });

    expect(result.accepted).toBe(false);
    expect(s.viewBuffering).toBe(false);
    expect(s.players[0].hand).toEqual(['c1']);
    expect(s.cardMap['c1#前置转化']).toBeUndefined();
    expect(s.atomHistory.length).toBe(beforeHistory);

    s.cardMap.drawn = card('drawn', '桃');
    s.zones.deck = ['drawn'];
    await applyAtom(s, { type: '摸牌', player: 0, count: 1 });
    expect(s.players[0].hand).toEqual(['c1', 'drawn']);
    expect(broadcasts).toBeGreaterThan(0);
  });

  it('preceding failure only releases slots created by this dispatch', async () => {
    const s = state([player(0, []), player(1, [])], {});
    const oldWait = applyAtom(s, {
      type: '请求回应',
      requestType: 'old-window',
      target: 1,
      prompt: { type: 'confirm', title: 'old' },
      timeout: 30,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const oldSlot = s.pendingSlots.get(1);
    expect(oldSlot).toBeDefined();

    registerAction(
      s,
      '会创建等待',
      0,
      'preceding',
      () => null,
      async (st) => {
        st.pendingSlots.set(0, fakeSlot(0, st.seq));
      },
    );
    registerAction(s, '抛错主动作', 0, 'use', () => {
      throw new Error('bad params');
    }, async () => {});

    const result = await dispatch(s, {
      skillId: '抛错主动作',
      actionType: 'use',
      ownerId: 0,
      params: {},
      preceding: [{ skillId: '会创建等待', actionType: 'preceding', params: {} }],
      baseSeq: s.seq,
    });

    expect(result.accepted).toBe(false);
    expect(s.pendingSlots.get(1)).toBe(oldSlot);
    expect(s.pendingSlots.has(0)).toBe(false);
    oldSlot!.resolve();
    await oldWait;
  });

  it('same broadcast window is claimed by exactly one concurrent response', async () => {
    const c0 = card('wx0', '无懈可击');
    const c1 = card('wx1', '无懈可击');
    const s = state([player(0, ['wx0']), player(1, ['wx1'])], { wx0: c0, wx1: c1 });
    const slot = fakeSlot(-2, s.seq);
    s.pendingSlots.set(-2, slot);
    registerAction(
      s,
      '广播回应',
      0,
      'respond',
      () => null,
      async (st, params) => {
        const cardId = params.cardId as string;
        const p = st.players[params.ownerId as number];
        if (p) p.hand = p.hand.filter((id) => id !== cardId);
      },
    );
    // ActionEntry.execute receives only state/params; encode owner in params to keep this test action tiny.
    registerAction(
      s,
      '广播回应',
      1,
      'respond',
      () => null,
      async (st, params) => {
        const cardId = params.cardId as string;
        const p = st.players[params.ownerId as number];
        if (p) p.hand = p.hand.filter((id) => id !== cardId);
      },
    );

    const [r0, r1] = await Promise.all([
      dispatch(s, {
        skillId: '广播回应',
        actionType: 'respond',
        ownerId: 0,
        params: { cardId: 'wx0', ownerId: 0 },
        pendingSeq: slot.createdSeq,
        baseSeq: s.seq,
      }),
      dispatch(s, {
        skillId: '广播回应',
        actionType: 'respond',
        ownerId: 1,
        params: { cardId: 'wx1', ownerId: 1 },
        pendingSeq: slot.createdSeq,
        baseSeq: s.seq,
      }),
    ]);

    expect([r0.accepted, r1.accepted].filter(Boolean)).toHaveLength(1);
    expect([s.players[0].hand.length, s.players[1].hand.length]).toContain(1);
    expect(s.pendingSlots.size).toBe(0);
  });
});
