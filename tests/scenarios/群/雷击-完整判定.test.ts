// tests/scenarios/群/雷击-完整判定.test.ts — 雷击完整判定（真 game rule）
//
// 真 game rule（占位骨架 P2-T3 → 升级 P3-T3）：
// - filter：source=张角 && card.suit=♠ && card.rank 在 2-9 之间
// - onAfter：读 state.localVars.leijiJudgeResult
//   - 'success' → emit 3 点 thunder damage
//   - 'fail' 或缺失 → 不 emit
//
// 完整 useCard 阶段 inject leijiJudgeResult 留 follow-up；本 Task 只升级
// onAfter 读 ctx，验证 success 才 emit damage。
//
// 与 P2-T3 既有测试的差异：P2-T3 的 雷击.test.ts 直接 applyAtoms damage atom
// （不走 useCard 路径、不触发钩子），所以升级 onAfter 不破坏 P2-T3。
//
// 关于 setCtxVar：setCtxVar.apply 是 no-op（不写 state.localVars，只在
// SkillPhase 的 'atoms' 阶段处理器里写 ctx.localVars）。leiji 钩子读
// state.localVars（不是 SkillPhase 的 ctx），所以本测试直接 mutate
// state.localVars（与 _baguaJudgeInject.ts 同样的模式）。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth } from '../../engine-helpers';
import { registerAll as registerLeiji } from '../../fixtures/雷击';
import type { Atom, Card, GameState } from '@engine/types';

function makeSpadeKill(id: string): Card {
  return {
    id,
    name: '杀',
    type: '基本牌',
    subtype: '杀',
    suit: '♠',
    rank: '5',
    description: '',
  } as unknown as Card;
}

function useCard(source: string, target: string, cardId: string): Atom {
  // useCard 不在 Atom 联合里（[T-13] 决策下被 3 原子取代），
  // hook 注册仍按 'useCard' 字面量走；走 unknown cast 触发钩子。
  return { type: 'useCard', source, target, cardId } as unknown as Atom;
}

describe('雷击完整判定（真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerLeiji();
  });

  it('ctx.leijiJudgeResult=success → useCard 钩子 emit 3 点 thunder 伤害', () => {
    // 准备：张角（P2）手里有黑桃 5 杀 → 目标 P1 health=4
    let s0 = createTestGame({ playerCount: 2 });
    s0 = setHealth(s0, 'P1', 4);
    s0.players.P2.info.characterId = '张角';
    s0.players.P2.hand = ['leijiCard'];
    // 直接 mutate state.localVars（setCtxVar atom 当前 no-op 不写 state.localVars）
    const s1: GameState = {
      ...s0,
      localVars: { ...(s0.localVars ?? {}), leijiJudgeResult: 'success' },
      cardMap: { ...s0.cardMap, leijiCard: makeSpadeKill('leijiCard') },
    };
    const { state, logEntries: events } = applyAtoms(s1, [useCard('P2', 'P1', 'leijiCard')]);
    // leiji 钩子 onAfter 读 ctx=success → emit damage(3, thunder)
    // P1 health: 4 - 3 = 1
    expect(state.players.P1.health).toBe(1);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(1);
    const dmg = events.find((e) => e.atom.type === '造成伤害');
    if (dmg?.atom.type === '造成伤害') {
      expect(dmg.atom).toMatchObject({ amount: 3, damageType: 'thunder' });
    }
  });

  it('ctx.leijiJudgeResult=fail → useCard 钩子不 emit damage', () => {
    // 准备：张角（P2）手里有黑桃 5 杀 → 目标 P1 health=4
    let s0 = createTestGame({ playerCount: 2 });
    s0 = setHealth(s0, 'P1', 4);
    s0.players.P2.info.characterId = '张角';
    s0.players.P2.hand = ['leijiCard'];
    // ctx=fail
    const s1: GameState = {
      ...s0,
      localVars: { ...(s0.localVars ?? {}), leijiJudgeResult: 'fail' },
      cardMap: { ...s0.cardMap, leijiCard: makeSpadeKill('leijiCard') },
    };
    const { state, logEntries: events } = applyAtoms(s1, [useCard('P2', 'P1', 'leijiCard')]);
    // leiji 钩子 onAfter 读 ctx=fail → 不 emit damage
    // P1 health 不变（4）
    expect(state.players.P1.health).toBe(4);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(0);
  });
});
