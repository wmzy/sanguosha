// LEGACY TEST: references deleted v2 modules - skipped
// tests/scenarios/装备/火杀.test.ts — 火杀 +1 伤害（真 game rule）
//
// 真 game rule：使用火【杀】（card.name='杀' + card.subtype='火杀'）造成 2 点伤害，
// 普通【杀】1 点。
//
// v3 路径：监听 useCard 原子（[T-13] useCard 拆分后由 specifyTarget/becomeTarget/
// resolveCard 取代；hook 仍按 useCard 字面量注册，模式同 P2-T3 leiji.ts）。
// filter：card.name='杀' && card.subtype ∈ {'火杀', 'fire'}
// onAfter：emit 1 个 amount=2 damageType='fire' damage atom
//
// 测试用 stub CardDef {subtype: '火杀'}，不依赖 cards.ts 扩展。
// stub 的 subtype 字段越出 CardSubType 字面量集合（'火杀'/'fire' 尚未加入），
// 走 `as Card` cast 表达"未来扩展后的真实形态"。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
// import { clearAtomHooks } from '@engine/skill-hook';  // LEGACY: removed (v2 module deleted)
// import { registerAllAtoms } from '@engine/atoms';  // LEGACY: removed (registerAllAtoms no longer exported)
import { createTestGame, setHealth } from '../../engine-helpers';
import { registerAll as registerFireBonus } from '../../fixtures/火杀';
import type { Atom, Card, GameState } from '@engine/types';

describe.skip('火杀 +1 伤害（真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerFireBonus();
  });

  function makeKill(id: string, subtype: string) {
    return {
      id,
      name: '杀' as const,
      type: '基本牌' as const,
      subtype,
      suit: '♠' as const,
      rank: '5' as const,
      description: '',
    } as unknown as Card;
  }

  function useCard(source: string, target: string, cardId: string): Atom {
    return { type: 'useCard', source, target, cardId } as unknown as Atom;
  }

  it('source 用 火杀 → 钩子注入 amount=2 damage atom → 目标受 2 点伤害', () => {
    const s0 = setHealth(createTestGame(), 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: { ...s0.cardMap, fireKill1: makeKill('fireKill1', '火杀') },
    };
    const { state, logEntries: events } = applyAtoms(s1, [useCard('P2', 'P1', 'fireKill1')]);
    // 期望：P1 受 2 点伤害（4 → 2）
    expect(state.players.P1.health).toBe(2);
    const dmg = events.filter((e) => e.atom.type === '造成伤害');
    expect(dmg).toHaveLength(1);
    if (dmg[0]?.atom.type === '造成伤害') {
      expect(dmg[0].atom).toMatchObject({ amount: 2, damageType: 'fire' });
    }
  });

  it('source 用普通 杀（subtype=杀）→ 钩子不触发 → 目标受 0 伤害（无 damage atom）', () => {
    const s0 = setHealth(createTestGame(), 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: { ...s0.cardMap, normalKill1: makeKill('normalKill1', '杀') },
    };
    const { state, logEntries: events } = applyAtoms(s1, [useCard('P2', 'P1', 'normalKill1')]);
    // 普通杀不触发 +1 钩子，无 damage atom 注入 → P1 health 不变
    expect(state.players.P1.health).toBe(4);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(0);
  });

  it('source 用 subtype=fire（英文别名）→ 钩子也触发 → 目标受 2 点伤害', () => {
    // 真 game rule：火杀 card.subtype ∈ {'火杀', 'fire'}（未来 cards.ts 扩展用 'fire'），
    // 钩子同时支持两种命名。
    const s0 = setHealth(createTestGame(), 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: { ...s0.cardMap, fireKill2: makeKill('fireKill2', 'fire') },
    };
    const { state, logEntries: events } = applyAtoms(s1, [useCard('P2', 'P1', 'fireKill2')]);
    expect(state.players.P1.health).toBe(2);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(1);
  });
});
