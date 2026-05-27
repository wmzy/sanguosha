// tests/unit/提示.test.ts
import { describe, it, expect } from 'vitest';
import { 创建提示, 处理响应 } from '@engine/提示';

describe('提示系统', () => {
  describe('创建提示', () => {
    it('应该创建出牌提示', () => {
      const 提示 = 创建提示('出牌', '曹操', ['杀', '闪', '桃']);
      expect(提示.name).toBe('出牌');
      expect(提示.类型).toBe('select_card');
      expect(提示.选项).toEqual(['杀', '闪', '桃']);
    });

    it('应该创建选择目标提示', () => {
      const 提示 = 创建提示('选择目标', '曹操', ['刘备', '孙权']);
      expect(提示.类型).toBe('select_player');
    });

    it('应该创建是/否提示', () => {
      const 提示 = 创建提示('是否使用闪', '曹操', ['是', '否']);
      expect(提示.类型).toBe('select_yes_no');
    });
  });

  describe('处理响应', () => {
    it('应该验证响应有效性', () => {
      const 提示 = 创建提示('出牌', '曹操', ['杀', '闪', '桃']);
      expect(处理响应(提示, '杀')).toBe(true);
      expect(处理响应(提示, '不存在的牌')).toBe(false);
    });
  });
});
