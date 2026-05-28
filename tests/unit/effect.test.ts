// tests/unit/效果.test.ts
import { describe, it, expect } from 'vitest';
import {
  useKill, usePeach,
  useDismantle, useSteal, useDrawTwo, useDuel,
  useArrowBarrage, useBarbarianInvasion, usePeachGarden, useAbundance,
} from '@engine/effect';
import { 创建游戏 } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';

describe('卡牌效果', () => {
  describe('useKill', () => {
    it('应该对目标造成1点伤害', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      游戏.currentPlayer = '曹操';

      const 结果 = useKill(游戏, '曹操', '刘备');
      expect(结果.success).toBe(true);
      const 刘备玩家 = 结果.status.players.find(p => p.name === '刘备')!;
      expect(刘备玩家.health).toBe(3);
    });

    it('不能对自己使用杀', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';

      const 结果 = useKill(游戏, '曹操', '曹操');
      expect(结果.success).toBe(false);
    });
  });

  describe('usePeach', () => {
    it('应该恢复1点体力', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      游戏.currentPlayer = '曹操';
      游戏.players[0].health = 3;

      const 结果 = usePeach(游戏, '曹操');
      expect(结果.success).toBe(true);
      expect(结果.status.players[0].health).toBe(4);
    });

    it('不能超过体力上限', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      游戏.currentPlayer = '曹操';
      // 曹操体力已满 (4/4)

      const 结果 = usePeach(游戏, '曹操');
      expect(结果.success).toBe(false);
    });
  });

  describe('useDismantle', () => {
    it('应该弃置目标一张手牌', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      游戏.currentPlayer = '曹操';
      游戏.players[1].hand = [
        { name: '杀', type: '基本牌', 子type: '杀', suit: '♠', rank: '3', description: '' },
      ];

      const 结果 = useDismantle(游戏, '曹操', '刘备');
      expect(结果.success).toBe(true);
      const 刘备玩家 = 结果.status.players.find(p => p.name === '刘备')!;
      expect(刘备玩家.hand.length).toBe(0);
      expect(结果.status.discardPile.length).toBe(1);
    });

    it('目标没有手牌时失败', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      // 刘备没有手牌

      const 结果 = useDismantle(游戏, '曹操', '刘备');
      expect(结果.success).toBe(false);
    });

    it('不能对自己使用', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      const 结果 = useDismantle(游戏, '曹操', '曹操');
      expect(结果.success).toBe(false);
    });
  });

  describe('useSteal', () => {
    it('应该从目标获得一张手牌', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      游戏.currentPlayer = '曹操';
      游戏.players[1].hand = [
        { name: '闪', type: '基本牌', 子type: '闪', suit: '♥', rank: '3', description: '' },
      ];

      const 结果 = useSteal(游戏, '曹操', '刘备');
      expect(结果.success).toBe(true);
      const 刘备玩家 = 结果.status.players.find(p => p.name === '刘备')!;
      const 曹操玩家 = 结果.status.players.find(p => p.name === '曹操')!;
      expect(刘备玩家.hand.length).toBe(0);
      expect(曹操玩家.hand.length).toBe(1);
    });

    it('目标没有牌时失败', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';

      const 结果 = useSteal(游戏, '曹操', '刘备');
      expect(结果.success).toBe(false);
    });
  });

  describe('useDrawTwo', () => {
    it('应该摸2张牌', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      const 牌堆大小 = 游戏.deck.length;

      const 结果 = useDrawTwo(游戏, '曹操');
      expect(结果.success).toBe(true);
      const 曹操玩家 = 结果.status.players.find(p => p.name === '曹操')!;
      expect(曹操玩家.hand.length).toBe(2);
      expect(结果.status.deck.length).toBe(牌堆大小 - 2);
    });

    it('牌堆不足时失败', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      游戏.deck = [];

      const 结果 = useDrawTwo(游戏, '曹操');
      expect(结果.success).toBe(false);
    });
  });

  describe('useDuel', () => {
    it('应该对目标造成1点伤害', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';

      const 结果 = useDuel(游戏, '曹操', '刘备');
      expect(结果.success).toBe(true);
      const 刘备玩家 = 结果.status.players.find(p => p.name === '刘备')!;
      expect(刘备玩家.health).toBe(3);
    });

    it('不能对自己使用', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      const 结果 = useDuel(游戏, '曹操', '曹操');
      expect(结果.success).toBe(false);
    });
  });

  describe('useArrowBarrage', () => {
    it('应该对所有其他存活玩家造成1点伤害', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';

      const 结果 = useArrowBarrage(游戏, '曹操');
      expect(结果.success).toBe(true);
      const 曹操玩家 = 结果.status.players.find(p => p.name === '曹操')!;
      const 刘备玩家 = 结果.status.players.find(p => p.name === '刘备')!;
      expect(曹操玩家.health).toBe(4); // 使用者不受伤害
      expect(刘备玩家.health).toBe(3); // 目标受伤
    });
  });

  describe('useBarbarianInvasion', () => {
    it('应该对所有其他存活玩家造成1点伤害', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';

      const 结果 = useBarbarianInvasion(游戏, '曹操');
      expect(结果.success).toBe(true);
      const 曹操玩家 = 结果.status.players.find(p => p.name === '曹操')!;
      const 刘备玩家 = 结果.status.players.find(p => p.name === '刘备')!;
      expect(曹操玩家.health).toBe(4);
      expect(刘备玩家.health).toBe(3);
    });
  });

  describe('usePeachGarden', () => {
    it('应该恢复所有存活玩家1点体力', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      游戏.players[0].health = 3;
      游戏.players[1].health = 2;

      const 结果 = usePeachGarden(游戏, '曹操');
      expect(结果.success).toBe(true);
      const 曹操玩家 = 结果.status.players.find(p => p.name === '曹操')!;
      const 刘备玩家 = 结果.status.players.find(p => p.name === '刘备')!;
      expect(曹操玩家.health).toBe(4);
      expect(刘备玩家.health).toBe(3);
    });

    it('不能超过体力上限', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      // 两人体力都已满

      const 结果 = usePeachGarden(游戏, '曹操');
      expect(结果.success).toBe(false);
    });
  });

  describe('useAbundance', () => {
    it('应该让每名存活玩家摸1张牌', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      const 牌堆大小 = 游戏.deck.length;

      const 结果 = useAbundance(游戏, '曹操');
      expect(结果.success).toBe(true);
      const 曹操玩家 = 结果.status.players.find(p => p.name === '曹操')!;
      const 刘备玩家 = 结果.status.players.find(p => p.name === '刘备')!;
      expect(曹操玩家.hand.length).toBe(1);
      expect(刘备玩家.hand.length).toBe(1);
      expect(结果.status.deck.length).toBe(牌堆大小 - 2);
    });

    it('牌堆不足时失败', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.status = '进行中';
      游戏.deck = [{ name: '杀', type: '基本牌', 子type: '杀', suit: '♠', rank: '3', description: '' }];

      const 结果 = useAbundance(游戏, '曹操');
      expect(结果.success).toBe(false);
    });
  });
});
