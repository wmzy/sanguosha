import { describe, it, expect } from 'vitest';
import { computeValidActions, validateAction, isCardPlayable, isValidTarget } from '@engine/validate';
import {
  createTestGame,
  setPlayPhase,
  injectCard,
  injectEquipCard,
  findCardInHand,
} from './engine-helpers';

describe('V2 Engine - 动作验证', () => {
  describe('validateAction', () => {
    it('非当前玩家不能出牌', () => {
      const state = setPlayPhase(createTestGame());
      const result = validateAction(state, {
        type: 'playCard',
        player: 'P2',
        cardId: state.players['P2'].hand[0],
      });
      expect(result).toContain('不是你的回合');
    });

    it('非出牌阶段不能出牌', () => {
      const state = createTestGame();
      // phase = '准备'
      const result = validateAction(state, {
        type: 'playCard',
        player: 'P1',
        cardId: state.players['P1'].hand[0],
      });
      expect(result).toContain('不是出牌阶段');
    });

    it('手牌中没有的牌不能出', () => {
      const state = setPlayPhase(createTestGame());
      const result = validateAction(state, {
        type: 'playCard',
        player: 'P1',
        cardId: 'fake-card-id',
      });
      expect(result).toContain('手牌中没有');
    });

    it('满血不能用桃', () => {
      let state = setPlayPhase(createTestGame());
      state = injectCard(state, 'P1', '桃');
      const peachId = findCardInHand(state, 'P1', '桃')!;

      const result = validateAction(state, {
        type: 'playCard',
        player: 'P1',
        cardId: peachId,
      });
      expect(result).toContain('体力已满');
    });
  });

  describe('computeValidActions', () => {
    it('出牌阶段返回 playCard + endTurn', () => {
      const state = setPlayPhase(createTestGame());
      const actions = computeValidActions(state, 'P1');
      const types = actions.map((a) => a.type);
      expect(types).toContain('playCard');
      expect(types).toContain('endTurn');
    });

    it('非当前玩家没有可用操作', () => {
      const state = setPlayPhase(createTestGame());
      const actions = computeValidActions(state, 'P2');
      expect(actions).toHaveLength(0);
    });

    it('杀只能出现在有合法目标时', () => {
      const state = setPlayPhase(createTestGame({ playerCount: 2 }));
      const actions = computeValidActions(state, 'P1');
      const playAction = actions.find((a) => a.type === 'playCard');
      if (playAction?.type !== 'playCard') return;

      const killCard = playAction.cards.find((c) => {
        const card = state.cardMap[c.cardId];
        return card?.name === '杀';
      });

      if (killCard) {
        expect(killCard.targets.length).toBeGreaterThan(0);
      }
    });
  });

  describe('isCardPlayable', () => {
    it('闪不可主动使用', () => {
      let state = setPlayPhase(createTestGame());
      state = injectCard(state, 'P1', '闪');
      const dodgeId = findCardInHand(state, 'P1', '闪')!;
      expect(isCardPlayable(state, 'P1', dodgeId)).toBe(false);
    });

    it('桃在不满血时可使用', () => {
      let state = setPlayPhase(createTestGame());
      // 曹操 maxHealth=4, 满血 → 不可用
      state = injectCard(state, 'P1', '桃');
      const peachId = findCardInHand(state, 'P1', '桃')!;
      expect(isCardPlayable(state, 'P1', peachId)).toBe(false);

      // 受伤后可用
      const p1 = state.players['P1'];
      const hurt = {
        ...state,
        players: {
          ...state.players,
          P1: { ...p1, health: 3 },
        },
      };
      expect(isCardPlayable(hurt, 'P1', peachId)).toBe(true);
    });

    it('装备牌总是可出', () => {
      let state = setPlayPhase(createTestGame());
      state = injectEquipCard(state, 'P1', '八卦阵', '防具');
      const armorId = state.players['P1'].hand.find(
        (id) => state.cardMap[id].name === '八卦阵',
      )!;
      expect(isCardPlayable(state, 'P1', armorId)).toBe(true);
    });
  });

  describe('isValidTarget', () => {
    it('杀不能以自己为目标', () => {
      let state = setPlayPhase(createTestGame());
      state = injectCard(state, 'P1', '杀');
      const killId = findCardInHand(state, 'P1', '杀')!;
      expect(isValidTarget(state, 'P1', killId, 'P1')).toBe(false);
    });

    it('桃以自己为目标', () => {
      let state = setPlayPhase(createTestGame());
      state = injectCard(state, 'P1', '桃');
      const peachId = findCardInHand(state, 'P1', '桃')!;
      expect(isValidTarget(state, 'P1', peachId, 'P1')).toBe(true);
    });

    it('死亡玩家不是合法目标', () => {
      let state = createTestGame();
      state = injectCard(state, 'P1', '杀');
      state = {
        ...state,
        players: {
          ...state.players,
          P2: {
            ...state.players['P2'],
            info: { ...state.players['P2'].info, alive: false },
          },
        },
      };
      const killId = findCardInHand(state, 'P1', '杀')!;
      expect(isValidTarget(state, 'P1', killId, 'P2')).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 验证系统缺口
// ════════════════════════════════════════════════════════════════

describe('验证系统缺口', () => {
  it('selectCard pending validation 无条件通过', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectCard(state, 'P1', '过河拆桥');
    const _cardId = findCardInHand(state, 'P1', '过河拆桥')!;
    const _step1 = computeValidActions(state, 'P1').find(a => a.type === 'playCard');
    // validatePendingAction 对 selectCard 返回 null，不做任何检查
    // engine 的 handler 层（resolveSelectCard）会检查 action type
  });

  it('顺手牵羊 validation 层缺少目标手牌检查', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectCard(state, 'P1', '顺手牵羊');
    const cardId = findCardInHand(state, 'P1', '顺手牵羊')!;
    state = { ...state, players: { ...state.players, P2: { ...state.players['P2'], hand: [] } } };
    const valid = isCardPlayable(state, 'P1', cardId);
    // isCardPlayable → hasValidTargetForTrick 只检查距离和存活，不检查手牌
    // handler 层会报 "目标没有手牌"
    expect(valid).toBe(true);
  });
});
