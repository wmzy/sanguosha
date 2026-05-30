import { describe, it, expect } from 'vitest';
import { getDistance, getAttackRange, isInAttackRange } from '@engine/v2/distance';
import { createTestGame, injectEquipCard, setPlayPhase } from './setup';

describe('V2 Engine - 距离计算', () => {
  describe('基础距离', () => {
    it('相邻玩家距离为 1', () => {
      const state = createTestGame({ playerCount: 2 });
      // P1 ↔ P2 相邻
      expect(getDistance(state, 'P1', 'P2')).toBe(1);
      expect(getDistance(state, 'P2', 'P1')).toBe(1);
    });

    it('自身距离为 0', () => {
      const state = createTestGame();
      expect(getDistance(state, 'P1', 'P1')).toBe(0);
    });

    it('三人游戏中距离正确', () => {
      const state = createTestGame({ playerCount: 3 });
      expect(getDistance(state, 'P1', 'P2')).toBe(1);
      expect(getDistance(state, 'P1', 'P3')).toBe(1);
      expect(getDistance(state, 'P2', 'P3')).toBe(1);
    });

    it('四人游戏中远距离为 2', () => {
      const state = createTestGame({ playerCount: 4 });
      // P1-P2-P3-P4 环形：P1→P3 distance=2
      expect(getDistance(state, 'P1', 'P3')).toBe(2);
      expect(getDistance(state, 'P2', 'P4')).toBe(2);
    });

    it('五人游戏中最远距离为 2', () => {
      const state = createTestGame({ playerCount: 5 });
      // P1-P2-P3-P4-P5 环形：P1→P3=2, P1→P4=2
      expect(getDistance(state, 'P1', 'P3')).toBe(2);
      expect(getDistance(state, 'P1', 'P4')).toBe(2);
    });
  });

  describe('马匹修正', () => {
    it('-1 马（进攻马）减少到目标的距离', () => {
      const state = createTestGame({ playerCount: 4 });
      // P1→P3 基础距离 2
      expect(getDistance(state, 'P1', 'P3')).toBe(2);

      // 给 P1 装上进攻马
      const p1 = state.players['P1'];
      const horseCard = {
        id: 'test-horse-minus',
        name: '赤兔',
        type: '装备牌' as const,
        subtype: '进攻马' as const,
        suit: '♥' as const,
        rank: 'A' as const,
        description: '',
      };
      const withHorse = {
        ...state,
        cardMap: { ...state.cardMap, 'test-horse-minus': horseCard },
        players: {
          ...state.players,
          P1: {
            ...p1,
            equipment: { ...p1.equipment, horseMinus: 'test-horse-minus' },
          },
        },
      };

      // P1→P3 = max(1, 2-1) = 1
      expect(getDistance(withHorse, 'P1', 'P3')).toBe(1);
    });

    it('+1 马（防御马）增加别人到自己的距离', () => {
      const state = createTestGame({ playerCount: 4 });
      expect(getDistance(state, 'P3', 'P1')).toBe(2);

      // 给 P1 装上防御马
      const p1 = state.players['P1'];
      const horseCard = {
        id: 'test-horse-plus',
        name: '的卢',
        type: '装备牌' as const,
        subtype: '防御马' as const,
        suit: '♣' as const,
        rank: 'A' as const,
        description: '',
      };
      const withHorse = {
        ...state,
        cardMap: { ...state.cardMap, 'test-horse-plus': horseCard },
        players: {
          ...state.players,
          P1: {
            ...p1,
            equipment: { ...p1.equipment, horsePlus: 'test-horse-plus' },
          },
        },
      };

      // P3→P1 = 2+1 = 3
      expect(getDistance(withHorse, 'P3', 'P1')).toBe(3);
    });

    it('-1 马不会使距离小于 1', () => {
      const state = createTestGame({ playerCount: 2 });
      // P1→P2 = 1
      expect(getDistance(state, 'P1', 'P2')).toBe(1);

      const p1 = state.players['P1'];
      const horseCard = {
        id: 'test-horse-minus',
        name: '赤兔',
        type: '装备牌' as const,
        subtype: '进攻马' as const,
        suit: '♥' as const,
        rank: 'A' as const,
        description: '',
      };
      const withHorse = {
        ...state,
        cardMap: { ...state.cardMap, 'test-horse-minus': horseCard },
        players: {
          ...state.players,
          P1: {
            ...p1,
            equipment: { ...p1.equipment, horseMinus: 'test-horse-minus' },
          },
        },
      };

      // max(1, 1-1) = 1
      expect(getDistance(withHorse, 'P1', 'P2')).toBe(1);
    });
  });

  describe('攻击范围', () => {
    it('无武器时攻击范围为 1', () => {
      const state = createTestGame();
      expect(getAttackRange(state, 'P1')).toBe(1);
    });

    it('装备武器后攻击范围等于武器 range', () => {
      const state = createTestGame();
      const p1 = state.players['P1'];
      const weaponCard = {
        id: 'test-weapon',
        name: '麒麟弓',
        type: '装备牌' as const,
        subtype: '武器' as const,
        suit: '♥' as const,
        rank: 'A' as const,
        description: '',
        range: 5,
      };
      const withWeapon = {
        ...state,
        cardMap: { ...state.cardMap, 'test-weapon': weaponCard },
        players: {
          ...state.players,
          P1: {
            ...p1,
            equipment: { ...p1.equipment, weapon: 'test-weapon' },
          },
        },
      };

      expect(getAttackRange(withWeapon, 'P1')).toBe(5);
    });

    it('isInAttackRange 正确判断', () => {
      const state = createTestGame({ playerCount: 4 });
      // P1→P2 distance=1, range=1 → true
      expect(isInAttackRange(state, 'P1', 'P2')).toBe(true);
      // P1→P3 distance=2, range=1 → false
      expect(isInAttackRange(state, 'P1', 'P3')).toBe(false);
    });
  });
});
