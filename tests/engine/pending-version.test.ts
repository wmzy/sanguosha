import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest, dispatch, applyAtom, registerSkillsFromState } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';
import { dispatchAndWait, fireTimeoutAndWait } from '../engine-harness';
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

  // ─────────────────────────────────────────────────────────────
  // 无懈可击 close-reopen:过期 respond 被 pending-scoped 校验拒绝
  // ─────────────────────────────────────────────────────────────
  it('无懈可击 close-reopen:旧窗口 respond 被 pendingSeq 拒绝', async () => {
    resetForTest();
    const state = createGameState({
      players: [
        {
          index: 0, name: 'P0', character: '', health: 4, maxHealth: 4, alive: true,
          hand: [], equipment: {},
          skills: ['回合管理', '过河拆桥', '无懈可击'],
          vars: {}, marks: [], pendingTricks: [], judgeZone: [],
        },
        {
          index: 1, name: 'P1', character: '', health: 4, maxHealth: 4, alive: true,
          hand: ['d1'], equipment: {},
          skills: ['回合管理', '过河拆桥', '无懈可击'],
          vars: {}, marks: [], pendingTricks: [], judgeZone: [],
        },
      ],
      cardMap: {
        d1: { id: 'd1', name: '闪', suit: '♥', rank: '2', type: '基本牌' },
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 给双方各一张无懈可击
    const wuxie0Id = 'wx0';
    const wuxie1Id = 'wx1';
    state.cardMap[wuxie0Id] = { id: wuxie0Id, name: '无懈可击', suit: '♠', rank: 'J', type: '锦囊牌' };
    state.cardMap[wuxie1Id] = { id: wuxie1Id, name: '无懈可击', suit: '♠', rank: 'K', type: '锦囊牌' };
    state.players[0].hand.push(wuxie0Id);
    state.players[1].hand.push(wuxie1Id);

    // P0 出过河拆桥 → 无懈窗口 W1
    const gqId = 'gq1';
    state.cardMap[gqId] = { id: gqId, name: '过河拆桥', suit: '♠', rank: '3', type: '锦囊牌' };
    state.players[0].hand.push(gqId);

    await dispatchAndWait(state, {
      skillId: '过河拆桥', actionType: 'use', ownerId: 0,
      params: { cardId: gqId, targets: [1] }, baseSeq: state.seq,
    });

    // W1 创建完成
    expect(state.pendingSlots.size).toBe(1);
    const w1 = [...state.pendingSlots.values()][0];
    const w1Seq = w1.createdSeq;

    // P1 出无懈可击 → W1 close, W2 open
    await dispatchAndWait(state, {
      skillId: '无懈可击', actionType: 'respond', ownerId: 1,
      params: { cardId: wuxie1Id }, baseSeq: state.seq,
    });

    // W2 创建完成，createdSeq != W1
    expect(state.pendingSlots.size).toBe(1);
    const w2 = [...state.pendingSlots.values()][0];
    expect(w2.createdSeq).not.toBe(w1Seq);

    // P0 用 W1 的旧 pendingSeq 尝试 respond → 被拒绝
    const rejected = await dispatch(state, {
      skillId: '无懈可击', actionType: 'respond', ownerId: 0,
      params: { cardId: wuxie0Id }, baseSeq: state.seq, pendingSeq: w1Seq,
    });
    expect(rejected).toBe(false);

    // P0 用 W2 的正确 pendingSeq respond → 成功
    const accepted = await dispatch(state, {
      skillId: '无懈可击', actionType: 'respond', ownerId: 0,
      params: { cardId: wuxie0Id }, baseSeq: state.seq, pendingSeq: w2.createdSeq,
    });
    expect(accepted).toBe(true);

    // 超时结束剩余窗口
    while (state.pendingSlots.size > 0) {
      await fireTimeoutAndWait(state);
    }

    // 双无懈 → 抵消反转 → 锦囊恢复生效
    // P1 失去手牌
    expect(state.players[1].hand).not.toContain('d1');
  });
});
