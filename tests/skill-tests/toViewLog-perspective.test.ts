// tests/skill-tests/toViewLog-perspective.test.ts
// 验证 toViewLog 的视角区分：
//   1. 自己摸牌：日志展示具体牌面（花色点数+牌名）
//   2. 他人摸牌：日志只展示数量
//   3. 弃置：公开信息，展示牌名
//   4. 获得/给予：owner 视角展示牌名，others 不展示
//   5. GameLog 「（我）」标志由渲染层处理，这里只验证 log.player 正确
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms';
import { getAtomDef } from '../../src/engine/atom';
import type { ViewEvent, Card } from '../../src/engine/types';

const CARD_KILL: Card = { id: 'c1', name: '杀', suit: '♠', rank: '7', type: '基本牌' };
const CARD_DODGE: Card = { id: 'c2', name: '闪', suit: '♥', rank: 'J', type: '基本牌' };
const CARD_PEACH: Card = { id: 'c3', name: '桃', suit: '♦', rank: '3', type: '基本牌' };

describe('toViewLog 视角区分', () => {
  describe('摸牌', () => {
    const def = getAtomDef('摸牌');

    it('自己摸牌(owner视角)展示具体牌面', () => {
      // ownerView 带 cards 字段
      const ownerEvent: ViewEvent = {
        type: '摸牌',
        player: 0,
        count: 2,
        cards: [CARD_KILL, CARD_DODGE],
      };
      const log = def.toViewLog!(ownerEvent, 0);
      expect(log).not.toBeNull();
      expect(log!.player).toBe(0);
      expect(log!.text).toBe('摸了 2 张牌：♠7杀、♥J闪');
    });

    it('他人摸牌(others视角)只展示数量', () => {
      // othersView 不带 cards 字段
      const othersEvent: ViewEvent = {
        type: '摸牌',
        player: 1,
        count: 2,
      };
      const log = def.toViewLog!(othersEvent, 0);
      expect(log).not.toBeNull();
      expect(log!.player).toBe(1);
      expect(log!.text).toBe('摸了 2 张牌');
      expect(log!.text).not.toContain('杀');
    });
  });

  describe('弃置', () => {
    const def = getAtomDef('弃置');

    it('弃置展示牌名(公开信息)', () => {
      const event: ViewEvent = {
        type: '弃置',
        player: 0,
        cardIds: ['c1', 'c2'],
        zones: { c1: 'hand', c2: 'hand' },
        cardNames: ['杀', '闪'],
      };
      const log = def.toViewLog!(event, 0)!;
      expect(log.text).toBe('弃置了 2 张牌：杀、闪');
    });

    it('弃置无牌名时降级为数量', () => {
      const event: ViewEvent = {
        type: '弃置',
        player: 0,
        cardIds: ['c1'],
        zones: { c1: 'hand' },
      };
      const log = def.toViewLog!(event, 0)!;
      expect(log.text).toBe('弃置了 1 张牌');
    });
  });

  describe('获得', () => {
    const def = getAtomDef('获得');

    it('获得者自己(owner视角)看到牌名', () => {
      const ownerEvent: ViewEvent = {
        type: '获得',
        player: 0,
        cardId: 'c3',
        cardName: '桃',
        from: 1,
        fromZone: 'hand',
      };
      const log = def.toViewLog!(ownerEvent, 0)!;
      expect(log.text).toContain('桃');
      expect(log.text).toContain('P1');
    });

    it('第三方(others视角)不看到牌名', () => {
      const othersEvent: ViewEvent = {
        type: '获得',
        player: 0,
        from: 1,
        fromZone: 'hand',
      };
      const log = def.toViewLog!(othersEvent, 2)!;
      expect(log.text).not.toContain('桃');
      expect(log.text).toContain('获得');
    });
  });

  describe('给予', () => {
    const def = getAtomDef('给予');

    it('给予双方(owner视角)看到牌名', () => {
      const ownerEvent: ViewEvent = {
        type: '给予',
        cardId: 'c3',
        cardName: '桃',
        from: 0,
        to: 1,
      };
      // from 视角
      const logFrom = def.toViewLog!(ownerEvent, 0)!;
      expect(logFrom.player).toBe(0);
      expect(logFrom.text).toContain('桃');
      // to 视角
      const logTo = def.toViewLog!(ownerEvent, 1)!;
      expect(logTo.text).toContain('桃');
    });

    it('第三方(others视角)不看到牌名', () => {
      const othersEvent: ViewEvent = {
        type: '给予',
        from: 0,
        to: 1,
      };
      const log = def.toViewLog!(othersEvent, 2)!;
      expect(log.text).not.toContain('桃');
    });
  });

  describe('造成伤害', () => {
    const def = getAtomDef('造成伤害');

    it('日志包含伤害目标', () => {
      const event: ViewEvent = {
        type: '造成伤害',
        target: 1,
        amount: 2,
        source: 0,
      };
      const log = def.toViewLog!(event, 0)!;
      expect(log.player).toBe(0);
      expect(log.text).toContain('P1');
      expect(log.text).toContain('2');
    });
  });

  describe('判定', () => {
    const def = getAtomDef('判定');

    it('带 card 时展示花色点数+牌名(公开信息)', () => {
      const event: ViewEvent = {
        type: '判定',
        player: 0,
        judgeType: '乐不思蜀',
        cardId: 'j1',
        card: { name: '杀', suit: '♠', rank: '7' } as Card,
      };
      const log = def.toViewLog!(event, 0)!;
      expect(log.player).toBe(0);
      expect(log.text).toContain('乐不思蜀');
      expect(log.text).toContain('♠');
      expect(log.text).toContain('7');
      expect(log.text).toContain('杀');
    });

    it('所有视角都看到判定牌信息(判定牌为公开信息)', () => {
      const event: ViewEvent = {
        type: '判定',
        player: 1,
        judgeType: '闪电',
        cardId: 'j1',
        card: { name: '桃', suit: '♥', rank: '3' } as Card,
      };
      // P0 视角看 P1 的判定
      const log0 = def.toViewLog!(event, 0)!;
      expect(log0.text).toContain('♥');
      expect(log0.text).toContain('桃');
      // P2 视角看 P1 的判定
      const log2 = def.toViewLog!(event, 2)!;
      expect(log2.text).toContain('♥');
      expect(log2.text).toContain('桃');
    });

    it('无 card 时降级为仅 judgeType', () => {
      const event: ViewEvent = {
        type: '判定',
        player: 0,
        judgeType: '八卦阵',
      };
      const log = def.toViewLog!(event, 0)!;
      expect(log.text).toBe('判定(八卦阵)');
      expect(log.text).not.toContain('♠');
    });
  });
});
