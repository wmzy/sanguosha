// tests/unit/牌组.test.ts
import { describe, it, expect } from 'vitest';
import { 洗牌, 摸牌, 弃牌 } from '@shared/牌组';
import { 创建标准牌堆 } from '@shared/卡牌';
import { createRng } from '@shared/rng';

describe('牌组管理', () => {
  describe('洗牌', () => {
    it('应该返回相同数量的牌', () => {
      const 牌堆 = 创建标准牌堆();
      const 洗牌后 = 洗牌([...牌堆], createRng(42));
      expect(洗牌后.length).toBe(牌堆.length);
    });

    it('应该包含所有原始牌', () => {
      const 牌堆 = 创建标准牌堆();
      const 洗牌后 = 洗牌([...牌堆], createRng(42));
      const 排序后 = (cards: typeof 牌堆) =>
        [...cards].sort((a, b) => a.name.localeCompare(b.name) || a.花色.localeCompare(b.花色) || a.点数.localeCompare(b.点数));
      expect(排序后(洗牌后)).toEqual(排序后(牌堆));
    });
  });

  describe('摸牌', () => {
    it('应该从牌堆顶部摸指定数量的牌', () => {
      const 牌堆 = 创建标准牌堆();
      const 洗牌后 = 洗牌([...牌堆], createRng(42));
      const { 摸到的牌, 剩余牌堆 } = 摸牌(洗牌后, 2);
      expect(摸到的牌.length).toBe(2);
      expect(剩余牌堆.length).toBe(洗牌后.length - 2);
      expect(摸到的牌[0]).toBe(洗牌后[0]);
      expect(摸到的牌[1]).toBe(洗牌后[1]);
    });

    it('牌堆不足时摸完所有牌', () => {
      const 牌堆 = 创建标准牌堆().slice(0, 1);
      const { 摸到的牌, 剩余牌堆 } = 摸牌(牌堆, 3);
      expect(摸到的牌.length).toBe(1);
      expect(剩余牌堆.length).toBe(0);
    });
  });

  describe('弃牌', () => {
    it('应该将牌放入弃牌堆', () => {
      const 牌堆 = 创建标准牌堆();
      const 弃的牌 = [牌堆[0], 牌堆[1]];
      const 弃牌堆 = 弃牌([], 弃的牌);
      expect(弃牌堆.length).toBe(2);
      expect(弃牌堆).toEqual(弃的牌);
    });
  });
});
