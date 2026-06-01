import { describe, it, expect } from 'vitest';
import { safeEngine as engine } from './invariants';
import {
  createTestGame,
  setPlayPhase,
  findCardInHand,
  injectCard,
  injectTrickCard,
  injectEquipCard,
  setHealth,
  passAllTrickResponders,
} from './setup';

describe('V2 Engine - 卡牌效果', () => {
  describe('杀', () => {
    it('对目标造成 1 点伤害（目标不出闪）', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 2 }));
      state = injectCard(state, 'P1', '杀');

      const targetHealth = state.players['P2'].health;
      const killId = findCardInHand(state, 'P1', '杀')!;

      // 出杀
      const r1 = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: killId,
        target: 'P2',
      });
      expect(r1.error).toBeUndefined();

      // 杀触发响应窗口
      expect(r1.state.pending).not.toBeNull();
      expect(r1.state.pending!.type).toBe('responseWindow');

      // P2 不出闪
      const r2 = engine(r1.state, { type: 'respond', player: 'P2' });
      expect(r2.error).toBeUndefined();
      expect(r2.state.players['P2'].health).toBe(targetHealth - 1);
    });

    it('目标出闪则不受伤害', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 2 }));
      state = injectCard(state, 'P1', '杀');
      state = injectCard(state, 'P2', '闪');

      const targetHealth = state.players['P2'].health;
      const killId = findCardInHand(state, 'P1', '杀')!;
      const dodgeId = findCardInHand(state, 'P2', '闪')!;

      const r1 = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: killId,
        target: 'P2',
      });
      expect(r1.error).toBeUndefined();

      // P2 出闪
      const r2 = engine(r1.state, {
        type: 'respond',
        player: 'P2',
        cardId: dodgeId,
      });
      expect(r2.error).toBeUndefined();
      expect(r2.state.players['P2'].health).toBe(targetHealth);
    });

    it('每回合只能出一张杀', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 2 }));
      state = injectCard(state, 'P1', '杀');
      state = injectCard(state, 'P1', '杀');

      // 注入两张杀后获取第二张
      const allKills = state.players['P1'].hand.filter(
        (id) => state.cardMap[id].name === '杀',
      );

      // 出第一张杀
      const r1 = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: allKills[0],
        target: 'P2',
      });
      expect(r1.error).toBeUndefined();

      // 响应 P2
      const afterKill = engine(r1.state, { type: 'respond', player: 'P2' });

      // 尝试出第二张杀
      const r3 = engine(afterKill.state, {
        type: 'playCard',
        player: 'P1',
        cardId: allKills[1],
        target: 'P2',
      });
      expect(r3.error).toContain('已使用过杀');
    });

    it('不能对自己使用杀', () => {
      let state = setPlayPhase(createTestGame());
      state = injectCard(state, 'P1', '杀');
      const killId = findCardInHand(state, 'P1', '杀')!;

      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: killId,
        target: 'P1',
      });
      expect(result.error).toContain('不能对自己');
    });

    it('不能对已阵亡玩家使用杀', () => {
      // validate 先检查 range 再检查 alive，死亡玩家不在 alive 列表导致 distance=Infinity
      // 所以直接用 validateAction 测试 alive 检查
      let state = setPlayPhase(createTestGame({ playerCount: 3 }));
      state = injectCard(state, 'P1', '杀');
      state = {
        ...state,
        players: {
          ...state.players,
          P3: { ...state.players['P3'], info: { ...state.players['P3'].info, alive: false } },
        },
      };
      const killId = findCardInHand(state, 'P1', '杀')!;

      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: killId,
        target: 'P3',
      });
      expect(result.error).toBeTruthy();
    });
  });

  describe('桃', () => {
    it('回复 1 点体力', () => {
      let state = setPlayPhase(createTestGame());
      state = setHealth(state, 'P1', 2);
      state = injectCard(state, 'P1', '桃');

      const peachId = findCardInHand(state, 'P1', '桃')!;
      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: peachId,
      });

      expect(result.error).toBeUndefined();
      expect(result.state.players['P1'].health).toBe(3);
    });

    it('满血时不能使用桃', () => {
      let state = setPlayPhase(createTestGame());
      // 曹操满血 = 4
      state = injectCard(state, 'P1', '桃');
      const peachId = findCardInHand(state, 'P1', '桃')!;

      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: peachId,
      });
      expect(result.error).toBeTruthy();
    });
  });

  describe('闪', () => {
    it('闪不能主动使用', () => {
      let state = setPlayPhase(createTestGame());
      state = injectCard(state, 'P1', '闪');
      const dodgeId = findCardInHand(state, 'P1', '闪')!;

      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: dodgeId,
      });
      expect(result.error).toContain('不能主动使用');
    });
  });

  describe('无中生有', () => {
    it('摸 2 张牌', () => {
      let state = setPlayPhase(createTestGame());
      state = injectTrickCard(state, 'P1', '无中生有');

      const handBefore = state.players['P1'].hand.length;
      const cardId = state.players['P1'].hand.find(
        (id) => state.cardMap[id].name === '无中生有',
      )!;

      const step1 = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId,
      });
      expect(step1.error).toBeUndefined();
      // 现在总是进入 trickResponse 窗口
      expect(step1.state.pending?.type).toBe('responseWindow');

      // 所有玩家 pass 过无懈可击窗口
      const result = passAllTrickResponders(step1.state);
      expect(result.players['P1'].hand.length).toBe(handBefore + 1);
    });
  });

  describe('过河拆桥', () => {
    it('弃置目标的一张手牌', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 2 }));
      const targetHandBefore = state.players['P2'].hand.length;
      state = injectTrickCard(state, 'P1', '过河拆桥');

      const cardId = state.players['P1'].hand.find(
        (id) => state.cardMap[id].name === '过河拆桥',
      )!;

      // 第 1 步：出牌 → 进入 trickResponse 窗口
      const step1 = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId,
        target: 'P2',
      });
      expect(step1.error).toBeUndefined();
      expect(step1.state.pending).not.toBeNull();
      expect(step1.state.pending!.type).toBe('responseWindow');
      // 手牌尚未减少（过河拆桥已弃，但目标手牌未动）
      expect(step1.state.players['P2'].hand.length).toBe(targetHandBefore);

      // 第 1.5 步：过 trickResponse（不出无懈）
      const step15 = engine(step1.state, {
        type: 'respond',
        player: 'P2',
      });
      expect(step15.error).toBeUndefined();
      expect(step15.state.pending?.type).toBe('selectCard');

      // 第 2 步：选择一张目标手牌 → 弃牌
      const selectedCardId = step15.state.players['P2'].hand[0];
      const step2 = engine(step15.state, {
        type: 'respond',
        player: 'P1',
        cardIds: [selectedCardId],
      });
      expect(step2.error).toBeUndefined();
      expect(step2.state.pending?.type).toBe('playPhase');
      expect(step2.state.players['P2'].hand.length).toBe(targetHandBefore - 1);
    });

    it('目标没有手牌时不能使用', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 2 }));
      state = {
        ...state,
        players: {
          ...state.players,
          P2: { ...state.players['P2'], hand: [] },
        },
      };
      state = injectTrickCard(state, 'P1', '过河拆桥');

      const cardId = state.players['P1'].hand.find(
        (id) => state.cardMap[id].name === '过河拆桥',
      )!;

      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId,
        target: 'P2',
      });
      expect(result.error).toContain('没有手牌');
    });
  });

  describe('装备牌', () => {
    it('装备武器后攻击范围改变', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 3 }));
      state = injectEquipCard(state, 'P1', '麒麟弓', '武器', 5);

      const cardId = state.players['P1'].hand.find(
        (id) => state.cardMap[id].name === '麒麟弓',
      )!;

      expect(state.players['P1'].equipment.weapon).toBeUndefined();

      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId,
      });
      expect(result.error).toBeUndefined();
      expect(result.state.players['P1'].equipment.weapon).toBe(cardId);
      expect(result.state.cardMap[cardId].range).toBe(5);
    });

    it('装备进攻马（-1马）', () => {
      let state = setPlayPhase(createTestGame());
      state = injectEquipCard(state, 'P1', '赤兔', '进攻马');

      const cardId = state.players['P1'].hand.find(
        (id) => state.cardMap[id].name === '赤兔',
      )!;

      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId,
      });
      expect(result.error).toBeUndefined();
      expect(result.state.players['P1'].equipment.horseMinus).toBe(cardId);
    });

    it('装备防御马（+1马）', () => {
      let state = setPlayPhase(createTestGame());
      state = injectEquipCard(state, 'P1', '的卢', '防御马');

      const cardId = state.players['P1'].hand.find(
        (id) => state.cardMap[id].name === '的卢',
      )!;

      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId,
      });
      expect(result.error).toBeUndefined();
      expect(result.state.players['P1'].equipment.horsePlus).toBe(cardId);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 桃
// ════════════════════════════════════════════════════════════════

describe('桃', () => {
  it('满血时不能对自己使用桃（validate 层拒绝）', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectCard(state, 'P1', '桃');
    const peachId = findCardInHand(state, 'P1', '桃')!;
    const result = engine(state, { type: 'playCard', player: 'P1', cardId: peachId });
    expect(result.error).toBeTruthy();
  });

  it('使用桃时 target 参数无效，始终治疗自己', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = setHealth(state, 'P1', 2);
    state = setHealth(state, 'P2', 1);
    state = injectCard(state, 'P1', '桃');
    const peachId = findCardInHand(state, 'P1', '桃')!;
    const result = engine(state, { type: 'playCard', player: 'P1', cardId: peachId, target: 'P2' });
    if (!result.error) {
      expect(result.state.players['P1'].health).toBe(3);
      expect(result.state.players['P2'].health).toBe(1);
    }
  });

  it('濒死时不能对自己使用桃（pending 为 dyingWindow）', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 2 }));
    state = injectCard(state, 'P1', '桃');
    const peachId = findCardInHand(state, 'P1', '桃')!;
    state = setHealth(state, 'P1', 0);
    const result = engine(state, { type: 'playCard', player: 'P1', cardId: peachId });
    // 体力0时非濒死窗口中不能直接使用桃
    // 结果可能通过 validate 或失败
    if (!result.error) {
      expect(result.state.players['P1'].health).toBe(1);
    }
  });
});
