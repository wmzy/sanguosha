import { describe, it, expect } from 'vitest';
import { getDistance, getAttackRange, isInAttackRange } from '@engine/distance';
import { isValidTarget } from '@engine/validate';
import { createTestGame, injectTrickCard } from './engine-helpers';

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
            equipment: { ...p1.equipment, 进攻马: 'test-horse-minus' },
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
            equipment: { ...p1.equipment, 防御马: 'test-horse-plus' },
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
            equipment: { ...p1.equipment, 武器: 'test-weapon' },
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

  describe('马术技能距离修正', () => {
    it('马术通过 vars.马术/距离修正 减少距离 1', () => {
      const state = createTestGame({ playerCount: 4 });
      // P1→P3 基础距离 2
      expect(getDistance(state, 'P1', 'P3')).toBe(2);

      // 给 P1 设置马术的距离修正
      const p1 = state.players['P1'];
      const withBonus = {
        ...state,
        players: {
          ...state.players,
          P1: {
            ...p1,
            vars: { ...p1.vars, '马术/距离修正': -1 },
          },
        },
      };

      // P1→P3 = max(1, 2 + (-1)) = 1
      expect(getDistance(withBonus, 'P1', 'P3')).toBe(1);
    });

    it('马术不会使距离小于 1', () => {
      const state = createTestGame({ playerCount: 4 });
      const p1 = state.players['P1'];
      const withBonus = {
        ...state,
        players: {
          ...state.players,
          P1: {
            ...p1,
            vars: { ...p1.vars, '马术/距离修正': -1 },
          },
        },
      };

      // P1→P2 基础距离 1，马术不能减到 0
      expect(getDistance(withBonus, 'P1', 'P2')).toBe(1);
    });

    it('马术与进攻马叠加', () => {
      const state = createTestGame({ playerCount: 6 });
      // P1→P4 基础距离 3
      expect(getDistance(state, 'P1', 'P4')).toBe(3);

      const horseCard = {
        id: 'test-horse-minus',
        name: '赤兔',
        type: '装备牌' as const,
        subtype: '进攻马' as const,
        suit: '♥' as const,
        rank: 'A' as const,
        description: '',
      };
      const p1 = state.players['P1'];
      const withBoth = {
        ...state,
        cardMap: { ...state.cardMap, 'test-horse-minus': horseCard },
        players: {
          ...state.players,
          P1: {
            ...p1,
            equipment: { ...p1.equipment, 进攻马: 'test-horse-minus' },
            vars: { ...p1.vars, '马术/距离修正': -1 },
          },
        },
      };

      // 先减进攻马(-1)=2，再减马术(-1)=1
      expect(getDistance(withBoth, 'P1', 'P4')).toBe(1);
    });

    it('无马术距离修正时不受影响', () => {
      const state = createTestGame({ playerCount: 4 });
      // P1 没有 vars.马术/距离修正，距离正常
      expect(getDistance(state, 'P1', 'P3')).toBe(2);
      expect(getDistance(state, 'P1', 'P2')).toBe(1);
    });
  });

  describe('奇才技能（锦囊无距离限制）', () => {
    it('有 noTrickDistanceLimit tag 时顺手牵羊可对距离外目标使用', () => {
      let state = createTestGame({ playerCount: 4 });
      state = injectTrickCard(state, 'P1', '顺手牵羊');
      const cardId = state.players['P1'].hand.find(id => state.cardMap[id]?.name === '顺手牵羊')!;

      // P1→P3 distance=2 > attackRange=1，正常不能对 P3 用顺手牵羊
      expect(isValidTarget(state, 'P1', cardId, 'P3')).toBe(false);

      // 给 P1 加上奇才 tag
      const p1 = state.players['P1'];
      const withTag = {
        ...state,
        players: {
          ...state.players,
          P1: { ...p1, tags: [...p1.tags, 'noTrickDistanceLimit'] },
        },
      };

      // 有 tag 后 P3 变成合法目标
      expect(isValidTarget(withTag, 'P1', cardId, 'P3')).toBe(true);
    });

    it('无 tag 时顺手牵羊受距离限制', () => {
      let state = createTestGame({ playerCount: 4 });
      state = injectTrickCard(state, 'P1', '顺手牵羊');
      const cardId = state.players['P1'].hand.find(id => state.cardMap[id]?.name === '顺手牵羊')!;

      // P1→P3 distance=2 > range=1，不能对 P3 使用
      expect(isValidTarget(state, 'P1', cardId, 'P3')).toBe(false);
      // P1→P2 distance=1 <= range=1，可以对 P2 使用
      expect(isValidTarget(state, 'P1', cardId, 'P2')).toBe(true);
    });
  });
});
