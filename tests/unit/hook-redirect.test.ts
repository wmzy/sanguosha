// tests/unit/hook-redirect.test.ts — registerAtomHook onBefore.redirect 单元测试
//
// 覆盖 damage / becomeTarget 的目标重定向：onBefore 返回 { redirect: newTarget }
// 应在原 atom 应用前改写 atom.target，使后续 apply/toEvents 命中新目标。
//
// 用途：天香/流离/借刀 等目标转移类技能的底层机制。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks, registerAtomHook } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth } from '../engine-helpers';

describe('registerAtomHook redirect', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('onBefore 返回 redirect: newTarget 改写 damage.target', () => {
    registerAtomHook({
      atomType: 'damage',
      filter(_state, atom) {
        return atom.type === 'damage' && (atom.target as string) === 'P1';
      },
      onBefore() {
        return { redirect: 'P2' };
      },
    });

    const s0 = setHealth(setHealth(createTestGame(), 'P1', 4), 'P2', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P3' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(state.players.P2.health).toBe(3);
    const dmg = events.find(e => e.type === 'damage');
    expect(dmg?.payload).toMatchObject({ target: 'P2' });
  });
});
