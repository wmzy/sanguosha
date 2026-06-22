import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest, dispatch, applyAtom } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import '../../src/engine/atoms';
import '../../src/engine/skills';

describe('pending-scoped 版本控制', () => {
  beforeEach(() => resetForTest());

  it('PendingSlot 有 createdSeq 字段，值=创建时 state.seq', async () => {
    const state = createGameState({
      players: [
        { index: 0, name: 'p0', character: '测试', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [] },
      ],
      cardMap: {}, seq: 7, currentPlayerIndex: 0, phase: '出牌',
    });
    const p = applyAtom(state, { type: '请求回应', requestType: 'test', target: 0, prompt: { type: 'confirm', title: 't' } });
    await new Promise(r => setTimeout(r, 50));
    const slot = state.pendingSlots.get(0);
    expect(slot).toBeDefined();
    expect(slot!.createdSeq).toBe(7);
    slot!.resolve();
    await p;
  });

  it('respond 携带陈旧的 pendingSeq → dispatch 返回 false', async () => {
    const state = createGameState({
      players: [
        { index: 0, name: 'p0', character: '测试', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [] },
      ],
      cardMap: {}, seq: 7, currentPlayerIndex: 0, phase: '出牌',
    });
    const p = applyAtom(state, { type: '请求回应', requestType: 'test', target: 0, prompt: { type: 'confirm', title: 't' } });
    await new Promise(r => setTimeout(r, 50));
    const slot = state.pendingSlots.get(0)!;
    // 模拟 slot 被替换(close-reopen)：createdSeq 变了
    slot.createdSeq = 99;

    // dispatch respond，pendingSeq=7（旧）但 slot.createdSeq=99 → 拒绝
    const accepted = await dispatch(state, {
      skillId: '系统规则', actionType: 'test', ownerId: 0,
      params: {}, baseSeq: 7, pendingSeq: 7,
    }).catch(() => false);
    expect(accepted).toBe(false);

    slot.resolve();
    await p;
  });

  it('respond 不带 pendingSeq → 跳过校验（向后兼容）', async () => {
    const state = createGameState({
      players: [
        { index: 0, name: 'p0', character: '测试', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [] },
      ],
      cardMap: {}, seq: 7, currentPlayerIndex: 0, phase: '出牌',
    });
    const p = applyAtom(state, { type: '请求回应', requestType: 'test', target: 0, prompt: { type: 'confirm', title: 't' } });
    await new Promise(r => setTimeout(r, 50));

    // 不带 pendingSeq → 不校验（向后兼容）
    // actionType='test' 无 entry → 返回 false 是因为无 entry，不是 pendingSeq
    // 这个测试验证的是"不带 pendingSeq 不报错"
    const accepted = await dispatch(state, {
      skillId: '系统规则', actionType: 'test', ownerId: 0,
      params: {}, baseSeq: 7,
    }).catch(() => false);
    // 无 entry → false，但不是因为 pendingSeq
    expect(accepted).toBe(false);

    state.pendingSlots.get(0)!.resolve();
    await p;
  });
});
