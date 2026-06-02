import { describe, it, expect } from 'vitest';
import { safeEngine as engine } from './invariants';
import { createInitialState } from '@engine/state';
import { serialize, deserialize } from '@engine/serializer';
import { getCharacterMap, createTestGame, setPlayPhase, setHealth } from './engine-helpers';

describe('V2 Engine - 核心引擎', () => {
  const charMap = getCharacterMap();

  describe('createInitialState', () => {
    it('创建有效初始状态', () => {
      const state = createTestGame({ playerCount: 2 });
      expect(Object.keys(state.players)).toHaveLength(2);
      expect(state.playerOrder).toEqual(['P1', 'P2']);
      expect(state.currentPlayer).toBe('P1');
      expect(state.zones.deck.length).toBeGreaterThan(0);
      expect(state.zones.discardPile).toEqual([]);
      expect(state.pending).toBeNull();
    });

    it('每个玩家有正确的初始手牌数', () => {
      const state = createTestGame({ playerCount: 3 });
      for (const name of state.playerOrder) {
        expect(state.players[name].hand).toHaveLength(4);
      }
    });

    it('角色属性正确设置', () => {
      const state = createTestGame({ characters: ['曹操', '刘备'] });
      const p1 = state.players['P1'];
      expect(p1.info.characterId).toBe('曹操');
      expect(p1.info.alive).toBe(true);
      expect(p1.info.faction).toBe('魏');
      expect(p1.info.gender).toBe('男');
      expect(p1.health).toBe(4);
      expect(p1.maxHealth).toBe(4);
    });

    it('相同种子产生相同状态', () => {
      const config = {
        players: [
          { name: 'A', characterId: '曹操', role: '主公' as const },
          { name: 'B', characterId: '刘备', role: '反贼' as const },
        ],
        seed: 12345,
        characterMap: charMap,
      };
      const s1 = createInitialState(config);
      const s2 = createInitialState(config);
      expect(s1.zones.deck).toEqual(s2.zones.deck);
      expect(s1.players['A'].hand).toEqual(s2.players['A'].hand);
    });

    it('cardMap 包含所有卡牌', () => {
      const state = createTestGame({ playerCount: 2 });
      const totalCards =
        state.zones.deck.length +
        state.zones.discardPile.length +
        state.playerOrder.reduce(
          (sum, name) => sum + state.players[name].hand.length,
          0,
        );
      expect(Object.keys(state.cardMap)).toHaveLength(totalCards);
    });
  });

  describe('engine 纯函数性质', () => {
    it('相同输入总是产生相同输出', () => {
      const state = setPlayPhase(createTestGame());
      const action = { type: 'endTurn' as const, player: state.currentPlayer };
      const r1 = engine(state, action);
      const r2 = engine(state, action);
      expect(r1.state.currentPlayer).toBe(r2.state.currentPlayer);
      expect(r1.error).toBe(r2.error);
    });

    it('不修改原始状态', () => {
      const state = setPlayPhase(createTestGame());
      const originalPlayer = state.currentPlayer;
      const originalPhase = state.phase;
      engine(state, { type: 'endTurn', player: state.currentPlayer });
      expect(state.currentPlayer).toBe(originalPlayer);
      expect(state.phase).toBe(originalPhase);
    });
  });

  describe('engine endTurn', () => {
    it('结束回合后切换到下一个玩家', () => {
      const state = setPlayPhase(createTestGame({ playerCount: 2 }));
      expect(state.currentPlayer).toBe('P1');
      const next = engine(state, { type: 'endTurn', player: 'P1' });
      expect(next.error).toBeUndefined();
      expect(next.state.currentPlayer).toBe('P2');
    });

    it('轮次循环：最后一个玩家后回到第一个', () => {
      const state = setPlayPhase(createTestGame({ playerCount: 2 }));
      const r1 = engine(state, { type: 'endTurn', player: 'P1' });
      expect(r1.state.currentPlayer).toBe('P2');
      // P2 摸牌阶段抽了 2 张，设高体力避免弃牌
      const p2HighHealth = setHealth(r1.state, 'P2', 10);
      const r2 = engine(
        { ...p2HighHealth, phase: '出牌' },
        { type: 'endTurn', player: 'P2' },
      );
      // 整轮完成，回到 P1
      expect(r2.state.currentPlayer).toBe('P1');
    });

    it('非当前玩家不能结束回合', () => {
      const state = setPlayPhase(createTestGame({ playerCount: 2 }));
      const result = engine(state, { type: 'endTurn', player: 'P2' });
      expect(result.error).toBeTruthy();
      expect(result.state).toBe(state);
    });
  });

  describe('序列化', () => {
    it('round-trip: serialize → deserialize 深度相等', () => {
      const state = setPlayPhase(createTestGame({ playerCount: 3 }));
      const json = serialize(state);
      const restored = deserialize(json);

      expect(restored.currentPlayer).toBe(state.currentPlayer);
      expect(restored.phase).toBe(state.phase);
      expect(restored.playerOrder).toEqual(state.playerOrder);
      expect(restored.zones.deck).toEqual(state.zones.deck);
      expect(Object.keys(restored.players)).toEqual(Object.keys(state.players));
      expect(restored.players['P1'].hand).toEqual(state.players['P1'].hand);
      expect(restored.rngState).toBe(state.rngState);
    });

    it('非法 JSON 抛出错误', () => {
      expect(() => deserialize('not valid json')).toThrow();
    });

    it('缺少必要字段抛出错误', () => {
      expect(() => deserialize('{}')).toThrow('Invalid GameState');
    });
  });

  describe('engine 错误处理', () => {
    it('不在出牌阶段不能出牌', () => {
      const state = createTestGame();
      // phase = '准备', not '出牌'
      const cardId = state.players['P1'].hand[0];
      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId,
      });
      expect(result.error).toBeTruthy();
    });

    it('不能出不在手牌中的牌', () => {
      const state = setPlayPhase(createTestGame());
      const result = engine(state, {
        type: 'playCard',
        player: 'P1',
        cardId: 'nonexistent-card',
      });
      expect(result.error).toBeTruthy();
    });

    it('弃牌操作在非弃牌阶段无效', () => {
      const state = setPlayPhase(createTestGame());
      const result = engine(state, {
        type: 'discard',
        player: 'P1',
        cardIds: [state.players['P1'].hand[0]],
      });
      expect(result.error).toBeTruthy();
    });

    it('响应动作在非响应窗口无效', () => {
      const state = setPlayPhase(createTestGame());
      const result = engine(state, {
        type: 'respond',
        player: 'P1',
      });
      expect(result.error).toBeTruthy();
    });
  });
});
