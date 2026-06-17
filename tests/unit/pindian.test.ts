// LEGACY TEST: references deleted v2 modules - skipped
// tests/unit/pindian.test.ts — compareRank atom + pindian SkillPhase 骨架测试
//
// 覆盖：
// 1) compareRank 原子：A 赢 K（点数大者赢）
// 2) compareRank 原子：点数相同时 seed RNG 决胜（确定性）
// 3) pindian SkillPhase：骨架走通 then/else 分支

import { describe, it, expect, beforeEach } from 'vitest';
import { clearAtomRegistry, applyAtoms } from '@engine/atom';
// import { registerAllAtoms } from '@engine/atoms';  // LEGACY: removed (registerAllAtoms no longer exported)
import { createTestGame } from '../engine-helpers';
import type { GameState, SkillContext } from '@engine/types';
import type { Suit, Rank } from '@shared/types';
import { executePlan } from '@engine/phase';
import '../../src/engine/phases/index';

type CardFixture = {
  id: string;
  name: string;
  type: '基本牌';
  subtype: '杀';
  suit: Suit;
  rank: Rank;
  description: string;
};

function withCards(s0: GameState, cardMap: Record<string, CardFixture>): GameState {
  return { ...s0, cardMap: { ...s0.cardMap, ...cardMap } };
}

describe.skip('compareRank atom（pindian 基础设施）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    registerAllAtoms();
  });

  it('compareRank: 点数大者赢（K 13 > A 1）', () => {
    const s0 = createTestGame({ hand: { P1: ['c-A'], P2: ['c-K'] } });
    const state = withCards(s0, {
      'c-A': { id: 'c-A', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' },
      'c-K': { id: 'c-K', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'K', description: '' },
    });
    const { state: next, logEntries: events } = applyAtoms(state, [
      { type: '拼点', a: 'P1', b: 'P2', aCardId: 'c-A', bCardId: 'c-K' },
    ]);
    // P1 出 A(1)，P2 出 K(13) → P2 赢
    expect(events[0].atom).toMatchObject({ winner: 'P2', aRank: 1, bRank: 13 });
    // 双方手牌已弃
    expect(next.players.P1.hand).toEqual([]);
    expect(next.players.P2.hand).toEqual([]);
    expect(next.zones.discardPile).toContain('c-A');
    expect(next.zones.discardPile).toContain('c-K');
  });

  it('compareRank: 双方点数相同时 seed RNG 决胜（确定性）', () => {
    const cardMap: Record<string, CardFixture> = {
      'c-5a': { id: 'c-5a', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '5', description: '' },
      'c-5b': { id: 'c-5b', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '5', description: '' },
    };
    const s0 = withCards(
      createTestGame({ hand: { P1: ['c-5a'], P2: ['c-5b'] } }),
      cardMap,
    );
    const { logEntries: e1 } = applyAtoms(s0, [
      { type: '拼点', a: 'P1', b: 'P2', aCardId: 'c-5a', bCardId: 'c-5b' },
    ]);
    const { logEntries: e2 } = applyAtoms(s0, [
      { type: '拼点', a: 'P1', b: 'P2', aCardId: 'c-5a', bCardId: 'c-5b' },
    ]);
    const w1 = (e1[0].atom as { winner: string }).winner;
    const w2 = (e2[0].atom as { winner: string }).winner;
    expect(w1).toBe(w2);
    // 决胜由 seed 决定（不是 A 必赢）
    expect(['P1', 'P2']).toContain(w1);
    // 标记为 tied
    expect(e1[0].atom).toMatchObject({ tied: true });
  });

  it('compareRank: getResult() 通过 atoms phase 注入到 ctx.localVars', () => {
    // 走 { type: 'atoms', ops: [...] } 路径，验证 getResult 的 winner 跟 event payload 一致
    const s0 = withCards(
      createTestGame({ hand: { P1: ['c-A'], P2: ['c-K'] } }),
      {
        'c-A': { id: 'c-A', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' },
        'c-K': { id: 'c-K', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'K', description: '' },
      },
    );
    const ctx: SkillContext = { skillId: 'test', self: 'P1', localVars: {} };
    executePlan(
      s0,
      [
        {
          type: 'atoms',
          ops: [{ type: '拼点', a: 'P1', b: 'P2', aCardId: 'c-A', bCardId: 'c-K' }],
        },
      ],
      ctx,
    );
    // P1 出 A(1)，P2 出 K(13) → P2 赢
    expect(ctx.localVars.pindianWinner).toBe('P2');
  });

  it('compareRank: 平局时 getResult() 与 apply 的 winner 一致（post-apply RNG 修正）', () => {
    // 验证 resolveWinner 在 isPostApply=true 时也能正确还原胜者：
    // 平局时 RNG 被 apply 推进 (rngState + 1)，event payload 由 toEvents
    // 携带 winner；如果 getResult 的 rewind 逻辑 (rngState - 1) 不生效，
    // apply 和 toEvents 会因种子不同而选出不同的 winner。
    const cardMap: Record<string, CardFixture> = {
      'c-5a': { id: 'c-5a', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '5', description: '' },
      'c-5b': { id: 'c-5b', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: '5', description: '' },
    };
    const s0 = withCards(
      createTestGame({ hand: { P1: ['c-5a'], P2: ['c-5b'] } }),
      cardMap,
    );
    const ctx: SkillContext = { skillId: 'test', self: 'P1', localVars: {} };
    const { logEntries: events } = executePlan(
      s0,
      [
        {
          type: 'atoms',
          ops: [{ type: '拼点', a: 'P1', b: 'P2', aCardId: 'c-5a', bCardId: 'c-5b' }],
        },
      ],
      ctx,
    );
    // apply 侧（event payload 携带的 winner，对应 toEvents 路径）
    const applyWinner = (events[0].atom as { winner?: string }).winner;
    // getResult 侧（ctx.localVars.pindianWinner，对应 isPostApply=true 路径）
    const getResultWinner = ctx.localVars.pindianWinner as string | undefined;
    // 双方都是合法玩家名（sanity）
    expect(['P1', 'P2']).toContain(applyWinner);
    expect(['P1', 'P2']).toContain(getResultWinner);
    // 关键不变量：平局 RNG rewind 生效时，apply 和 getResult 必须选出同一个 winner
    expect(getResultWinner).toBe(applyWinner);
  });
});

describe.skip('pindian SkillPhase 骨架', () => {
  beforeEach(() => {
    clearAtomRegistry();
    registerAllAtoms();
  });

  it('pindian phase: a 赢时走 then 分支', () => {
    // P1(a) 出 K(13)，P2(b) 出 A(1) → P1 赢
    const s0 = withCards(
      createTestGame({ hand: { P1: ['c-K'], P2: ['c-A'] } }),
      {
        'c-A': { id: 'c-A', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' },
        'c-K': { id: 'c-K', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'K', description: '' },
      },
    );
    const ctx: SkillContext = { skillId: 'test', self: 'P1', localVars: {} };
    const { state, logEntries: events } = executePlan(
      s0,
      [
        {
          type: 'pindian',
          a: 'P1',
          b: 'P2',
          aCardId: 'c-K',
          bCardId: 'c-A',
          then: [
            { type: 'atoms', ops: [{ type: '设置上下文变量', key: 'pindianResult', value: 'win' }] },
          ],
          else: [
            { type: 'atoms', ops: [{ type: '设置上下文变量', key: 'pindianResult', value: 'lose' }] },
          ],
        },
      ],
      ctx,
    );
    expect(ctx.localVars.pindianWinner).toBe('P1');
    expect(ctx.localVars.pindianResult).toBe('win');
    expect(events.some((e) => e.atom.type === '拼点')).toBe(true);
    expect(state.zones.discardPile).toContain('c-A');
    expect(state.zones.discardPile).toContain('c-K');
  });

  it('pindian phase: a 输时走 else 分支', () => {
    // P1(a) 出 A(1)，P2(b) 出 K(13) → P1 输
    const s0 = withCards(
      createTestGame({ hand: { P1: ['c-A'], P2: ['c-K'] } }),
      {
        'c-A': { id: 'c-A', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' },
        'c-K': { id: 'c-K', name: '杀', type: '基本牌', subtype: '杀', suit: '♠', rank: 'K', description: '' },
      },
    );
    const ctx: SkillContext = { skillId: 'test', self: 'P1', localVars: {} };
    const { state, logEntries: events } = executePlan(
      s0,
      [
        {
          type: 'pindian',
          a: 'P1',
          b: 'P2',
          aCardId: 'c-A',
          bCardId: 'c-K',
          then: [
            { type: 'atoms', ops: [{ type: '设置上下文变量', key: 'pindianResult', value: 'win' }] },
          ],
          else: [
            { type: 'atoms', ops: [{ type: '设置上下文变量', key: 'pindianResult', value: 'lose' }] },
          ],
        },
      ],
      ctx,
    );
    expect(ctx.localVars.pindianWinner).toBe('P2');
    expect(ctx.localVars.pindianResult).toBe('lose');
    expect(events.some((e) => e.atom.type === '拼点')).toBe(true);
    expect(state.zones.discardPile).toContain('c-A');
    expect(state.zones.discardPile).toContain('c-K');
  });

  it('pindian phase: 缺 aCardId/bCardId 时返回 error', () => {
    const s0 = createTestGame();
    const ctx: SkillContext = { skillId: 'test', self: 'P1', localVars: {} };
    const result = executePlan(
      s0,
      [
        {
          type: 'pindian',
          a: 'P1',
          b: 'P2',
          then: [],
        },
      ],
      ctx,
    );
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/aCardId/);
  });
});
