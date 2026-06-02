/**
 * tests/skill-conversion.test.ts — 技能卡牌转换验证
 *
 * 验证 `validateResponseWindow`、`isCardValidResponse` 在 killResponse/duelResponse
 * 中正确处理技能转换（倾国/龙胆/武圣）。
 *
 * 回归测试：防止 validateResponseWindow 只检查字面卡名而忽略技能转换。
 */
import { describe, it, expect } from 'vitest';
import {
  isCardValidResponse,
  validateAction,
  getSkillConvertedCards,
} from '@engine/validate';
import { registerCharacterTriggers } from '@engine/skill';
import {
  createTestGame,
  getCharacterMap,
  setPlayPhase,
} from './engine-helpers';

const charMap = getCharacterMap();

function injectCardWithSuit(
  state: ReturnType<typeof createTestGame>,
  playerName: string,
  cardName: '杀' | '闪' | '桃',
  suit: '♠' | '♣' | '♥' | '♦',
): { state: ReturnType<typeof createTestGame>; cardId: string } {
  const cardId = `test-${cardName}-${suit}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const card = {
    id: cardId,
    name: cardName,
    type: '基本牌' as const,
    subtype: cardName,
    suit,
    rank: 'A' as const,
    description: '',
  };
  const cardMap = { ...state.cardMap, [cardId]: card };
  const player = state.players[playerName];
  const players = {
    ...state.players,
    [playerName]: { ...player, hand: [...player.hand, cardId] },
  };
  return { state: { ...state, cardMap, players }, cardId };
}

function makeKillResponsePending(defender: string, validCards: string[] = []) {
  return {
    type: 'responseWindow' as const,
    window: {
      type: 'killResponse' as const,
      attacker: 'P1',
      defender,
      validCards,
      sourceCard: 'test-kill-1',
      timeout: 15000,
      deadline: Date.now() + 15000,
    },
    timeout: 15000,
    deadline: Date.now() + 15000,
    onTimeout: { type: 'respond' as const, player: defender },
  };
}

function makeDuelResponsePending(defender: string, validCards: string[] = []) {
  return {
    type: 'responseWindow' as const,
    window: {
      type: 'duelResponse' as const,
      attacker: 'P1',
      defender,
      validCards,
      sourceCard: 'test-duel-1',
      timeout: 15000,
      deadline: Date.now() + 15000,
    },
    timeout: 15000,
    deadline: Date.now() + 15000,
    onTimeout: { type: 'respond' as const, player: defender },
  };
}

describe('技能卡牌转换', () => {
  describe('isCardValidResponse', () => {
    it('龙胆：杀可作为闪响应 killResponse', () => {
      let state = createTestGame({ characters: ['赵云', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '杀', '♠');
      state = r.state;
      const killId = r.cardId;

      expect(isCardValidResponse(state, killId, 'killResponse', 'P1')).toBe(true);
    });

    it('倾国：黑色手牌可作为闪响应 killResponse', () => {
      let state = createTestGame({ characters: ['甄姬', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '杀', '♠');
      state = r.state;
      const blackKillId = r.cardId;

      expect(isCardValidResponse(state, blackKillId, 'killResponse', 'P1')).toBe(true);
    });

    it('倾国：红色手牌不能作为闪响应', () => {
      let state = createTestGame({ characters: ['甄姬', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '杀', '♥');
      state = r.state;
      const redKillId = r.cardId;

      expect(isCardValidResponse(state, redKillId, 'killResponse', 'P1')).toBe(false);
    });

    it('武圣：红色手牌可作为杀响应 duelResponse', () => {
      let state = createTestGame({ characters: ['关羽', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '闪', '♥');
      state = r.state;
      const redDodgeId = r.cardId;

      expect(isCardValidResponse(state, redDodgeId, 'duelResponse', 'P1')).toBe(true);
    });

    it('龙胆：闪可作为杀响应 duelResponse', () => {
      let state = createTestGame({ characters: ['赵云', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '闪', '♠');
      state = r.state;
      const dodgeId = r.cardId;

      expect(isCardValidResponse(state, dodgeId, 'duelResponse', 'P1')).toBe(true);
    });
  });

  describe('validateAction 在响应窗口中允许技能转换', () => {
    it('killResponse：龙胆转换的杀应当通过验证', () => {
      let state = createTestGame({ characters: ['赵云', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '杀', '♠');
      state = r.state;
      const killAsDodge = r.cardId;
      state = { ...state, pending: makeKillResponsePending('P1') };

      const result = validateAction(state, {
        type: 'respond',
        player: 'P1',
        cardId: killAsDodge,
      });
      expect(result).toBeNull();
    });

    it('killResponse：倾国转换的黑色杀应当通过验证', () => {
      let state = createTestGame({ characters: ['甄姬', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '杀', '♠');
      state = r.state;
      const blackKill = r.cardId;
      state = { ...state, pending: makeKillResponsePending('P1') };

      const result = validateAction(state, {
        type: 'respond',
        player: 'P1',
        cardId: blackKill,
      });
      expect(result).toBeNull();
    });

    it('killResponse：非技能转换的非闪牌仍应被拒绝', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '杀', '♥');
      state = r.state;
      const redKill = r.cardId;
      state = { ...state, pending: makeKillResponsePending('P1') };

      const result = validateAction(state, {
        type: 'respond',
        player: 'P1',
        cardId: redKill,
      });
      expect(result).toBe('只能用闪响应杀');
    });

    it('duelResponse：武圣转换的红色闪应当通过验证', () => {
      let state = createTestGame({ characters: ['关羽', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '闪', '♥');
      state = r.state;
      const redDodge = r.cardId;
      state = { ...state, pending: makeDuelResponsePending('P1') };

      const result = validateAction(state, {
        type: 'respond',
        player: 'P1',
        cardId: redDodge,
      });
      expect(result).toBeNull();
    });

    it('duelResponse：龙胆转换的闪应当通过验证', () => {
      let state = createTestGame({ characters: ['赵云', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '闪', '♠');
      state = r.state;
      const dodge = r.cardId;
      state = { ...state, pending: makeDuelResponsePending('P1') };

      const result = validateAction(state, {
        type: 'respond',
        player: 'P1',
        cardId: dodge,
      });
      expect(result).toBeNull();
    });

    it('duelResponse：桃不能作为杀响应', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '桃', '♠');
      state = r.state;
      const peach = r.cardId;
      state = { ...state, pending: makeDuelResponsePending('P1') };

      const result = validateAction(state, {
        type: 'respond',
        player: 'P1',
        cardId: peach,
      });
      expect(result).toBe('只能用杀响应决斗');
    });
  });

  describe('getSkillConvertedCards', () => {
    it('列出所有可通过技能转换为闪的手牌', () => {
      let state = createTestGame({ characters: ['甄姬', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r1 = injectCardWithSuit(state, 'P1', '杀', '♠');
      state = r1.state;
      const r2 = injectCardWithSuit(state, 'P1', '杀', '♥');
      state = r2.state;

      const converted = getSkillConvertedCards(state, 'P1', '闪');
      expect(converted).toContain(r1.cardId);
      expect(converted).not.toContain(r2.cardId);
    });

    it('列出所有可通过技能转换为杀的手牌', () => {
      let state = createTestGame({ characters: ['关羽', '曹操'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r1 = injectCardWithSuit(state, 'P1', '闪', '♥');
      state = r1.state;
      const r2 = injectCardWithSuit(state, 'P1', '闪', '♠');
      state = r2.state;

      const converted = getSkillConvertedCards(state, 'P1', '杀');
      expect(converted).toContain(r1.cardId);
      expect(converted).not.toContain(r2.cardId);
    });
  });

  describe('isCardValidResponse 边界条件', () => {
    it('没有对应技能时返回 false', () => {
      let state = createTestGame({ characters: ['曹操', '刘备'] });
      state = registerCharacterTriggers(state, 'P1', { characterMap: charMap });
      const r = injectCardWithSuit(state, 'P1', '杀', '♠');
      state = r.state;
      const killId = r.cardId;

      expect(isCardValidResponse(state, killId, 'killResponse', 'P1')).toBe(false);
    });

    it('卡牌不存在时返回 false', () => {
      const state = setPlayPhase(createTestGame());
      expect(isCardValidResponse(state, 'nonexistent', 'killResponse', 'P1')).toBe(false);
    });
  });
});
