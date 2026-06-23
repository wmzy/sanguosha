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
  resetForTest,
  registerSkillsFromState,
} from '../../src/engine/create-engine';
import { fireTimeoutAndWait, dispatchAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

/** 返回第一个 pending slot 的 atom 概要 */
function firstPendingAtom(state: GameState): { type?: string; requestType?: string; target?: number } {
  if (state.pendingSlots.size === 0) return {} as { type?: string; requestType?: string; target?: number };
  return [...state.pendingSlots.values()][0].atom as { type?: string; requestType?: string; target?: number };
}

describe('无懈可击链路', () => {
  let state: GameState;

  beforeEach(async () => {
    resetForTest();
    state = createGameState({
      players: [
        {
          index: 0, name: 'P0', character: '', health: 4, maxHealth: 4, alive: true,
          hand: [], equipment: {},
          skills: ['回合管理', '过河拆桥', '无懈可击'],
          vars: {}, marks: [], pendingTricks: [], judgeZone: [],
        },
        {
          index: 1, name: 'P1', character: '', health: 4, maxHealth: 4, alive: true,
          // 给 P1 一张基础牌(用于 过河拆桥)
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
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:出锦囊 → 产生无懈可击询问 pending
  // ─────────────────────────────────────────────────────────────
  it('用例1:出过河拆桥 → 产生无懈可击询问 pending', async () => {
    const lord = state.players[0];
    // 给 P0 一张过河拆桥
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = { id: gqId, name: '过河拆桥', suit: '♠', rank: '3', type: '锦囊牌' };
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
    expect(state.zones.processing).toContain(gqId);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:fireTimeout → 锦囊正常结算
  // ─────────────────────────────────────────────────────────────
  it('用例2:fireTimeout → 无人打无懈 → 锦囊正常结算(目标手牌入弃牌堆)', async () => {
    const lord = state.players[0];
    // 给 P0 一张过河拆桥
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = { id: gqId, name: '过河拆桥', suit: '♠', rank: '3', type: '锦囊牌' };
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
    expect(state.zones.processing).not.toContain(gqId);
    // pending 已消费
    expect(state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:抵消场景:P1 持有无懈可击 → respond 打无懈 → 锦囊被抵消
  // ─────────────────────────────────────────────────────────────
  // close-reopen:旧 slot resolve,askWuxie 循环创建新窗口(新 createdSeq)
  it('用例3:P1 出无纶可击 → 锦囊被抵消(目标牌未被弃)', async () => {
    // 给 P0 一张过河拆桥
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = { id: gqId, name: '过河拆桥', suit: '♠', rank: '3', type: '锦囊牌' };
    state.players[0].hand.push(gqId);
    // 给 P1 一张无懈可击
    const wuxieId = `wuxie-${state.players[1].hand.length}`;
    state.cardMap[wuxieId] = { id: wuxieId, name: '无懈可击', suit: '♠', rank: 'J', type: '锦囊牌' };
    state.players[1].hand.push(wuxieId);

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
      params: { cardId: wuxieId },
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
    expect(state.localVars['无懈/被抵消']).toBeUndefined();
    // P1 手牌减少 1(无懈可击)
    expect(state.players[1].hand.length).toBe(p1HandBefore.length - 1);
    // P1 第一张手牌还在(没被弃)
    const p1FirstCard = p1HandBefore.find(id => id !== wuxieId);
    if (p1FirstCard) {
      expect(state.players[1].hand).toContain(p1FirstCard);
    }
    // 锦囊也进弃牌堆(因为锦囊本身还是要从处理区移走)
    expect(state.zones.discardPile).toContain(gqId);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:双无懈:出无懈抵消 → 再出无懈抵消无懈 → 锦囊恢复生效
  // ─────────────────────────────────────────────────────────────
  it('用例4:双无纶抵消 → 锦囊恢复生效(目标失去手牌)', async () => {
    // 给 P0 一张过河拆桥
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = { id: gqId, name: '过河拆桥', suit: '♠', rank: '3', type: '锦囊牌' };
    state.players[0].hand.push(gqId);
    // 给 P1 一张无懈可击
    const wuxie1Id = `wuxie-1-${state.players[1].hand.length}`;
    state.cardMap[wuxie1Id] = { id: wuxie1Id, name: '无懈可击', suit: '♠', rank: 'J', type: '锦囊牌' };
    state.players[1].hand.push(wuxie1Id);
    // 给 P0 一张无懈可击(反无懈)
    const wuxie0Id = `wuxie-0-${state.players[0].hand.length}`;
    state.cardMap[wuxie0Id] = { id: wuxie0Id, name: '无懈可击', suit: '♠', rank: 'J', type: '锦囊牌' };
    state.players[0].hand.push(wuxie0Id);

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
      params: { cardId: wuxie1Id },
      baseSeq: state.seq,
    });

    // close-reopen:旧 slot resolve,askWuxie 循环创建新窗口
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
      params: { cardId: wuxie0Id },
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
    expect(state.localVars['无懈/被抵消']).toBeUndefined();
    // P1 失去第一张手牌(锦囊生效)
    expect(state.players[1].hand).not.toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(p1FirstCard);
  });
});

// ── 以下为从 wuxieji.test.ts 合并的 dispatch 链路测试 ──
describe('无懈可击 dispatch 链路', () => {
  let state: GameState;

  beforeEach(async () => {
    resetForTest();
    state = createGameState({
      players: [
        {
          index: 0, name: 'P0', character: '', health: 4, maxHealth: 4, alive: true,
          hand: [], equipment: {},
          skills: ['回合管理', '过河拆桥', '无懈可击'],
          vars: {}, marks: [], pendingTricks: [], judgeZone: [],
        },
        {
          index: 1, name: 'P1', character: '', health: 4, maxHealth: 4, alive: true,
          // P1 手牌:基础牌(过河拆桥目标要丢的) + 无懈可击
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
  });

  // 用例 1:锦囊 → 无懈 pending (target=-2 广播) 出现
  it('用例1:出过河拆桥 → 产生无懈可击 pending (broadcast)', async () => {
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = { id: gqId, name: '过河拆桥', suit: '♠', rank: '3', type: '锦囊牌' };
    state.players[0].hand.push(gqId);

    await dispatchAndWait(state, {
      skillId: '过河拆桥', actionType: 'use', ownerId: 0,
      params: { cardId: gqId, targets: [1] }, baseSeq: state.seq,
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
    state.cardMap[gqId] = { id: gqId, name: '过河拆桥', suit: '♠', rank: '3', type: '锦囊牌' };
    state.players[0].hand.push(gqId);
    const wuxieId = `wx-${state.players[1].hand.length}`;
    state.cardMap[wuxieId] = { id: wuxieId, name: '无懈可击', suit: '♠', rank: 'J', type: '锦囊牌' };
    state.players[1].hand.push(wuxieId);

    const p1HandBefore = state.players[1].hand.slice();
    const p1FirstCard = 'd1';

    await dispatchAndWait(state, {
      skillId: '过河拆桥', actionType: 'use', ownerId: 0,
      params: { cardId: gqId, targets: [1] }, baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBe(1);

    // dispatch respond:ownerId=1 → pendingSlots.get(1) 找不到 → fallback 命中 -2 广播 slot
    await dispatchAndWait(state, {
      skillId: '无懈可击', actionType: 'respond', ownerId: 1,
      params: { cardId: wuxieId }, baseSeq: state.seq,
    });

    // dispatch respond execute 翻转 localVars[`无懈/被抵消/${target}`]=true;
    // close-reopen:旧 slot resolve,askWuxie 循环创建新窗口(新 createdSeq)
    // 过河拆桥是单目标锦囊,target=1
    expect(state.localVars['无懈/被抵消/1']).toBe(true);
    expect(state.pendingSlots.size).toBe(1); // 新窗口
    expect(state.players[1].hand).not.toContain(wuxieId); // 无懈牌已入弃牌堆

    // fireTimeout 结束新窗口(无人反无懈)
    await fireTimeoutAndWait(state);

    // 锦囊被抵消 → P1 基础牌未丢
    expect(state.players[1].hand).toContain(p1FirstCard);
    expect(state.localVars['无懈/被抵消']).toBeUndefined();
    // 锦囊进弃牌堆
    expect(state.zones.discardPile).toContain(gqId);
  });

  // 用例 3:双无懈:P1 出无懈抵消 → P0 出无懈反抵消 → 锦囊恢复生效
  it('用例3:双无懈抵消 → 锦囊恢复生效(目标失去手牌)', async () => {
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = { id: gqId, name: '过河拆桥', suit: '♠', rank: '3', type: '锦囊牌' };
    state.players[0].hand.push(gqId);
    const wuxie1Id = `wx1-${state.players[1].hand.length}`;
    state.cardMap[wuxie1Id] = { id: wuxie1Id, name: '无懈可击', suit: '♠', rank: 'J', type: '锦囊牌' };
    state.players[1].hand.push(wuxie1Id);
    const wuxie0Id = `wx0-${state.players[0].hand.length}`;
    state.cardMap[wuxie0Id] = { id: wuxie0Id, name: '无懈可击', suit: '♠', rank: 'J', type: '锦囊牌' };
    state.players[0].hand.push(wuxie0Id);

    const p1FirstCard = 'd1';

    await dispatchAndWait(state, {
      skillId: '过河拆桥', actionType: 'use', ownerId: 0,
      params: { cardId: gqId, targets: [1] }, baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBe(1);

    // P1 出无懈抵消
    await dispatchAndWait(state, {
      skillId: '无懈可击', actionType: 'respond', ownerId: 1,
      params: { cardId: wuxie1Id }, baseSeq: state.seq,
    });
    expect(state.localVars['无懈/被抵消/1']).toBe(true); // P1 抵消锦囊
    expect(state.pendingSlots.size).toBe(1); // close-reopen:新窗口

    // P0 出反无懈
    await dispatchAndWait(state, {
      skillId: '无懈可击', actionType: 'respond', ownerId: 0,
      params: { cardId: wuxie0Id }, baseSeq: state.seq,
    });
    expect(state.localVars['无懈/被抵消/1']).toBe(false); // 翻转回 false:反无懈抵消了无懈
    expect(state.pendingSlots.size).toBe(1); // close-reopen:新窗口

    // 超时结束窗口
    await fireTimeoutAndWait(state);

    // 盲选窗口也超时(defaultChoice=0 兜底)
    await fireTimeoutAndWait(state);

    // 锦囊恢复生效 → P1 失去基础牌
    expect(state.players[1].hand).not.toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(gqId);
    expect(state.localVars['无懈/被抵消']).toBeUndefined(); // trick finally 清理
  });

  // 用例 4:无人出无懈 → fireTimeout → 锦囊正常生效
  it('用例4:fireTimeout → 无人出无懈 → 锦囊正常结算(目标失去手牌)', async () => {
    const gqId = `gq-${state.players[0].hand.length}`;
    state.cardMap[gqId] = { id: gqId, name: '过河拆桥', suit: '♠', rank: '3', type: '锦囊牌' };
    state.players[0].hand.push(gqId);

    const p1FirstCard = 'd1';

    await dispatchAndWait(state, {
      skillId: '过河拆桥', actionType: 'use', ownerId: 0,
      params: { cardId: gqId, targets: [1] }, baseSeq: state.seq,
    });
    expect(state.pendingSlots.size).toBe(1);

    await fireTimeoutAndWait(state);

    // 盲选窗口也超时(defaultChoice=0 兜底)
    await fireTimeoutAndWait(state);

    expect(state.localVars['无懈/被抵消']).toBeUndefined();
    expect(state.players[1].hand).not.toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(gqId);
    expect(state.pendingSlots.size).toBe(0);
  });
});