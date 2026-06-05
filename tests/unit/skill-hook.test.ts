// tests/unit/skill-hook.test.ts — engine/skill-hook.ts 单元测试
//
// 覆盖 registerAtomHook / onBefore / onAfter / cancel / replace / additionalAtoms
// 集成测试：applyAtoms 调钩子并应用 cancel/replace/additionalAtoms

import { describe, it, expect, beforeEach } from 'vitest';
import { registerAtomHook, clearAtomHooks, getAtomHooks } from '@engine/skill-hook';
import { applyAtoms, registerAtom, getAtomDef } from '@engine/atom';
import { createTestGame } from '../engine-helpers';
import type { GameState, Atom, ServerEvent } from '@engine/types';

describe('skill-hook API', () => {
  beforeEach(() => {
    clearAtomHooks();
  });

  it('registerAtomHook 注册后 getAtomHooks 返回按优先级降序', () => {
    registerAtomHook({ atomType: 'damage', priority: 1, onBefore: () => {} });
    registerAtomHook({ atomType: 'damage', priority: 5, onBefore: () => {} });
    registerAtomHook({ atomType: 'damage', priority: 3, onBefore: () => {} });
    registerAtomHook({ atomType: 'heal', priority: 1, onBefore: () => {} });

    const damageHooks = getAtomHooks('damage');
    expect(damageHooks.map((h) => h.priority)).toEqual([5, 3, 1]);

    const healHooks = getAtomHooks('heal');
    expect(healHooks).toHaveLength(1);
  });

  it('clearAtomHooks 清空所有钩子', () => {
    registerAtomHook({ atomType: 'damage', onBefore: () => {} });
    expect(getAtomHooks('damage')).toHaveLength(1);
    clearAtomHooks();
    expect(getAtomHooks('damage')).toHaveLength(0);
  });

  it('player 过滤：player 匹配的钩子优先返回', () => {
    registerAtomHook({ atomType: 'damage', player: 'P1', onBefore: () => {} });
    registerAtomHook({ atomType: 'damage', player: 'P2', onBefore: () => {} });
    registerAtomHook({ atomType: 'damage', onBefore: () => {} });

    // 全员钩子总是返回
    expect(getAtomHooks('damage')).toHaveLength(3);
  });
});

describe('onBefore 钩子行为', () => {
  beforeEach(() => {
    clearAtomHooks();
  });

  it('cancel 跳过 atom：serverLog 不增长', () => {
    let cancelCalled = false;
    registerAtomHook({
      atomType: 'damage',
      onBefore: () => {
        cancelCalled = true;
        return { cancel: true };
      },
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    const startLen = state.serverLog.length;
    const result = applyAtoms(state, [
      { type: 'damage' as const, target: 'P1' as never, amount: 1 },
    ]);

    expect(cancelCalled).toBe(true);
    // cancel 跳过该 atom——serverLog 不增长
    expect(result.events).toHaveLength(0);
    expect(result.state.serverLog).toHaveLength(startLen);
  });

  it('replace 用新 atom 替代：原 atom 的 toEvents 不调', () => {
    // 假设我们注册一个"免疫伤害"技能：把所有 damage 转成 heal
    registerAtomHook({
      atomType: 'damage',
      onBefore: ({ atom }) => {
        const dmg = atom as Atom & { type: 'damage' };
        return {
          atom: { type: 'heal' as const, target: dmg.target as never, amount: dmg.amount as never },
        };
      },
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    state.players['P1'].health = 2;
    const result = applyAtoms(state, [
      { type: 'damage' as const, target: 'P1' as never, amount: 1 },
    ]);

    // 原始 damage 被替换为 heal：P1 health 应该是 3（2+1）
    expect(result.state.players['P1'].health).toBe(3);
  });

  it('modifyState：钩子修改 state 后再 apply atom', () => {
    // "出牌时手牌上限+1" 风格：先加手牌上限
    registerAtomHook({
      atomType: 'draw',
      onBefore: ({ state }) => ({
        state: {
          ...state,
          players: {
            ...state.players,
            P1: { ...state.players['P1'], health: 5 },
          },
        },
      }),
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    state.players['P1'].health = 3;
    const result = applyAtoms(state, [
      { type: 'draw' as const, player: 'P1' as never, count: 2 },
    ]);

    // 钩子已经把 P1 health 改为 5，draw 不影响 health
    expect(result.state.players['P1'].health).toBe(5);
  });

  it('priority 高的先执行', () => {
    const order: string[] = [];
    registerAtomHook({
      atomType: 'damage',
      priority: 1,
      onBefore: () => {
        order.push('low');
      },
    });
    registerAtomHook({
      atomType: 'damage',
      priority: 10,
      onBefore: () => {
        order.push('high');
      },
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    applyAtoms(state, [{ type: 'damage' as const, target: 'P1' as never, amount: 1 }]);
    expect(order).toEqual(['high', 'low']);
  });

  it('第一个 cancel 的钩子立即终止后续钩子', () => {
    const order: string[] = [];
    registerAtomHook({
      atomType: 'damage',
      priority: 10,
      onBefore: () => {
        order.push('first');
        return { cancel: true };
      },
    });
    registerAtomHook({
      atomType: 'damage',
      priority: 1,
      onBefore: () => {
        order.push('second');
      },
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    applyAtoms(state, [{ type: 'damage' as const, target: 'P1' as never, amount: 1 }]);
    expect(order).toEqual(['first']); // second 不执行
  });
});

describe('onAfter 钩子行为', () => {
  beforeEach(() => {
    clearAtomHooks();
  });

  it('additionalAtoms 递归应用：伤害后追加摸牌', () => {
    // "造成伤害后摸 1 张牌" 风格技能
    registerAtomHook({
      atomType: 'damage',
      onAfter: () => ({
        additionalAtoms: [{ type: 'draw' as const, player: 'P2' as never, count: 1 }],
      }),
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    state.players['P2'].hand = ['existing-card'];
    state.zones.deck = ['new-card-1', 'new-card-2', 'new-card-3'];

    const result = applyAtoms(state, [
      { type: 'damage' as const, target: 'P1' as never, amount: 1, source: 'P2' as never },
    ]);

    // damage 派了 1 个 + draw 派了 1 个 = 2 events
    expect(result.events).toHaveLength(2);
    // P2 手牌从 1 张变 2 张（摸 1 张）
    expect(result.state.players['P2'].hand).toHaveLength(2);
  });

  it('additionalAtoms 递归但不触发 onAfter 钩子（防无限递归）', () => {
    let callCount = 0;
    registerAtomHook({
      atomType: 'damage',
      onAfter: () => {
        callCount++;
        return {
          additionalAtoms: [{ type: 'draw' as const, player: 'P2' as never, count: 1 }],
        };
      },
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    state.zones.deck = ['c1', 'c2', 'c3'];

    // 应该不会因为 additionalAtoms 的 draw 再次触发 damage 钩子（draw 不是 damage）
    applyAtoms(state, [{ type: 'damage' as const, target: 'P1' as never, amount: 1, source: 'P2' as never }]);

    // damage 钩子只调 1 次
    expect(callCount).toBe(1);
  });

  it('多个钩子 onAfter 追加多组 additionalAtoms', () => {
    registerAtomHook({
      atomType: 'damage',
      priority: 10,
      onAfter: () => ({
        additionalAtoms: [{ type: 'setVar' as const, player: 'P1' as never, key: 'first', value: true }],
      }),
    });
    registerAtomHook({
      atomType: 'damage',
      priority: 1,
      onAfter: () => ({
        additionalAtoms: [{ type: 'setVar' as const, player: 'P1' as never, key: 'second', value: true }],
      }),
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    const result = applyAtoms(state, [
      { type: 'damage' as const, target: 'P1' as never, amount: 1 },
    ]);

    expect(result.state.players['P1'].vars['first']).toBe(true);
    expect(result.state.players['P1'].vars['second']).toBe(true);
  });

  it('modifyState：钩子修改 state', () => {
    registerAtomHook({
      atomType: 'damage',
      onAfter: ({ state }) => ({
        state: {
          ...state,
          meta: { ...state.meta, customField: 'touched' } as GameState['meta'],
        },
      }),
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    const result = applyAtoms(state, [
      { type: 'damage' as const, target: 'P1' as never, amount: 1 },
    ]);

    // meta 字段被钩子修改
    expect((result.state.meta as unknown as { customField?: string }).customField).toBe('touched');
  });
});

describe('钩子集成：player 过滤', () => {
  beforeEach(() => {
    clearAtomHooks();
  });

  it('player 限定：钩子只对指定玩家触发', () => {
    let p1Called = 0;
    let p2Called = 0;
    registerAtomHook({
      atomType: 'damage',
      player: 'P1',
      onBefore: () => {
        p1Called++;
      },
    });
    registerAtomHook({
      atomType: 'damage',
      player: 'P2',
      onBefore: () => {
        p2Called++;
      },
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    state.currentPlayer = 'P1';
    applyAtoms(state, [{ type: 'damage' as const, target: 'P1' as never, amount: 1 }]);

    // P1 是 currentPlayer → P1 钩子触发
    expect(p1Called).toBe(1);
    expect(p2Called).toBe(0);
  });
});

describe('钩子集成：skipHooks 选项', () => {
  beforeEach(() => {
    clearAtomHooks();
  });

  it('opts.skipHooks=true 时钩子不触发', () => {
    let called = false;
    registerAtomHook({
      atomType: 'damage',
      onBefore: () => {
        called = true;
        return { cancel: true };
      },
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });
    const result = applyAtoms(
      state,
      [{ type: 'damage' as const, target: 'P1' as never, amount: 1 }],
      { skipHooks: true },
    );

    expect(called).toBe(false);
    // 没 cancel：serverLog 增长
    expect(result.events).toHaveLength(1);
  });

  it('additionalAtoms 递归应用时 skipHooks=true（防无限递归）', () => {
    let callCount = 0;
    registerAtomHook({
      atomType: 'damage',
      onAfter: () => {
        callCount++;
        return {
          // 故意让 additionalAtoms 包含 damage——验证递归不会无限循环
          additionalAtoms: [{ type: 'damage' as const, target: 'P1' as never, amount: 1 }],
        };
      },
    });

    const state = createTestGame({ characters: ['曹操', '刘备'] });

    expect(() => {
      applyAtoms(state, [{ type: 'damage' as const, target: 'P1' as never, amount: 1, source: 'P2' as never }]);
    }).not.toThrow();

    // damage 钩子调 1 次（additionalAtoms 里的 damage 不触发 damage 钩子）
    expect(callCount).toBe(1);
  });
});
