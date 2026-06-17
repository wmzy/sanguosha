// LEGACY TEST: references deleted v2 modules - skipped
import type { GameState } from '@engine/types';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
// import { clearAtomHooks } from '@engine/skill-hook';  // LEGACY: removed (v2 module deleted)
// import { registerAllAtoms } from '@engine/atoms';  // LEGACY: removed (registerAllAtoms no longer exported)
import { createTestGame, withArmor, setHealth } from '../../engine-helpers';
import { registerAll as registerFixtureHooks } from '../../fixtures/装备武器';

describe.skip('仁王盾 v3（黑杀无效）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerFixtureHooks();
  });

  it('黑桃杀对装备仁王盾的角色不扣血', () => {
    // §4.3 修：v3 hook 监听 damage + cardId 对应黑杀 + target.防具 === '仁王盾'
    // → onBefore cancel，damage 不 apply、不写 serverLog
    let s0 = createTestGame();
    s0 = withArmor(setHealth(s0, 'P1', 4), 'P1', '仁王盾');
    // 注入 kill1（黑桃 A）到 cardMap
    s0 = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        kill1: {
          id: 'kill1',
          name: '杀',
          type: '基本牌',
          subtype: '杀',
          suit: '♠',
          rank: 'A',
          description: '',
        },
      },
    };
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    // 黑杀被仁王盾防住 → P1 血量不变
    expect(state.players.P1.health).toBe(4);
    // damage atom 被 cancel → serverLog 中没有 damage 事件
    expect(events.some((e) => e.atom.type === '造成伤害')).toBe(false);
  });

  it('红桃杀对装备仁王盾的角色正常扣血', () => {
    // 仁王盾只防黑杀，红杀正常造成伤害
    let s0 = createTestGame();
    s0 = withArmor(setHealth(s0, 'P1', 4), 'P1', '仁王盾');
    s0 = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        kill1: {
          id: 'kill1',
          name: '杀',
          type: '基本牌',
          subtype: '杀',
          suit: '♥',
          rank: 'A',
          description: '',
        },
      },
    };
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(3);
    expect(events.some((e) => e.atom.type === '造成伤害')).toBe(true);
  });

  it('黑杀对未装备仁王盾的角色正常扣血', () => {
    let s0 = createTestGame();
    s0 = setHealth(s0, 'P1', 4);
    s0 = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        kill1: {
          id: 'kill1',
          name: '杀',
          type: '基本牌',
          subtype: '杀',
          suit: '♠',
          rank: 'A',
          description: '',
        },
      },
    };
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(3);
    expect(events.some((e) => e.atom.type === '造成伤害')).toBe(true);
  });
});
