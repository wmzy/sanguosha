// tests/integration/wuxieji.test.ts
// 集成测试:无懈可击 dispatch 链路
//   - dispatch 按 ownerId 找不到广播 slot(-2)时,能正确命中
//   - respond execute 保留原 slot(不递归创建新 pending)
//   - 多次 respond 翻转 抵消/恢复 状态
//   - 超时后锦囊按抵消状态结算
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
  if (state.pendingSlots.size === 0) return {};
  return [...state.pendingSlots.values()][0].atom as { type?: string; requestType?: string; target?: number };
}

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

    // respond execute 翻转被抵消=true;slot.resume() 重启定时器,窗口继续
    expect(state.localVars['无懈/被抵消']).toBe(true);
    expect(state.pendingSlots.size).toBe(1); // 窗口保持
    expect(state.players[1].hand).not.toContain(wuxieId); // 无懈牌已入弃牌堆

    // fireTimeout 结束窗口
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
    expect(state.localVars['无懈/被抵消']).toBe(true); // P1 抵消锦囊
    expect(state.pendingSlots.size).toBe(1); // 窗口保持(原 slot resume)

    // P0 出反无懈
    await dispatchAndWait(state, {
      skillId: '无懈可击', actionType: 'respond', ownerId: 0,
      params: { cardId: wuxie0Id }, baseSeq: state.seq,
    });
    expect(state.localVars['无懈/被抵消']).toBe(false); // 翻转回 false:反无懈抵消了无懈
    expect(state.pendingSlots.size).toBe(1);

    // 超时结束窗口
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

    expect(state.localVars['无懈/被抵消']).toBeUndefined();
    expect(state.players[1].hand).not.toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(p1FirstCard);
    expect(state.zones.discardPile).toContain(gqId);
    expect(state.pendingSlots.size).toBe(0);
  });
});