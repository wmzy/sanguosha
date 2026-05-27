// shared/牌组.ts
import type { Card } from './类型';
import type { Rng } from './rng';

// Fisher-Yates 洗牌算法
export function 洗牌(牌堆: Card[], rng: Rng): Card[] {
  const 结果 = [...牌堆];
  for (let i = 结果.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [结果[i], 结果[j]] = [结果[j], 结果[i]];
  }
  return 结果;
}

// 从牌堆摸牌
export function 摸牌(牌堆: Card[], 数量: number): { 摸到的牌: Card[]; 剩余牌堆: Card[] } {
  const 摸到的牌 = 牌堆.slice(0, 数量);
  const 剩余牌堆 = 牌堆.slice(数量);
  return { 摸到的牌, 剩余牌堆 };
}

// 弃牌
export function 弃牌(弃牌堆: Card[], 弃的牌: Card[]): Card[] {
  return [...弃牌堆, ...弃的牌];
}
