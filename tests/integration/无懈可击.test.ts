// tests/integration/无懈可击.test.ts
// 集成测试:无懈可击链路(锦囊生效前的全局抵消机制)
//
// 覆盖:
//   1. 锦囊用过河拆桥 → 产生无懈可击询问 pending (target=-2 广播)
//   2. fireTimeout → 无人打无懈 → 锦囊正常结算(目标失去手牌)
//   3. 抵消场景:P1 持有无懈可击 → respond 打无懈 → 锦囊被抵消(目标牌未被弃)
//   4. 双无懈场景:P0 出无懈抵消锦囊 → P1 再出无懈抵消无懈 → 锦囊恢复生效
//   5. 处理区:锦囊在无懈窗口期间位于 processing,生效后移入 discardPile
//
// 模式:createGameState + registerSkillsFromState → dispatch 走真实 action 路径
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSkillsFromState,
  frameCards,
  dispatch as engineDispatch,
  applyAtom,
} from '../../src/engine/create-engine';
import { fireTimeoutAndWait, dispatchAndWait, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

/** 返回第一个 pending slot 的 atom 概要 */
function firstPendingAtom(state: GameState): {
  type?: string;
  requestType?: string;
  target?: number;
} {
  if (state.pendingSlots.size === 0) return {};
  return [...state.pendingSlots.values()][0].atom;
}

describe('无懈可击链路', () => {
  let state: GameState;

  beforeEach(async () => {
    state = createGameState({
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
          // 给 P1 一张基础牌(用于 过河拆桥)
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
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:出锦囊 → 产生无懈可击询问 pending
  // ─────────────────────────────────────────────────────────────
  it('用例1:出过河拆桥 → 产生无懈可击询问 pending', async () => {
    const _lord = state.players[0];
    // 给 P0 一张过河拆桥
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);

    // 锦囊在 P0 → P1
    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });

    // 应有无懈可击 pending (请求回应 requestType='无懈可击')
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const atom = firstPendingAtom(state) as { type?: string; requestType?: string };
    expect(atom.type).toBe('请求回应');
    expect(atom.requestType).toBe('无懈可击');
    // 锦囊在处理区
    expect(frameCards(state)).toContain(gqId);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:fireTimeout → 锦囊正常结算
  // ─────────────────────────────────────────────────────────────
  it('用例2:fireTimeout → 无人打无懈 → 锦囊正常结算(目标手牌入弃牌堆)', async () => {
    const _lord = state.players[0];
    // 给 P0 一张过河拆桥
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);

    // 记录 P1 弃牌前手牌
    const p1HandBefore = state.players[1].hand.slice();
    const p1FirstCard = p1HandBefore[0];
    expect(p1HandBefore.length).toBeGreaterThan(0); // 确认 P1 有手牌

    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    // fireTimeout:消耗无懈窗口
    await fireTimeoutAndWait(state);

    // 盲选窗口也超时(defaultChoice=0 兜底)
    await fireTimeoutAndWait(state);

    // 锦囊正常结算:
    //   1. P1 失去第一张手牌
    //   2. 锦囊本身也进弃牌堆
    //   3. localVars['无懈/被抵消'] = undefined/false
    expect(state.localVars['无懈/被抵消']).toBeFalsy();
    expect(state.players[1].hand).not.toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(p1FirstCard);
    // 锦囊进弃牌堆
    expect(state.zones.discardPile).toContain(gqId);
    expect(frameCards(state)).not.toContain(gqId);
    // pending 已消费
    expect(state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:抵消场景:P1 持有无懈可击 → respond 打无懈 → 锦囊被抵消
  // ─────────────────────────────────────────────────────────────
  // close-reopen:旧 slot resolve,询问无懈可击 循环创建新窗口(新 createdSeq)
  it('用例3:P1 出无懈可击 → 锦囊被抵消(目标牌未被弃)', async () => {
    // 给 P0 一张过河拆桥
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);
    // 给 P1 一张无懈可击
    const nullifId = `nullif-${state.players[1].hand.length}`;
    state.cardMap[nullifId] = {
      id: nullifId,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.players[1].hand.push(nullifId);

    const p1HandBefore = state.players[1].hand.slice();

    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const atom = firstPendingAtom(state) as { type?: string; requestType?: string };
    expect(atom.requestType).toBe('无懈可击');

    // P1 回应无懈可击
    await dispatchAndWait(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: nullifId },
      baseSeq: state.seq,
    });

    // 此时应被消耗:无懈 respond execute 内部又会触发反无懈询问
    // (dispatch respond 路径) —— 没有反无懈,直接消耗
    // 反复 fireTimeout 直到没有 pending
    let loops = 0;
    while (state.pendingSlots.size > 0 && loops < 10) {
      await fireTimeoutAndWait(state);
      loops += 1;
    }

    // 验证:锦囊被抵消 → P1 手牌不变(无懈可击本身已出,其他牌未丢)
    // P1 失去的应只有 无懈可击 这张牌
    expect(state.localVars['抵消/已回应']).toBeUndefined();
    // P1 手牌减少 1(无懈可击)
    expect(state.players[1].hand.length).toBe(p1HandBefore.length - 1);
    // P1 第一张手牌还在(没被弃)
    const p1FirstCard = p1HandBefore.find((id) => id !== nullifId);
    if (p1FirstCard) {
      expect(state.players[1].hand).toContain(p1FirstCard);
    }
    // 锦囊也进弃牌堆(因为锦囊本身还是要从处理区移走)
    expect(state.zones.discardPile).toContain(gqId);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:双无懈:出无懈抵消 → 再出无懈抵消无懈 → 锦囊恢复生效
  // ─────────────────────────────────────────────────────────────
  it('用例4:双无懈抵消 → 锦囊恢复生效(目标失去手牌)', async () => {
    // 给 P0 一张过河拆桥
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);
    // 给 P1 一张无懈可击
    const nullif1Id = `nullif-1-${state.players[1].hand.length}`;
    state.cardMap[nullif1Id] = {
      id: nullif1Id,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.players[1].hand.push(nullif1Id);
    // 给 P0 一张无懈可击(反无懈)
    const nullif0Id = `nullif-0-${state.players[0].hand.length}`;
    state.cardMap[nullif0Id] = {
      id: nullif0Id,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.players[0].hand.push(nullif0Id);

    const p1HandBefore = state.players[1].hand.slice();
    const p1FirstCard = p1HandBefore[0];
    expect(p1HandBefore.length).toBeGreaterThan(0);

    // P0 出过河拆桥
    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });
    // 等待无懈窗口
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    // P1 出无懈抵消锦囊
    await dispatchAndWait(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: nullif1Id },
      baseSeq: state.seq,
    });

    // close-reopen:旧 slot resolve,询问无懈可击 循环创建新窗口
    // 此时:无懈respond执行完 → 翻转被抵消=true → 询问反无懈
    // 应是请求回应 requestType='无懈可击'
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const atom = firstPendingAtom(state) as { type?: string; requestType?: string };
    expect(atom.type).toBe('请求回应');
    expect(atom.requestType).toBe('无懈可击');

    // P0 出无懈反抵消
    await dispatchAndWait(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 0,
      params: { cardId: nullif0Id },
      baseSeq: state.seq,
    });

    // 反复 fireTimeout 直到没有 pending
    let loops = 0;
    while (state.pendingSlots.size > 0 && loops < 10) {
      await fireTimeoutAndWait(state);
      loops += 1;
    }

    // 双无懈 = 抵消反转 → 锦囊恢复生效
    // (localVars 被 trick 的 finally 块清理为 undefined)
    expect(state.localVars['抵消/已回应']).toBeUndefined();
    // P1 失去第一张手牌(锦囊生效)
    expect(state.players[1].hand).not.toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(p1FirstCard);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5/6:出牌窗口非阻塞 slot 常驻时,出牌者本人也能 respond 无懈
  //
  // 真实游戏中 P0 出牌时「出牌窗口」slot(key=0)常驻;无懈广播窗口打开时
  // pendingSlots 同时存在 {0: 出牌窗口, -2: 无懈广播}。旧 findPendingSlot 第一步
  // get(ownerId=0) 命中出牌窗口非阻塞 slot → validate 误判「当前不是无懈窗口」→
  // 出牌者本人无法 respond 无懈(也无法打反无懈)。无懈是广播型,目标是锦囊牌本身,
  // 不应与使用者玩家绑定。
  // ─────────────────────────────────────────────────────────────

  // 用例5:出牌者本人抵消自己的锦囊(出牌窗口 slot 存在)
  it('用例5:出牌者本人也能 respond 无懈抵消自己的锦囊(出牌窗口 slot 常驻)', async () => {
    // 模拟真实出牌阶段:先创建出牌窗口非阻塞 slot(key=0=出牌者座次)
    // createGameState 不会自动创建它,须手动 applyAtom 复现真实场景
    void applyAtom(state, { type: '出牌窗口', player: 0 });
    await waitForStable(state);
    expect(state.pendingSlots.get(0)?.atom.type).toBe('出牌窗口');

    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);
    // 给 P0(出牌者本人)一张无懈可击
    const nullif0Id = `nullif-0-${state.players[0].hand.length}`;
    state.cardMap[nullif0Id] = {
      id: nullif0Id,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.players[0].hand.push(nullif0Id);

    const p1FirstCard = state.players[1].hand[0];

    // P0 出过河拆桥 → P1:此时 pendingSlots 应同时含出牌窗口(0)与无懈广播(-2)
    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });
    const wuxieSlot = [...state.pendingSlots.values()].find(
      (s) => (s.atom as { target?: number }).target === -2,
    );
    expect(wuxieSlot).toBeDefined();
    expect(state.pendingSlots.get(0)?.atom.type).toBe('出牌窗口');

    // P0(出牌者本人)respond 无懈抵消自己的锦囊。
    // 修复前:findPendingSlot 第一步 get(0) 命中出牌窗口非阻塞 slot → validate 误判
    //         「当前不是无懈窗口」→ dispatch 返回 false(拒绝),无懈未打出。
    // 修复后:findPendingSlot 跳过非阻塞出牌窗口 → 命中广播无懈 slot → 接受。
    const accepted = await engineDispatch(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 0,
      params: { cardId: nullif0Id },
      baseSeq: state.seq,
    });
    expect(accepted).toBe(true);
    await waitForStable(state);
    // P0 的无懈已打出(离开手牌)= execute 已执行 runUseFlow
    expect(state.players[0].hand).not.toContain(nullif0Id);
  });

  // 用例6:对方出无懈后,出牌者本人出反无懈(出牌窗口 slot 存在)——用户场景2
  it('用例6:对方出无懈后,出牌者本人能出反无懈(出牌窗口 slot 常驻)', async () => {
    void applyAtom(state, { type: '出牌窗口', player: 0 });
    await waitForStable(state);

    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);
    // P1 持无懈(抵消锦囊)
    const nullif1Id = `nullif-1-${state.players[1].hand.length}`;
    state.cardMap[nullif1Id] = {
      id: nullif1Id,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.players[1].hand.push(nullif1Id);
    // P0(出牌者)持无懈(反无懈)
    const nullif0Id = `nullif-0-${state.players[0].hand.length}`;
    state.cardMap[nullif0Id] = {
      id: nullif0Id,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.players[0].hand.push(nullif0Id);

    const p1FirstCard = state.players[1].hand[0];

    // P0 出锦囊
    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });
    // P1 出无懈抵消锦囊 → close-reopen 打开反无懈广播窗口
    await dispatchAndWait(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: nullif1Id },
      baseSeq: state.seq,
    });
    // 反无懈窗口应为广播请求回应
    const counterSlot = [...state.pendingSlots.values()].find(
      (s) => (s.atom as { requestType?: string }).requestType === '无懈可击',
    );
    expect(counterSlot).toBeDefined();

    // P0(出牌者本人)出反无懈。修复前同样被 validate 拒绝,修复后被接受。
    const accepted = await engineDispatch(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 0,
      params: { cardId: nullif0Id },
      baseSeq: state.seq,
    });
    expect(accepted).toBe(true);
    await waitForStable(state);
    expect(state.players[0].hand).not.toContain(nullif0Id);
  });
});

// ── 以下为从 早期无懈测试 合并的 dispatch 链路测试 ──
describe('无懈可击 dispatch 链路', () => {
  let state: GameState;

  beforeEach(async () => {
    state = createGameState({
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
          // P1 手牌:基础牌(过河拆桥目标要丢的) + 无懈可击
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
  });

  // 用例 1:锦囊 → 无懈 pending (target=-2 广播) 出现
  it('用例1:出过河拆桥 → 产生无懈可击 pending (broadcast)', async () => {
    const gqId = `gq-${state.players[0].hand.length}`;
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

    expect(state.pendingSlots.size).toBe(1);
    const atom = firstPendingAtom(state);
    expect(atom.type).toBe('请求回应');
    expect(atom.requestType).toBe('无懈可击');
    expect(atom.target).toBe(-2);
  });

  // 用例 2:P1 respond 出无懈 → 锦囊被抵消 → P1 牌未丢
  it('用例2:P1 出无懈可击 → 锦囊被抵消(目标牌未弃)', async () => {
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);
    const nullifId = `wx-${state.players[1].hand.length}`;
    state.cardMap[nullifId] = {
      id: nullifId,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.players[1].hand.push(nullifId);

    const _p1HandBefore = state.players[1].hand.slice();
    const p1FirstCard = 'd1';

    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBe(1);

    // dispatch respond:ownerId=1 → pendingSlots.get(1) 找不到 → fallback 命中 -2 广播 slot
    await dispatchAndWait(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: nullifId },
      baseSeq: state.seq,
    });

    // dispatch respond:ownerId=1 → runUseFlow(无懈) → 无懈帧压栈 → 反无懈窗口打开
    // close-reopen:旧 slot resolve,无懈的 runSettlementPhase 开反无懈窗口(新 createdSeq)
    expect(state.pendingSlots.size).toBeGreaterThanOrEqual(1); // 反无懈窗口
    expect(state.players[1].hand).not.toContain(nullifId); // 无懈牌已入弃牌堆

    // fireTimeout 结束反无懈窗口(无人反无懈) → 无懈生效 → 过河拆桥被抵消
    await fireTimeoutAndWait(state);

    // 锦囊被抵消 → P1 基础牌未丢
    expect(state.players[1].hand).toContain(p1FirstCard);
    expect(state.localVars['抵消/已回应']).toBeUndefined();
    // 锦囊进弃牌堆
    expect(state.zones.discardPile).toContain(gqId);
  });

  // 用例 3:双无懈:P1 出无懈抵消 → P0 出无懈反抵消 → 锦囊恢复生效
  it('用例3:双无懈抵消 → 锦囊恢复生效(目标失去手牌)', async () => {
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);
    const nullif1Id = `wx1-${state.players[1].hand.length}`;
    state.cardMap[nullif1Id] = {
      id: nullif1Id,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.players[1].hand.push(nullif1Id);
    const nullif0Id = `wx0-${state.players[0].hand.length}`;
    state.cardMap[nullif0Id] = {
      id: nullif0Id,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.players[0].hand.push(nullif0Id);

    const p1FirstCard = 'd1';

    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBe(1);

    // P1 出无懈抵消
    await dispatchAndWait(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: nullif1Id },
      baseSeq: state.seq,
    });
    // P1 出无懈 → runUseFlow(无懈) → 反无懈窗口打开
    expect(state.pendingSlots.size).toBeGreaterThanOrEqual(1); // 反无懈窗口

    // P0 出反无懈
    await dispatchAndWait(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 0,
      params: { cardId: nullif0Id },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBeGreaterThanOrEqual(1); // 反反无懈窗口

    // 超时结束窗口
    await fireTimeoutAndWait(state);

    // 盲选窗口也超时(defaultChoice=0 兜底)
    await fireTimeoutAndWait(state);

    // 锦囊恢复生效 → P1 失去基础牌
    expect(state.players[1].hand).not.toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(gqId);
    expect(state.localVars['抵消/已回应']).toBeUndefined(); // trick finally 清理
  });

  // 用例 4:无人出无懈 → fireTimeout → 锦囊正常生效
  it('用例4:fireTimeout → 无人出无懈 → 锦囊正常结算(目标失去手牌)', async () => {
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);

    const p1FirstCard = 'd1';

    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBe(1);

    await fireTimeoutAndWait(state);

    // 盲选窗口也超时(defaultChoice=0 兜底)
    await fireTimeoutAndWait(state);

    expect(state.localVars['抵消/已回应']).toBeUndefined();
    expect(state.players[1].hand).not.toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(gqId);
    expect(state.pendingSlots.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// skip 机制:广播型 pending(无懈可击)的玩家放弃回应
// 验证 dispatch 的 skip actionType 处理:
//   1. 单人 skip 不 resolve slot(其他人可能想打无懈)
//   2. 全员 skip → 提前 resolve(不等超时)→ 无懈循环退出 → 锦囊正常结算
//   3. skip 被接受(return true),不被 reject
// ─────────────────────────────────────────────────────────────
describe('skip 机制:广播型 pending 放弃回应', () => {
  let state: GameState;

  beforeEach(async () => {
    state = createGameState({
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
  });

  it('单人 skip 不 resolve slot,全员 skip → 锦囊正常结算', async () => {
    const gqId = 'gq-0';
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

    // 广播型无懈可击 pending 存在
    expect(state.pendingSlots.size).toBe(1);
    const slot = [...state.pendingSlots.values()][0];
    const atomTarget = (slot.atom as { target?: number }).target;
    expect(atomTarget).toBeLessThan(0); // 广播型

    // P0 skip → 被接受(true),slot 仍存在(P1 还没 skip)
    const accepted0 = await engineDispatch(state, {
      skillId: '__skip',
      actionType: 'skip',
      ownerId: 0,
      params: {},
      baseSeq: 0,
    });
    expect(accepted0).toBe(true);
    expect(state.pendingSlots.size).toBe(1); // slot 未 resolve
    expect(slot.skippedPlayers?.has(0)).toBe(true);
    expect(slot.skippedPlayers?.has(1)).toBe(false);

    // P1 skip → 被接受(true),全员 skip → 触发超时 → slot resolve
    const accepted1 = await engineDispatch(state, {
      skillId: '__skip',
      actionType: 'skip',
      ownerId: 1,
      params: {},
      baseSeq: 0,
    });
    expect(accepted1).toBe(true);

    // 等待父 execute resume(无瓣循环退出 → 过河拆桥继续结算 → 盲选窗口超时)
    await waitForStable(state);
    // 盲选窗口也超时
    await fireTimeoutAndWait(state);

    // 锦囊正常结算:P1 失去 d1,过河拆桥入弃牌堆
    expect(state.localVars['抵消/已回应']).toBeUndefined();
    expect(state.players[1].hand).not.toContain('d1');
    expect(state.zones.discardPile).toContain('d1');
    expect(state.zones.discardPile).toContain(gqId);
    expect(state.pendingSlots.size).toBe(0);
  });

  it('skip 后仍可 respond(未全员 skip 时 slot 存在)', async () => {
    const gqId = 'gq-0';
    state.cardMap[gqId] = {
      id: gqId,
      name: '过河拆桥',
      suit: '♠',
      color: '黑',
      rank: '3',
      type: '锦囊牌',
    };
    state.players[0].hand.push(gqId);
    // 给 P1 一张无懈可击
    const nullifId = 'wx-0';
    state.cardMap[nullifId] = {
      id: nullifId,
      name: '无懈可击',
      suit: '♠',
      color: '黑',
      rank: 'J',
      type: '锦囊牌',
    };
    state.players[1].hand.push(nullifId);

    await dispatchAndWait(state, {
      skillId: '过河拆桥',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: gqId, targets: [1] },
      baseSeq: state.seq,
    });

    expect(state.pendingSlots.size).toBe(1);

    // P0 skip → slot 仍存在
    await engineDispatch(state, {
      skillId: '__skip',
      actionType: 'skip',
      ownerId: 0,
      params: {},
      baseSeq: 0,
    });
    expect(state.pendingSlots.size).toBe(1);

    // P1 仍可 respond 无懈可击(slot 未被 P0 的 skip resolve)
    await dispatchAndWait(state, {
      skillId: '无懈可击',
      actionType: 'respond',
      ownerId: 1,
      params: { cardId: nullifId },
      baseSeq: state.seq,
    });

    // P1 打了无懈 → 锦囊被抵消
    // 新窗口出现(其他人可反无瓣),也 skip 掉
    if (state.pendingSlots.size > 0) {
      await engineDispatch(state, {
        skillId: '__skip',
        actionType: 'skip',
        ownerId: 0,
        params: {},
        baseSeq: 0,
      });
      await engineDispatch(state, {
        skillId: '__skip',
        actionType: 'skip',
        ownerId: 1,
        params: {},
        baseSeq: 0,
      });
      await waitForStable(state);
    }

    // 锦囊被抵消 → P1 手牌中 d1 仍在(过河拆桥未生效)
    expect(state.players[1].hand).toContain('d1');
    // 无懈可击已出
    expect(state.players[1].hand).not.toContain(nullifId);
  });
});
