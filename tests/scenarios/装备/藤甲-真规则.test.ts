// tests/scenarios/装备/藤甲-真规则.test.ts — 藤甲（防 normal 杀）真 game rule
//
// 锁定技：装备藤甲的角色受到【杀】造成的伤害时，防止此伤害。
// 真 game rule：藤甲防 normal 类型 damage（不是 fire）。fire / thunder 不防。
//
// 此文件覆盖 P1-1A-T2 反转 bug 后的真 game rule 全部 3 个伤害类型分支：
// - normal → cancel（藤甲生效）
// - fire   → 不 cancel（藤甲不防 fire——火杀照样 2 点穿藤甲）
// - thunder→ 不 cancel（藤甲不防 thunder）

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth, withArmor } from '../../engine-helpers';
import { registerAll as registerTengjia } from '../../fixtures/藤甲';
import type { Card, GameState } from '@engine/types';

describe('藤甲真 game rule（防 normal 杀）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerTengjia();
  });

  it('装备藤甲 + normal 伤害 → cancel（藤甲生效）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '藤甲'), 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', damageType: 'normal' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(0);
  });

  it('装备藤甲 + fire 伤害 → 不 cancel（藤甲不防 fire）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '藤甲'), 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        fireKill: {
          id: 'fireKill',
          name: '杀',
          type: '基本牌',
          subtype: '火杀',
          suit: '♥',
          rank: '5',
          description: '',
        } as unknown as Card,
      },
    };
    const { state, logEntries: events } = applyAtoms(s1, [
      {
        type: '造成伤害',
        target: 'P1',
        amount: 2,
        source: 'P2',
        damageType: 'fire',
        cardId: 'fireKill',
      },
    ]);
    expect(state.players.P1.health).toBe(2);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(1);
  });

  it('装备藤甲 + thunder 伤害 → 不 cancel（藤甲不防 thunder）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '藤甲'), 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 3, source: '张角', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBe(1);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(1);
  });
});
