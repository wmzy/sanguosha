// tests/unit/prompt.test.ts
import { describe, it, expect } from 'vitest';
import { createPrompt, handleResponse } from '@engine/prompt';

describe('prompt system', () => {
  describe('createPrompt', () => {
    it('should create a card play prompt', () => {
      const prompt = createPrompt('出牌', '曹操', ['杀', '闪', '桃']);
      expect(prompt.name).toBe('出牌');
      expect(prompt.type).toBe('select_card');
      expect(prompt.options).toEqual(['杀', '闪', '桃']);
    });

    it('should create a select player prompt', () => {
      const prompt = createPrompt('选择目标', '曹操', ['刘备', '孙权']);
      expect(prompt.type).toBe('select_player');
    });

    it('should create a yes/no prompt', () => {
      const prompt = createPrompt('是否使用闪', '曹操', ['是', '否']);
      expect(prompt.type).toBe('select_yes_no');
    });
  });

  describe('handleResponse', () => {
    it('should validate response validity', () => {
      const prompt = createPrompt('出牌', '曹操', ['杀', '闪', '桃']);
      expect(handleResponse(prompt, '杀')).toBe(true);
      expect(handleResponse(prompt, '不存在的牌')).toBe(false);
    });
  });
});
