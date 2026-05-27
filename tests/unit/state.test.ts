// tests/unit/状态.test.ts
import { describe, it, expect } from 'vitest';
import { 创建游戏, 获取公开状态 } from '@engine/state';
import { 曹操, 刘备 } from '@shared/characters';

describe('游戏状态', () => {
  describe('创建游戏', () => {
    it('应该创建指定玩家数的游戏', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      expect(游戏.玩家列表.length).toBe(2);
      expect(游戏.状态).toBe('等待中');
    });

    it('应该为每个玩家设置正确的初始状态', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      const 玩家1 = 游戏.玩家列表[0];
      expect(玩家1.角色.name).toBe('曹操');
      expect(玩家1.体力).toBe(4);
      expect(玩家1.体力上限).toBe(4);
      expect(玩家1.存活).toBe(true);
      expect(玩家1.手牌.length).toBe(0);
    });

    it('应该创建洗好的牌堆', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      expect(游戏.牌堆.length).toBeGreaterThan(0);
      expect(游戏.弃牌堆.length).toBe(0);
    });
  });

  describe('获取公开状态', () => {
    it('应该隐藏其他玩家的手牌', () => {
      const 游戏 = 创建游戏([曹操, 刘备]);
      // 给玩家一些手牌
      游戏.玩家列表[0].手牌 = [游戏.牌堆[0], 游戏.牌堆[1]];

      const 公开状态 = 获取公开状态(游戏, '曹操');
      const 曹操公开 = 公开状态.玩家列表.find(p => p.角色.name === '曹操')!;
      const 刘备公开 = 公开状态.玩家列表.find(p => p.角色.name === '刘备')!;

      // 曹操能看到自己的手牌
      expect(曹操公开.手牌).toBeDefined();
      expect(曹操公开.手牌!.length).toBe(2);

      // 刘备不能看到曹操的手牌
      expect(刘备公开.手牌).toBeUndefined();
      expect(刘备公开.手牌数量).toBe(0);
    });
  });
});
