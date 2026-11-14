import type { GameState } from '../types';

export interface Rng {
  next(): number;
  nextInt(max: number): number;
  /** 导出当前内部状态用于序列化/确定性重放 */
  getState(): number;
}

export function createRng(seed: number): Rng {
  let state = seed | 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(max: number) {
      return Math.floor(this.next() * max);
    },
    getState() {
      return state;
    },
  };
}

/**
 * 从数组中等概率随机取一个元素(种子化随机数的「取一」样板收敛:
 * createRng(state.rngSeed) → 使用 → 写回 state.rngSeed,与各技能手写
 * `const rng = createRng(state.rngSeed); const idx = rng.nextInt(arr.length);
 *  state.rngSeed = rng.getState();` 逐字等价)。
 * 空数组返回 undefined 且不推进 seed(不消耗随机序列,后续取数序列不变)。
 *
 * 用法(突袭:从目标手牌中随机获得一张):
 * ```ts
 * const cardId = pickRandom(state, state.players[target].hand);
 * if (cardId !== undefined) {
 *   await applyAtom(state, { type: '获得', player: ownerId, cardId, from: target });
 * }
 * ```
 */
export function pickRandom<T>(state: GameState, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  const rng = createRng(state.rngSeed);
  const picked = arr[rng.nextInt(arr.length)];
  state.rngSeed = rng.getState();
  return picked;
}
