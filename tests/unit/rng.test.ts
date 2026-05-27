import { describe, it, expect } from 'vitest';
import { createRng } from '@shared/rng';

describe('种子化随机数', () => {
  it('相同种子产生相同序列', () => {
    const rng1 = createRng(12345);
    const rng2 = createRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it('不同种子产生不同序列', () => {
    const rng1 = createRng(12345);
    const rng2 = createRng(67890);
    const results1 = Array.from({ length: 10 }, () => rng1.next());
    const results2 = Array.from({ length: 10 }, () => rng2.next());
    expect(results1).not.toEqual(results2);
  });

  it('next() 返回 [0, 1) 范围的数', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('nextInt(max) 返回 [0, max) 范围的整数', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(10);
      expect(Number.isInteger(val)).toBe(true);
    }
  });
});
