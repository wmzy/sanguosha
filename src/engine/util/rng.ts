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
