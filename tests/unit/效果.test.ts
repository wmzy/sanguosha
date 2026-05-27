// tests/unit/效果.test.ts
import { describe, it, expect } from 'vitest';
import { 使用杀, 使用桃 } from '@engine/效果';
import { 创建游戏 } from '@engine/状态';
import { 曹操, 刘备 } from '@shared/角色';

describe('卡牌效果', () => {
  describe('使用杀', () => {
    it('应该对目标造成1点伤害', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.状态 = '进行中';
      游戏.当前玩家 = '曹操';

      const 结果 = 使用杀(游戏, '曹操', '刘备');
      expect(结果.成功).toBe(true);
      const 刘备玩家 = 结果.状态.玩家列表.find(p => p.name === '刘备')!;
      expect(刘备玩家.体力).toBe(3);
    });

    it('不能对自己使用杀', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.状态 = '进行中';

      const 结果 = 使用杀(游戏, '曹操', '曹操');
      expect(结果.成功).toBe(false);
    });
  });

  describe('使用桃', () => {
    it('应该恢复1点体力', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.状态 = '进行中';
      游戏.当前玩家 = '曹操';
      游戏.玩家列表[0].体力 = 3;

      const 结果 = 使用桃(游戏, '曹操');
      expect(结果.成功).toBe(true);
      expect(结果.状态.玩家列表[0].体力).toBe(4);
    });

    it('不能超过体力上限', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      游戏.状态 = '进行中';
      游戏.当前玩家 = '曹操';
      // 曹操体力已满 (4/4)

      const 结果 = 使用桃(游戏, '曹操');
      expect(结果.成功).toBe(false);
    });
  });
});
