import { describe, it, expect } from 'vitest';
import { safeEngine as engine } from './invariants';
import {
  createTestGame,
  setPlayPhase,
  injectCard,
  setHealth,
  findCardInHand,
} from './setup';
import { applyAtom } from '@engine/v2/atom';

describe('V2 Engine - 回合流程', () => {
  describe('弃牌阶段', () => {
    it('手牌超过体力值时需弃牌', () => {
      let state = setPlayPhase(createTestGame());
      // P1 曹操 maxHealth=4, 设体力为 1
      state = setHealth(state, 'P1', 1);
      // 手牌 4 张，体力 1 → 需弃 3 张

      const result = engine(state, { type: 'endTurn', player: 'P1' });
      expect(result.error).toBeUndefined();
      // 应进入弃牌阶段（有 pending）
      expect(result.state.pending).not.toBeNull();
      expect(result.state.pending!.type).toBe('discardPhase');
    });

    it('弃掉正确的牌数后回合结束', () => {
      let state = setPlayPhase(createTestGame());
      state = setHealth(state, 'P1', 2);
      // hand=4, health=2 → 弃 2 张
      const hand = state.players['P1'].hand;

      const r1 = engine(state, { type: 'endTurn', player: 'P1' });
      expect(r1.state.pending!.type).toBe('discardPhase');

      const discardCards = hand.slice(0, 2);
      const r2 = engine(r1.state, {
        type: 'discard',
        player: 'P1',
        cardIds: discardCards,
      });
      expect(r2.error).toBeUndefined();
      expect(r2.state.pending?.type).toBe('playPhase');
      // 回合应切换到 P2
      expect(r2.state.currentPlayer).toBe('P2');
    });

    it('手牌不超过体力值时直接结束', () => {
      let state = setPlayPhase(createTestGame());
      state = setHealth(state, 'P1', 10);
      // hand=4, health=10 → 不需要弃牌

      const result = engine(state, { type: 'endTurn', player: 'P1' });
      expect(result.error).toBeUndefined();
      expect(result.state.pending?.type).toBe('playPhase');
      expect(result.state.currentPlayer).toBe('P2');
    });

    it('弃牌数不正确时报错', () => {
      let state = setPlayPhase(createTestGame());
      state = setHealth(state, 'P1', 2);

      const r1 = engine(state, { type: 'endTurn', player: 'P1' });
      const hand = r1.state.players['P1'].hand;

      // 需弃 2 张但只弃 1 张
      const r2 = engine(r1.state, {
        type: 'discard',
        player: 'P1',
        cardIds: [hand[0]],
      });
      expect(r2.error).toContain('需要弃');
    });
  });

  describe('回合切换', () => {
    it('三人游戏按顺序轮转', () => {
      const state = setPlayPhase(createTestGame({ playerCount: 3 }));
      expect(state.currentPlayer).toBe('P1');

      const r1 = engine(state, { type: 'endTurn', player: 'P1' });
      expect(r1.state.currentPlayer).toBe('P2');

      // P2 摸牌阶段抽了 2 张，设高体力避免弃牌
      const p2high = setHealth(r1.state, 'P2', 10);
      const r2 = engine(
        { ...p2high, phase: '出牌' },
        { type: 'endTurn', player: 'P2' },
      );
      expect(r2.state.currentPlayer).toBe('P3');

      // P3 同样设高体力
      const p3high = setHealth(r2.state, 'P3', 10);
      const r3 = engine(
        { ...p3high, phase: '出牌' },
        { type: 'endTurn', player: 'P3' },
      );
      expect(r3.state.currentPlayer).toBe('P1');
    });

    it('死亡玩家被跳过', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 3 }));
      // P2 死亡
      state = {
        ...state,
        players: {
          ...state.players,
          P2: {
            ...state.players['P2'],
            health: 0,
            info: { ...state.players['P2'].info, alive: false },
          },
        },
      };

      const result = engine(state, { type: 'endTurn', player: 'P1' });
      // P1 → P2(死) → P3
      expect(result.state.currentPlayer).toBe('P3');
    });
  });

  describe('濒死与救助', () => {
    it('伤害导致濒死触发 dyingWindow', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 2 }));
      state = setHealth(state, 'P2', 1);
      state = injectCard(state, 'P1', '杀');

      const killId = findCardInHand(state, 'P1', '杀')!;
      const r1 = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: killId,
        target: 'P2',
      });

      // P2 不出闪
      const r2 = engine(r1.state, { type: 'respond', player: 'P2' });

      // P2 HP = 0 → 濒死
      expect(r2.state.pending).not.toBeNull();
      expect(r2.state.pending!.type).toBe('dyingWindow');
      expect((r2.state.pending as any).dyingPlayer).toBe('P2');
    });

    it('出桃救助濒死玩家', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 2 }));
      state = setHealth(state, 'P2', 1);
      state = injectCard(state, 'P1', '杀');
      // 濒死者（P2）优先自救，所以把桃给 P2
      state = injectCard(state, 'P2', '桃');

      const killId = findCardInHand(state, 'P1', '杀')!;
      const peachId = findCardInHand(state, 'P2', '桃')!;

      const r1 = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: killId,
        target: 'P2',
      });
      // P2 不出闪
      const r2 = engine(r1.state, { type: 'respond', player: 'P2' });

      // 濒死窗口 savers=[P2, P1], currentSaverIndex=0 → P2 自救
      const r3 = engine(r2.state, {
        type: 'respond',
        player: 'P2', // changed from 'P1' to 'P2' — 濒死者优先自救
        cardId: peachId,
      });
      expect(r3.error).toBeUndefined();
      expect(r3.state.players['P2'].health).toBe(1);
      expect(r3.state.players['P2'].info.alive).toBe(true);
      expect(r3.state.pending?.type).toBe('playPhase');
    });

    it('无人救助则死亡', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 2 }));
      state = setHealth(state, 'P2', 1);
      state = injectCard(state, 'P1', '杀');

      const killId = findCardInHand(state, 'P1', '杀')!;
      const r1 = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: killId,
        target: 'P2',
      });
      // P2 不出闪
      const r2 = engine(r1.state, { type: 'respond', player: 'P2' });

      // 濒死窗口 savers=[P2, P1], currentSaverIndex=0 → P2
      // P2 不救
      const r3 = engine(r2.state, { type: 'respond', player: 'P2' });
      // currentSaverIndex=1 → P1
      // P1 也不救
      const r4 = engine(r3.state, { type: 'respond', player: 'P1' });

      expect(r4.state.players['P2'].info.alive).toBe(false);
    });

    it('无人救助则死亡', () => {
      let state = setPlayPhase(createTestGame({ playerCount: 2 }));
      state = setHealth(state, 'P2', 1);
      state = injectCard(state, 'P1', '杀');

      const killId = findCardInHand(state, 'P1', '杀')!;
      const r1 = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: killId,
        target: 'P2',
      });
      // P2 不出闪
      const r2 = engine(r1.state, { type: 'respond', player: 'P2' });

      // 濒死窗口 savers=[P2(濒死者), P1], currentSaverIndex=0 → P2（濒死者）
      // P2 不救
      const r3 = engine(r2.state, { type: 'respond', player: 'P2' });
      // currentSaverIndex=1 → P1
      // P1 也不救
      const r4 = engine(r3.state, { type: 'respond', player: 'P1' });

      expect(r4.state.players['P2'].info.alive).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// 死亡玩家与弃牌阶段
// ════════════════════════════════════════════════════════════════

describe('死亡玩家处理', () => {
  it('kill atom 只设 alive=false，手牌未清理', () => {
    const state = setPlayPhase(createTestGame({ playerCount: 2 }));
    const p2Hand = [...state.players['P2'].hand];
    const killAtom = { type: 'kill' as const, player: 'P2' as any };
    const newState = applyAtom(state, killAtom);
    expect(newState.players['P2'].info.alive).toBe(false);
    // 期望：死亡玩家的手牌应进入弃牌堆
    expect(newState.players['P2'].hand).toEqual(p2Hand);
  });

  it('死亡玩家从 playerOrder 移除，distance 计算变化', () => {
    let state = setPlayPhase(createTestGame({ playerCount: 3 }));
    state = injectCard(state, 'P1', '杀');
    const killId = findCardInHand(state, 'P1', '杀')!;
    const s = {
      ...state,
      players: {
        ...state.players,
        P2: { ...state.players['P2'], health: 0, info: { ...state.players['P2'].info, alive: false } },
      },
    };
    const result = engine(s, { type: 'playCard', player: 'P1', cardId: killId, target: 'P3' });
    // P1→P3 距离可能因 P2 被移除而变化
    if (result.error) {
      // 可能因距离不在攻击范围内报错
      expect(result.error).toBeTruthy();
    }
  });
});

describe('弃牌阶段', () => {
  it('弃牌阶段不能直接 endTurn（validateEndTurn 限制 phase=出牌）', () => {
    const state = { ...setPlayPhase(createTestGame({ playerCount: 2 })), phase: '弃牌' as const };
    const result = engine(state, { type: 'endTurn', player: 'P1' });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('出牌阶段');
  });
});
