import { describe, expect, it } from 'vitest';
import { arcLayout } from '../../src/client/utils/gameViewHelpers';

describe('arcLayout', () => {
  it('places single opponent at top center', () => {
    expect(arcLayout(1, 0)).toEqual({ leftPct: 50, topPct: 6 });
  });

  it('keeps 2–3 opponents on upper arc within battlefield', () => {
    for (const n of [2, 3]) {
      for (let i = 0; i < n; i++) {
        const p = arcLayout(n, i);
        expect(p.leftPct).toBeGreaterThanOrEqual(6);
        expect(p.leftPct).toBeLessThanOrEqual(94);
        expect(p.topPct).toBeGreaterThanOrEqual(2);
        expect(p.topPct).toBeLessThanOrEqual(52);
      }
      // leftmost then rightmost
      expect(arcLayout(n, 0).leftPct).toBeLessThan(arcLayout(n, n - 1).leftPct);
    }
  });

  it('spreads 7 opponents without stacking at one point', () => {
    const points = Array.from({ length: 7 }, (_, i) => arcLayout(7, i));
    const lefts = points.map((p) => p.leftPct);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeGreaterThan(40);
    // all distinct enough
    const unique = new Set(lefts.map((x) => x.toFixed(1)));
    expect(unique.size).toBe(7);
  });
});
