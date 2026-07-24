// 模块 K:杀次数额定/额外/无限三层计数模型单元测试(slash-quota.ts)。
//
// 验证:
//   1. 额定(quota,覆盖型 max):基础 1;多提供者取最大
//   2. 额外(extra,叠加型 Σ):多提供者求和
//   3. 无限(unlimited,任一 true→∞):覆盖额定+额外
//   4. slashMax 三层组合
//   5. 消耗优先扣额定(quota 满后扣 extra)
//   6. 连弩式无限:canSlash 恒真
//   7. 卸载提供者:slashMax 回落
//   8. 向后兼容:registerSlashMaxProvider 路由到额定;SLASH_USED_VAR 仍为 view 投影 key
import { describe, it, expect } from 'vitest';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';
import {
  registerSlashQuotaProvider,
  registerSlashExtraProvider,
  registerSlashUnlimitedProvider,
  registerSlashMaxProvider,
  slashQuotaMax,
  slashExtraMax,
  isSlashUnlimited,
  slashMax,
  slashQuotaUsed,
  slashExtraUsed,
  slashUsed,
  canSlash,
  incSlashUsed,
  SLASH_USED_VAR,
} from '../../src/engine/slash-quota';

function makeState(): GameState {
  return createGameState({
    players: [
      {
        index: 0,
        name: 'P0',
        character: '主公',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: [],
        vars: {},
        marks: [],
        pendingTricks: [],
        judgeZone: [],
        tags: [],
      },
      {
        index: 1,
        name: 'P1',
        character: '反贼',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: [],
        vars: {},
        marks: [],
        pendingTricks: [],
        judgeZone: [],
        tags: [],
      },
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('模块 K:杀次数三层计数模型', () => {
  describe('额定(quota,覆盖型 max)', () => {
    it('无提供者 → slashQuotaMax = 1(基础额定)', () => {
      const s = makeState();
      expect(slashQuotaMax(s, 0)).toBe(1);
    });

    it('单个额定提供者返回 2 → slashQuotaMax = 2, slashMax = 2', () => {
      const s = makeState();
      registerSlashQuotaProvider(s, 0, () => 2);
      expect(slashQuotaMax(s, 0)).toBe(2);
      expect(slashMax(s, 0)).toBe(2);
    });

    it('多个额定提供者取最大(覆盖型):2 与 3 → max = 3', () => {
      const s = makeState();
      registerSlashQuotaProvider(s, 0, () => 2);
      registerSlashQuotaProvider(s, 0, () => 3);
      registerSlashQuotaProvider(s, 0, () => 0); // 0 = 无贡献
      expect(slashQuotaMax(s, 0)).toBe(3);
    });

    it('额定提供者返回 < 基础1(如 0)→ 不降低额定,仍为 1', () => {
      const s = makeState();
      registerSlashQuotaProvider(s, 0, () => 0);
      expect(slashQuotaMax(s, 0)).toBe(1);
    });

    it('额定提供者仅作用于注册的 owner,不影响他人', () => {
      const s = makeState();
      registerSlashQuotaProvider(s, 0, () => 3);
      expect(slashQuotaMax(s, 0)).toBe(3);
      expect(slashQuotaMax(s, 1)).toBe(1);
    });
  });

  describe('额外(extra,叠加型 Σ)', () => {
    it('无提供者 → slashExtraMax = 0', () => {
      const s = makeState();
      expect(slashExtraMax(s, 0)).toBe(0);
    });

    it('单个额外提供者返回 1 → slashExtraMax = 1, slashMax = 1(额定)+1 = 2', () => {
      const s = makeState();
      registerSlashExtraProvider(s, 0, () => 1);
      expect(slashExtraMax(s, 0)).toBe(1);
      expect(slashMax(s, 0)).toBe(2);
    });

    it('多个额外提供者求和(叠加型):1 + 2 → 3, slashMax = 1+3 = 4', () => {
      const s = makeState();
      registerSlashExtraProvider(s, 0, () => 1);
      registerSlashExtraProvider(s, 0, () => 2);
      expect(slashExtraMax(s, 0)).toBe(3);
      expect(slashMax(s, 0)).toBe(4);
    });
  });

  describe('额定 + 额外组合', () => {
    it('额定 2 + 额外 1 → slashMax = 3', () => {
      const s = makeState();
      registerSlashQuotaProvider(s, 0, () => 2);
      registerSlashExtraProvider(s, 0, () => 1);
      expect(slashMax(s, 0)).toBe(3);
    });

    it('额定 2 + 额外(1+1) → slashMax = 4', () => {
      const s = makeState();
      registerSlashQuotaProvider(s, 0, () => 2);
      registerSlashExtraProvider(s, 0, () => 1);
      registerSlashExtraProvider(s, 0, () => 1);
      expect(slashMax(s, 0)).toBe(4);
    });
  });

  describe('无限(unlimited,任一 true → ∞)', () => {
    it('无提供者 → isSlashUnlimited = false', () => {
      const s = makeState();
      expect(isSlashUnlimited(s, 0)).toBe(false);
    });

    it('单个无限提供者返回 true → isSlashUnlimited = true, slashMax = Infinity', () => {
      const s = makeState();
      registerSlashUnlimitedProvider(s, 0, () => true);
      expect(isSlashUnlimited(s, 0)).toBe(true);
      expect(slashMax(s, 0)).toBe(Infinity);
    });

    it('无限覆盖额定+额外:无限 + 额定2 + 额外3 → slashMax = Infinity', () => {
      const s = makeState();
      registerSlashUnlimitedProvider(s, 0, () => true);
      registerSlashQuotaProvider(s, 0, () => 2);
      registerSlashExtraProvider(s, 0, () => 3);
      expect(slashMax(s, 0)).toBe(Infinity);
    });

    it('无限提供者返回 false → 不生效,slashMax = 额定+额外', () => {
      const s = makeState();
      registerSlashUnlimitedProvider(s, 0, () => false);
      registerSlashQuotaProvider(s, 0, () => 2);
      expect(isSlashUnlimited(s, 0)).toBe(false);
      expect(slashMax(s, 0)).toBe(2);
    });
  });

  describe('消耗优先扣额定(incSlashUsed)', () => {
    it('初始:quotaUsed = extraUsed = slashUsed = 0', () => {
      const s = makeState();
      expect(slashQuotaUsed(s)).toBe(0);
      expect(slashExtraUsed(s)).toBe(0);
      expect(slashUsed(s)).toBe(0);
    });

    it('基础场景(quotaMax=1):首次扣额定,quotaUsed=1;第二次无处可扣进 extra', () => {
      const s = makeState();
      // quotaMax=1(base), extraMax=0
      incSlashUsed(s);
      expect(slashQuotaUsed(s)).toBe(1);
      expect(slashExtraUsed(s)).toBe(0);
      expect(slashUsed(s)).toBe(1);
    });

    it('额定优先消耗:quotaMax=2 + extraMax=1 → 前2次扣 quota,第3次扣 extra', () => {
      const s = makeState();
      registerSlashQuotaProvider(s, 0, () => 2);
      registerSlashExtraProvider(s, 0, () => 1);
      // slashMax = 3
      expect(slashMax(s, 0)).toBe(3);

      incSlashUsed(s);
      expect(slashQuotaUsed(s)).toBe(1);
      expect(slashExtraUsed(s)).toBe(0);

      incSlashUsed(s);
      expect(slashQuotaUsed(s)).toBe(2);
      expect(slashExtraUsed(s)).toBe(0);

      // 额定满 → 扣额外
      incSlashUsed(s);
      expect(slashQuotaUsed(s)).toBe(2);
      expect(slashExtraUsed(s)).toBe(1);
      expect(slashUsed(s)).toBe(3);

      // 达上限 3 → canSlash = false
      expect(canSlash(s, 0)).toBe(false);
    });

    it('纯额外场景(quotaMax=1, extraMax=2):首次扣 quota,后续扣 extra', () => {
      const s = makeState();
      registerSlashExtraProvider(s, 0, () => 2);
      // slashMax = 1 + 2 = 3
      expect(slashMax(s, 0)).toBe(3);

      incSlashUsed(s);
      expect(slashQuotaUsed(s)).toBe(1);
      expect(slashExtraUsed(s)).toBe(0);

      incSlashUsed(s);
      expect(slashQuotaUsed(s)).toBe(1);
      expect(slashExtraUsed(s)).toBe(1);

      incSlashUsed(s);
      expect(slashQuotaUsed(s)).toBe(1);
      expect(slashExtraUsed(s)).toBe(2);
      expect(slashUsed(s)).toBe(3);
      expect(canSlash(s, 0)).toBe(false);
    });
  });

  describe('连弩式无限:canSlash 恒真', () => {
    it('无限提供者 → 多次 incSlashUsed 后 canSlash 仍为 true', () => {
      const s = makeState();
      registerSlashUnlimitedProvider(s, 0, () => true);
      expect(slashMax(s, 0)).toBe(Infinity);

      for (let i = 0; i < 5; i++) {
        incSlashUsed(s);
        expect(canSlash(s, 0)).toBe(true);
      }
      expect(slashUsed(s)).toBe(5);
    });
  });

  describe('卸载提供者(unload 取消注册)', () => {
    it('卸载额定提供者 → slashQuotaMax 回落基础 1', () => {
      const s = makeState();
      const unload = registerSlashQuotaProvider(s, 0, () => 3);
      expect(slashQuotaMax(s, 0)).toBe(3);
      unload();
      expect(slashQuotaMax(s, 0)).toBe(1);
      expect(slashMax(s, 0)).toBe(1);
    });

    it('卸载额外提供者 → slashExtraMax 回落 0', () => {
      const s = makeState();
      const unload = registerSlashExtraProvider(s, 0, () => 2);
      expect(slashExtraMax(s, 0)).toBe(2);
      unload();
      expect(slashExtraMax(s, 0)).toBe(0);
    });

    it('卸载无限提供者 → slashMax 回落到额定+额外', () => {
      const s = makeState();
      const unload = registerSlashUnlimitedProvider(s, 0, () => true);
      expect(slashMax(s, 0)).toBe(Infinity);
      unload();
      expect(isSlashUnlimited(s, 0)).toBe(false);
      expect(slashMax(s, 0)).toBe(1);
    });

    it('卸载单个额定提供者后,其他额定提供者仍生效(取最大)', () => {
      const s = makeState();
      const u2 = registerSlashQuotaProvider(s, 0, () => 2);
      registerSlashQuotaProvider(s, 0, () => 3);
      expect(slashQuotaMax(s, 0)).toBe(3);
      u2();
      expect(slashQuotaMax(s, 0)).toBe(3);
    });
  });

  describe('向后兼容', () => {
    it('SLASH_USED_VAR 仍导出为 view 投影 key("杀/usedCount")', () => {
      expect(SLASH_USED_VAR).toBe('杀/usedCount');
    });

    it('registerSlashMaxProvider(已废弃)路由到额定提供者(max 语义)', () => {
      const s = makeState();
      // 返回 2 作为额定 → max(基础1, 2) = 2(非旧叠加语义 1+2=3)
      registerSlashMaxProvider(s, 0, () => 2);
      expect(slashQuotaMax(s, 0)).toBe(2);
      expect(slashMax(s, 0)).toBe(2);
    });

    it('registerSlashMaxProvider 返回的取消函数可卸载', () => {
      const s = makeState();
      const unload = registerSlashMaxProvider(s, 0, () => 2);
      expect(slashMax(s, 0)).toBe(2);
      unload();
      expect(slashMax(s, 0)).toBe(1);
    });
  });
});
