// tests/scenarios/装备/八卦阵-useCard判定.test.ts
//
// 八卦阵 v3 钩子完整 useCard 阶段判定注入（真 game rule）：
// - 装备八卦阵的角色被【杀】指定为目标的瞬间（becomeTarget 阶段）
//   → 钩子读 deck 顶牌花色 → 写入 state.localVars.baguaJudgeResult
//   → 后续 damage onBefore 读 ctx.baguaJudgeResult 决定是否 cancel
// - 红桃/方块（红）→ cancel（视为闪）
// - 黑桃/梅花（黑）→ 不 cancel（需继续出闪）
//
// 与 八卦阵-完整判定.test.ts（P2-T4）的区别：本 Task 走 端到端 becomeTarget → damage，
// 不手工注入 localVars，验证 hook 链完整落地。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, withArmor, setHealth } from '../../engine-helpers';
import { registerAll as registerBagua } from '../../fixtures/八卦阵';
import { registerAll as registerBaguaJudge } from '../../fixtures/八卦阵判定';
import type { Atom, Card, GameState } from '@engine/types';

function makeKill(id: string, suit: '♠' | '♥' | '♣' | '♦', rank: '5' | 'A' = '5') {
  return {
    id,
    name: '杀' as const,
    type: '基本牌' as const,
    subtype: '杀' as const,
    suit,
    rank,
    description: '',
  } satisfies Card;
}

describe('八卦阵 useCard 阶段完整判定（真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerBagua();
    registerBaguaJudge();
  });

  it('装备八卦阵，deck 顶牌为红桃 → baguaJudgeResult=red → damage cancel', () => {
    let s0 = createTestGame({ deck: ['ht5'] });
    s0 = withArmor(s0, 'P1', '八卦阵');
    s0 = setHealth(s0, 'P1', 4);
    s0 = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        ht5: makeKill('ht5', '♥'),
        kill1: makeKill('kill1', '♠', 'A'),
      },
    };
    // becomeTarget 钩子：自动读 deck 顶 ht5（红）→ 写入 state.localVars.baguaJudgeResult='red'
    const becomeAtom: Atom = {
      type: '成为目标',
      cardId: 'kill1',
      source: 'P2',
      target: 'P1',
    };
    const s1 = applyAtoms(s0, [becomeAtom]).state;
    const { state } = applyAtoms(s1, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    // baguaJudgeResult='red' → damage cancel → P1 health=4
    expect(state.players.P1.health).toBe(4);
  });

  it('装备八卦阵，deck 顶牌为黑桃 → baguaJudgeResult=black → damage 不 cancel', () => {
    let s0 = createTestGame({ deck: ['st5'] });
    s0 = withArmor(s0, 'P1', '八卦阵');
    s0 = setHealth(s0, 'P1', 4);
    s0 = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        st5: makeKill('st5', '♠'),
        kill1: makeKill('kill1', '♠', 'A'),
      },
    };
    const becomeAtom: Atom = {
      type: '成为目标',
      cardId: 'kill1',
      source: 'P2',
      target: 'P1',
    };
    const s1 = applyAtoms(s0, [becomeAtom]).state;
    const { state } = applyAtoms(s1, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    // baguaJudgeResult='black' → damage 不 cancel → P1 health=3
    expect(state.players.P1.health).toBe(3);
  });

  it('装备八卦阵但 deck 空 → 钩子跳过判定 → state.localVars 未设 → damage cancel（默认 red）', () => {
    // 兼容路径：deck 空（reshuffle 尚未触发）→ 钩子 no-op，bagua damage onBefore
    // 走默认 'red' 占位 cancel 行为。
    let s0: GameState = createTestGame({ deck: [] });
    s0 = withArmor(s0, 'P1', '八卦阵');
    s0 = setHealth(s0, 'P1', 4);
    s0 = {
      ...s0,
      cardMap: { ...s0.cardMap, kill1: makeKill('kill1', '♠', 'A') },
    };
    const becomeAtom: Atom = {
      type: '成为目标',
      cardId: 'kill1',
      source: 'P2',
      target: 'P1',
    };
    const s1 = applyAtoms(s0, [becomeAtom]).state;
    const { state } = applyAtoms(s1, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(4);
  });
});
