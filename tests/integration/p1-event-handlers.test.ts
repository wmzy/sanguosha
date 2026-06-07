// tests/integration/p1-event-handlers.test.ts
//
// 8 个 P1 新 server event 类型的 reducer handlers round-trip 验证。
// P1 引入了 8 个新 atom 类型（loseHealth, loseCard, removeSkill, setChained,
// addMark, removeMark, clearExpiredMarks, shuffleDeck），它们各自 emit server
// 事件，但 applyGameStateEvent 缺少对应 case handler。本测试通过构造 ServerEvent
// 对象 → reduceGameState → 断言状态字段被正确修改，验证 round-trip 正确性。

import { describe, it, expect } from 'vitest';
import { reduceGameState } from '@engine/view/reducer';
import { createTestGame } from '../engine-helpers';
import type { GameState, Json, Mark, ServerEvent, TriggerRule } from '@engine/types';
let evId = 0;

function makeEvent(type: string, payload: Record<string, unknown>): ServerEvent {
  return { id: `e${evId++}`, type, timestamp: 0, payload: payload as Json };
}

describe('P1 reducer handlers (8 个新 server event 类型)', () => {
  describe('失去体力', () => {
    it('减血并夹到 0', () => {
      const state = createTestGame({ playerCount: 2 });
      const start = state.players.P1.health;
      const next = reduceGameState(state, [makeEvent('失去体力', { target: 'P1', amount: 2 })]);
      expect(next.players.P1.health).toBe(start - 2);
    });

    it('扣到 0 不会变负数', () => {
      const state = createTestGame({ playerCount: 2 });
      const next = reduceGameState(state, [makeEvent('失去体力', { target: 'P1', amount: 999 })]);
      expect(next.players.P1.health).toBe(0);
    });

    it('未知 target 时返回原 state', () => {
      const state = createTestGame({ playerCount: 2 });
      const next = reduceGameState(state, [makeEvent('失去体力', { target: 'NOPE', amount: 1 })]);
      expect(next).toBe(state);
    });
  });

  describe('失去牌', () => {
    it('从手牌失去：移出手牌并进入弃牌堆', () => {
      let state = createTestGame({ playerCount: 2 });
      state = { ...state, players: { ...state.players, P1: { ...state.players.P1, hand: ['c1', 'c2'] } } };
      state = { ...state, cardMap: { ...state.cardMap, c1: { id: 'c1', name: '杀', type: '基本牌', subtype: '杀', suit: '♥', rank: 'A', description: '' } } };

      const next = reduceGameState(state, [
        makeEvent('失去牌', { cardId: 'c1', from: { zone: '手牌', player: 'P1' } }),
      ]);
      expect(next.players.P1.hand).toEqual(['c2']);
      expect(next.zones.discardPile).toContain('c1');
    });

    it('从装备区失去：清空 slot 并进弃牌堆', () => {
      let state = createTestGame({ playerCount: 2 });
      state = {
        ...state,
        players: {
          ...state.players,
          P1: { ...state.players.P1, equipment: { ...state.players.P1.equipment, 武器: 'w1' } },
        },
        cardMap: { ...state.cardMap, w1: { id: 'w1', name: '诸葛连弩', type: '装备牌', subtype: '武器', suit: '♠', rank: 'A', description: '' } },
      };

      const next = reduceGameState(state, [
        makeEvent('失去牌', { cardId: 'w1', from: { zone: '装备', player: 'P1', slot: '武器' } }),
      ]);
      expect(next.players.P1.equipment.武器).toBeUndefined();
      expect(next.zones.discardPile).toContain('w1');
    });

    it('手牌中无此 cardId：no-op', () => {
      const state = createTestGame({ playerCount: 2 });
      const next = reduceGameState(state, [
        makeEvent('失去牌', { cardId: 'nonexistent', from: { zone: '手牌', player: 'P1' } }),
      ]);
      expect(next).toBe(state);
    });
  });

  describe('去技能', () => {
    it('移除该玩家的指定 skillId triggers', () => {
      let state = createTestGame({ playerCount: 2 });
      const trigger: TriggerRule = {
        event: '造成伤害',
        source: '角色',
        skillId: 'jianxiong',
        player: 'P1',
        priority: 0,
      };
      const other: TriggerRule = { ...trigger, player: 'P2', skillId: 'rende' };
      state = { ...state, triggers: [trigger, other] };

      const next = reduceGameState(state, [
        makeEvent('去技能', { player: 'P1', skillId: 'jianxiong' }),
      ]);
      expect(next.triggers).toHaveLength(1);
      expect(next.triggers[0]?.skillId).toBe('rende');
    });
  });

  describe('设横置', () => {
    it('设置 chained=true', () => {
      const state = createTestGame({ playerCount: 2 });
      expect(state.players.P1.chained).toBe(false);
      const next = reduceGameState(state, [makeEvent('设横置', { target: 'P1', chained: true })]);
      expect(next.players.P1.chained).toBe(true);
    });

    it('设置 chained=false（取消连环）', () => {
      let state = createTestGame({ playerCount: 2 });
      state = { ...state, players: { ...state.players, P1: { ...state.players.P1, chained: true } } };
      const next = reduceGameState(state, [makeEvent('设横置', { target: 'P1', chained: false })]);
      expect(next.players.P1.chained).toBe(false);
    });
  });

  describe('addMark / removeMark / clearExpiredMarks', () => {
    it('addMark 写入 marks[id]，同 id 覆盖', () => {
      const state = createTestGame({ playerCount: 2 });
      const m1: Mark = { id: 'k1', scope: 'player', duration: 'permanent' };
      const m1b: Mark = { id: 'k1', scope: 'player', duration: 'untilTurnEnd' };

      const s1 = reduceGameState(state, [makeEvent('加标记', { player: 'P1', mark: m1 })]);
      expect(s1.marks.P1).toEqual([m1]);

      const s2 = reduceGameState(s1, [makeEvent('加标记', { player: 'P1', mark: m1b })]);
      expect(s2.marks.P1).toEqual([m1b]);
    });

    it('removeMark 按 id 移除', () => {
      let state = createTestGame({ playerCount: 2 });
      const m: Mark = { id: 'k1', scope: 'player', duration: 'permanent' };
      state = { ...state, marks: { ...state.marks, P1: [m] } };

      const next = reduceGameState(state, [
        makeEvent('去标记', { player: 'P1', markId: 'k1' }),
      ]);
      expect(next.marks.P1).toEqual([]);
    });

    it('clearExpiredMarks: untilTurnEnd 在 turnEnd 时被清空，permanent 保留', () => {
      let state: GameState = createTestGame({ playerCount: 2 });
      const trans: Mark = { id: 't1', scope: 'player', duration: 'untilTurnEnd' };
      const perm: Mark = { id: 'p1', scope: 'player', duration: 'permanent' };
      state = { ...state, marks: { ...state.marks, P1: [trans], P2: [perm] } };

      const next = reduceGameState(state, [
        makeEvent('清过期标记', { phase: '回合结束' }),
      ]);
      expect(next.marks.P1).toEqual([]);
      expect(next.marks.P2).toEqual([perm]);
    });
  });

  describe('洗牌', () => {
    it('shuffleDeck 为 no-op（不修改状态字段）', () => {
      const state = createTestGame({ playerCount: 2 });
      const next = reduceGameState(state, [makeEvent('洗牌', {})]);
      expect(next).toBe(state);
    });
  });
});
