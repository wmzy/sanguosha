import { describe, expect, it, vi } from 'vitest';
import { dispatch, registerSkillsFromState, whenEngineIdle } from '../../src/engine/index';
import { applyAtom } from '../../src/engine/core/apply';
import { registerAction, registerAfterHook } from '../../src/engine/core/skill';
import { runDetached } from '../../src/engine/core/run-tracker';
import { VirtualClock } from '../../src/engine/core/clock';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function player(index: number, hand: string[], skills: string[] = []): PlayerState {
  return { index, name: `P${index}`, character: '', health: 4, maxHealth: 4, alive: true,
    hand, equipment: {}, skills, vars: {}, marks: [], pendingTricks: [], tags: [] };
}
function card(id: string, name = '闪'): Card {
  return { id, name, suit: '♥', color: '红', rank: 'A', type: '基本牌' };
}
function makeState(): GameState {
  return createGameState({ players: [player(0, ['cost'], ['制衡']), player(1, [])],
    cardMap: { cost: card('cost'), drawn: card('drawn', '桃') }, phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} }, zones: { deck: ['drawn'], discardPile: [], processing: [] },
    clock: new VirtualClock() });
}

describe('consumer composition and execution lifecycle', () => {
  it('rejects real noncomposable 制衡 before effects, hooks, RNG, events or pending consumption', async () => {
    const state = makeState();
    await registerSkillsFromState(state);
    const before = structuredClone({ players: state.players, zones: state.zones, cardMap: state.cardMap,
      turn: state.turn, rngSeed: state.rngSeed, seq: state.seq, log: state.actionLog, history: state.atomHistory });
    const changed = vi.fn();
    state.onStateChange = changed;
    const result = await dispatch(state, { skillId: '不存在', actionType: 'use', ownerId: 0,
      params: {}, baseSeq: state.seq,
      preceding: [{ skillId: '制衡', actionType: 'use', params: { cardIds: ['cost'] } }] });
    expect(result.accepted).toBe(false);
    expect(await result.settle).toBeUndefined();
    expect({ players: state.players, zones: state.zones, cardMap: state.cardMap,
      turn: state.turn, rngSeed: state.rngSeed, seq: state.seq, log: state.actionLog, history: state.atomHistory }).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
    expect(state.pendingSlots.size).toBe(0);
  });

  it('settles nonwaiting actions without any polling timer', async () => {
    const state = makeState();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    try {
      registerAction(state, '立即完成', 0, 'use', () => null, async (s) => {
        await applyAtom(s, { type: '摸牌', player: 0, count: 1 });
      });
      const result = await dispatch(state, { skillId: '立即完成', actionType: 'use', ownerId: 0, params: {}, baseSeq: 0 });
      expect(await result.settle).toBeUndefined();
      expect(state.players[0].hand).toEqual(['cost', 'drawn']);
      expect(timers).not.toHaveBeenCalled();
      expect(state.atomStack).toEqual([]);
    } finally { timers.mockRestore(); }
  });

  it('response settle includes resumed ancestor after an actual asynchronous boundary', async () => {
    const state = makeState();
    let release!: () => void;
    const imported = new Promise<void>((resolve) => { release = resolve; });
    registerAction(state, '父流程', 0, 'use', () => null, async (s) => {
      await applyAtom(s, { type: '请求回应', target: 1, requestType: 'first', prompt: { type: 'confirm', title: 'first' } });
      await imported;
      await applyAtom(s, { type: '请求回应', target: 1, requestType: 'second', prompt: { type: 'confirm', title: 'second' } });
    });
    registerAction(state, '回应', 1, 'respond', () => null, async () => {});
    const started = await dispatch(state, { skillId: '父流程', actionType: 'use', ownerId: 0, params: {}, baseSeq: 0 });
    await started.settle;
    const response = await dispatch(state, { skillId: '回应', actionType: 'respond', ownerId: 1, params: {}, baseSeq: state.seq });
    let settled = false;
    void response.settle.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect(await response.settle).toBeUndefined();
    expect((state.pendingSlots.get(1)?.atom as { requestType: string }).requestType).toBe('second');
    await state.pendingSlots.get(1)!._fireTimeoutNow?.();
    // 超时 resolve 后父 run 继续推进到完成:等稳定点(不再依赖宏任务轮询)。
    await whenEngineIdle(state);
    expect(state.atomStack).toEqual([]);
  });

  it('execute exceptions are observable and remove owned atom stack entries', async () => {
    const state = makeState();
    const error = new Error('hook failed');
    const errors = vi.fn();
    state.onError = errors;
    registerAfterHook(state, 'broken', 0, '摸牌', async () => { throw error; });
    registerAction(state, '失败', 0, 'use', () => null, async (s) => {
      await applyAtom(s, { type: '摸牌', player: 0, count: 1 });
    });
    const result = await dispatch(state, { skillId: '失败', actionType: 'use', ownerId: 0, params: {}, baseSeq: 0 });
    expect(result.accepted).toBe(true);
    expect(await result.settle).toBe(error);
    expect(errors).toHaveBeenCalledWith(error);
    expect(state.atomStack).toEqual([]);
  });

  it('detached async chains own their run accounting so settle does not report a false stable point', async () => {
    const state = makeState();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    // 脱离父链的 fire-and-forget 循环(回合管理的出牌窗口循环同型)。
    runDetached(state, async (s) => {
      await applyAtom(s, { type: '出牌窗口', player: 0, timeout: 10 });
      await held;
    });
    registerAction(state, '完成', 1, 'use', () => null, async () => {});
    // 让 detached 链挂到 slot 上;它自己必须仍占着一个 run,而不是借用别人的 credit。
    await whenEngineIdle(state);
    await applyAtom(state, { type: '摸牌', player: 0, count: 1 });
    const result = await dispatch(state, { skillId: '完成', actionType: 'use', ownerId: 1, params: {}, baseSeq: state.seq });
    let settled = false;
    void result.settle.then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    // detached 循环仍 active(等 held)→ 稳定点不能到。
    expect(settled).toBe(false);
    release();
    expect(await result.settle).toBeUndefined();
    await whenEngineIdle(state);
    // detached 链此刻仍挂在 出牌窗口 上(它自己的 run,与本 dispatch 的 settle 无关)。
    expect(state.atomStack.map((atom) => atom.type)).toEqual(['出牌窗口']);
    await state.pendingSlots.get(0)!._fireTimeoutNow?.();
    await whenEngineIdle(state);
    expect(state.atomStack).toEqual([]);
  });
});
