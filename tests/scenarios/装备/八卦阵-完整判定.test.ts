// tests/scenarios/装备/八卦阵-完整判定.test.ts
//
// 八卦阵 v3 钩子：damage onBefore 读 ctx.localVars.baguaJudgeResult
// - 'red'  → 视为成功打出【闪】,damage cancel
// - 'black'→ 需继续出【闪】,damage 仍生效
// - 缺失   → 占位视为 'red' (damage cancel)
//
// useCard 阶段 inject 判定 prompt 留 follow-up (P2 不在本 Task 范围)。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import type { GameState } from '@engine/types';
import { createTestGame, setHealth, withArmor } from '../../engine-helpers';
import { registerAll as registerBagua } from '../../fixtures/八卦阵';

describe('八卦阵完整判定（真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerBagua();
  });

  it('判定红桃（ctx.baguaJudgeResult=red）→ 视为已打出闪，damage cancel', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'bagua');
    s0 = setHealth(s0, 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        kill1: {
          id: 'kill1',
          name: '杀',
          type: '基本牌',
          subtype: '杀',
          suit: '♠',
          rank: '5',
          description: '',
        },
      },
    };
    // 注入判定结果为红
    const s2: GameState = {
      ...s1,
      localVars: { ...(s1.localVars ?? {}), baguaJudgeResult: 'red' },
    };
    const { state } = applyAtoms(s2, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(4);
  });

  it('判定黑桃（ctx.baguaJudgeResult=black）→ 不视为闪，damage 仍生效', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'bagua');
    s0 = setHealth(s0, 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        kill1: {
          id: 'kill1',
          name: '杀',
          type: '基本牌',
          subtype: '杀',
          suit: '♠',
          rank: '5',
          description: '',
        },
      },
    };
    const s2: GameState = {
      ...s1,
      localVars: { ...(s1.localVars ?? {}), baguaJudgeResult: 'black' },
    };
    const { state } = applyAtoms(s2, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(3);
  });

  it('ctx.baguaJudgeResult 缺失 → 占位视为红（damage cancel）', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'bagua');
    s0 = setHealth(s0, 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        kill1: {
          id: 'kill1',
          name: '杀',
          type: '基本牌',
          subtype: '杀',
          suit: '♠',
          rank: '5',
          description: '',
        },
      },
    };
    const { state } = applyAtoms(s1, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(4);
  });
});
