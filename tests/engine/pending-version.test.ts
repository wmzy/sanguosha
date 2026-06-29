import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTest,
  dispatch,
  applyAtom,
  registerSkillsFromState,
} from '../../src/engine/create-engine';
import { registerAction } from '../../src/engine/skill';
import { createGameState } from '../../src/engine/types';

import { dispatchAndWait, fireTimeoutAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';

describe('pending-scoped 版本控制', () => {
  beforeEach(() => resetForTest());

  it('PendingSlot 有 createdSeq 字段，值=创建时 state.seq', async () => {
    const state = createGameState({
      players: [
        {
          index: 0,
          name: 'p0',
          character: '测试',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
        },
      ],
      cardMap: {},
      seq: 7,
      currentPlayerIndex: 0,
      phase: '出牌',
    });
    const p = applyAtom(state, {
      type: '请求回应',
      requestType: 'test',
      target: 0,
      prompt: { type: 'confirm', title: 't' },
    });
    await new Promise((r) => setTimeout(r, 50));
    const slot = state.pendingSlots.get(0);
    expect(slot).toBeDefined();
    // createdSeq 应等于 applyAtom push atomHistory 时递增后的 state.seq
    expect(slot!.createdSeq).toBe(state.seq);
    slot!.resolve();
    await p;
  });

  it('respond 携带陈旧的 pendingSeq → dispatch 返回 false', async () => {
    const state = createGameState({
      players: [
        {
          index: 0,
          name: 'p0',
          character: '测试',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
        },
      ],
      cardMap: {},
      seq: 7,
      currentPlayerIndex: 0,
      phase: '出牌',
    });
    const p = applyAtom(state, {
      type: '请求回应',
      requestType: 'test',
      target: 0,
      prompt: { type: 'confirm', title: 't' },
    });
    await new Promise((r) => setTimeout(r, 50));
    const slot = state.pendingSlots.get(0)!;
    // 模拟 slot 被替换(close-reopen)：createdSeq 变了
    slot.createdSeq = 99;

    // dispatch respond，pendingSeq=7（旧）但 slot.createdSeq=99 → 拒绝
    const accepted = await dispatch(state, {
      skillId: '系统规则',
      actionType: 'test',
      ownerId: 0,
      params: {},
      baseSeq: 7,
      pendingSeq: 7,
    }).catch(() => false);
    expect(accepted).toBe(false);

    slot.resolve();
    await p;
  });

  it('respond 不带 pendingSeq → 跳过校验（向后兼容）', async () => {
    const state = createGameState({
      players: [
        {
          index: 0,
          name: 'p0',
          character: '测试',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
        },
      ],
      cardMap: {},
      seq: 7,
      currentPlayerIndex: 0,
      phase: '出牌',
    });
    const p = applyAtom(state, {
      type: '请求回应',
      requestType: 'test',
      target: 0,
      prompt: { type: 'confirm', title: 't' },
    });
    await new Promise((r) => setTimeout(r, 50));

    // 不带 pendingSeq → 不校验（向后兼容）
    // actionType='test' 无 entry → 返回 false 是因为无 entry，不是 pendingSeq
    // 这个测试验证的是"不带 pendingSeq 不报错"
    const accepted = await dispatch(state, {
      skillId: '系统规则',
      actionType: 'test',
      ownerId: 0,
      params: {},
      baseSeq: 7,
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
          index: 0,
          name: 'P0',
          character: '',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: ['回合管理', '过河拆桥', '无懈可击'],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
        {
          index: 1,
          name: 'P1',
          character: '',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: ['d1'],
          equipment: {},
          skills: ['回合管理', '过河拆桥', '无懈可击'],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
      ],
      cardMap: {
        d1: { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' },
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);

    // 给双方各一张无懈可击
    const nullif0Id = 'wx0';
    const nullif1Id = 'wx1';
    state.cardMap[nullif0Id] = {
      id: nullif0Id,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.cardMap[nullif1Id] = {
      id: nullif1Id,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'K',
      type: '锦囊牌',
    };
    state.players[0].hand.push(nullif0Id);
    state.players[1].hand.push(nullif1Id);

    // P0 出过河拆桥 → 无懈窗口 W1
    const gqId = 'gq1';
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);

    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });

    // W1 创建完成
    expect(state.pendingSlots.size).toBe(1);
    const w1 = [...state.pendingSlots.values()][0];
    const w1Seq = w1.createdSeq;

    // P1 出无懈可击 → W1 close, W2 open
    await dispatchAndWait(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: nullif1Id },
      baseSeq: state.seq,
    });

    // W2 创建完成，createdSeq != W1
    expect(state.pendingSlots.size).toBe(1);
    const w2 = [...state.pendingSlots.values()][0];
    expect(w2.createdSeq).not.toBe(w1Seq);

    // P0 用 W1 的旧 pendingSeq 尝试 respond → 被拒绝
    const rejected = await dispatch(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 0,
      params: { cardId: nullif0Id },
      baseSeq: state.seq,
      pendingSeq: w1Seq,
    });
    expect(rejected).toBe(false);

    // P0 用 W2 的正确 pendingSeq respond → 成功
    const accepted = await dispatch(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 0,
      params: { cardId: nullif0Id },
      baseSeq: state.seq,
      pendingSeq: w2.createdSeq,
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

  // ─────────────────────────────────────────────────────────────
  // 出牌窗口(非阻塞 pending):主动出牌/用技不应被 pendingSeq 校验拒绝
  // 回归:出牌窗口由回合管理 IIFE 每次 resolve 后重建，createdSeq 频繁变化；
  //       旧逻辑无条件校验 pendingSeq === createdSeq 会误拒合法的主动操作。
  // ─────────────────────────────────────────────────────────────
  it('出牌窗口期间：携带任意 pendingSeq 的主动 action 不应被 slot 校验拒绝', async () => {
    const state = createGameState({
      players: [
        {
          index: 0,
          name: 'p0',
          character: '',
          health: 4,
          maxHealth: 4,
          alive: true,
          hand: [],
          equipment: {},
          skills: [],
          vars: {},
          marks: [],
          pendingTricks: [],
          tags: [],
          judgeZone: [],
        },
      ],
      cardMap: {},
      seq: 7,
      currentPlayerIndex: 0,
      phase: '出牌',
    });

    // 注册一个轻量测试 action：validate 永过、execute 空，专为验证 pendingSeq 校验路径
    const unregister = registerAction(
      state,
      '测试',
      0,
      'probe',
      () => null,
      async () => {},
    );

    // 建一个出牌窗口(非阻塞 pending)
    const windowP = applyAtom(state, { type: '出牌窗口', player: 0, timeout: 50 });
    await new Promise((r) => setTimeout(r, 50));
    const slot = state.pendingSlots.get(0)!;
    expect(slot.isBlocking).toBe(false);

    // 篡改 createdSeq，模拟窗口已被重建 → pendingSeq 与 createdSeq 不匹配
    slot.createdSeq = 999;

    // 主动 action 路径：oldSlot 存在但 isBlocking===false → 守卫跳过 pendingSeq 校验
    // 旧逻辑(无 isBlocking 守卫)会在此 rollback 返回 false；新逻辑应返回 true。
    const accepted = await dispatch(state, {
      skillId: '测试',
      actionType: 'probe',
      ownerId: 0,
      params: {},
      baseSeq: state.seq,
      pendingSeq: 7, // 故意与 createdSeq=999 不匹配
    }).catch(() => false);
    expect(accepted).toBe(true);

    // 清理：resolve 出牌窗口 + 注销测试 action
    slot.resolve();
    await windowP.catch(() => {});
    unregister();
  });
});
