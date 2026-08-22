import { describe, expect, it } from 'vitest';
import { arcLayout } from '../../src/client/utils/gameViewHelpers';

describe('arcLayout', () => {
  it('places single opponent at top center', () => {
    expect(arcLayout(1, 0)).toEqual({ leftPct: 50, topPct: 1 });
  });

  it('keeps 2–3 opponents on upper row within battlefield', () => {
    for (const n of [2, 3]) {
      for (let i = 0; i < n; i++) {
        const p = arcLayout(n, i);
        expect(p.leftPct).toBeGreaterThanOrEqual(3);
        expect(p.leftPct).toBeLessThanOrEqual(94);
        expect(p.topPct).toBeGreaterThanOrEqual(0);
        expect(p.topPct).toBeLessThanOrEqual(62);
      }
      // 逆时针环序:i=0 为右侧位(下家方向),末座在左侧
      expect(arcLayout(n, 0).leftPct).toBeGreaterThan(arcLayout(n, n - 1).leftPct);
    }
  });

  it('spreads 7 opponents as official ring (top row + side columns)', () => {
    const pts = Array.from({ length: 7 }, (_, i) => arcLayout(7, i));
    const lefts = pts.map((p) => p.leftPct);
    // 左右总跨度覆盖战场
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeGreaterThan(40);
    // 同列纵排座位(left 相同)必须垂直错开 ≥40%,防止卡牌重叠
    for (const col of [lefts[0], lefts[1]]) {
      const tops = pts.filter((p) => p.leftPct === col).map((p) => p.topPct);
      if (tops.length >= 2) {
        expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThanOrEqual(40);
      }
    }
    // 环序:首座(下家方向)在右缘,末座在左缘
    expect(pts[0].leftPct).toBeGreaterThan(80);
    expect(pts[pts.length - 1].leftPct).toBeLessThan(20);
  });
});
