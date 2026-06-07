/**
 * tests/atom-result-inject.test.ts — Atom getResult 自动注入 ctx.localVars 测试
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { executePlan } from '@engine/phase';
import type { SkillContext, GameState, SkillPhase } from '@engine/types';
import { createTestGame } from './engine-helpers';

import '../engine/atoms/index';
import '../engine/phases/index';

function makeCtx(overrides?: Partial<SkillContext>): SkillContext {
  return {
    skillId: 'test-skill',
    self: 'P1',
    localVars: {},
    ...overrides,
  };
}

describe('Atom getResult 自动注入 ctx.localVars', () => {
  let state: GameState;

  beforeAll(() => {
    state = createTestGame({ playPhase: true, seed: 42 });
  });

  it('judge atom 执行后 ctx.localVars 包含 judgeCardId/judgeSuit/judgeColor', () => {
    const ctx = makeCtx();
    const plan: SkillPhase[] = [
      {
        type: 'atoms',
        ops: [
          { type: '判定', player: 'P1' },
        ],
      },
    ];

    const result = executePlan(state, plan, ctx);
    expect(result.error).toBeUndefined();
    expect(ctx.localVars.judgeCardId).toBeDefined();
    expect(typeof ctx.localVars.judgeCardId).toBe('string');
    expect(ctx.localVars.judgeSuit).toBeDefined();
    expect(typeof ctx.localVars.judgeSuit).toBe('string');
    expect(ctx.localVars.judgeColor).toBeDefined();
    expect(['red', 'black']).toContain(ctx.localVars.judgeColor);

    const cardId = ctx.localVars.judgeCardId as string;
    const card = result.state.cardMap[cardId];
    expect(card).toBeDefined();
  });

  it('discardRandom atom 执行后 ctx.localVars 包含 discardedCardId', () => {
    const ctx = makeCtx();
    const plan: SkillPhase[] = [
      {
        type: 'atoms',
        ops: [
          { type: '随机弃置', player: 'P1', count: 1, from: '手牌' },
        ],
      },
    ];

    const beforeHand = state.players.P1.hand.length;
    expect(beforeHand).toBeGreaterThan(0);

    const result = executePlan(state, plan, ctx);
    expect(result.error).toBeUndefined();
    expect(ctx.localVars.discardedCardId).toBeDefined();
    expect(typeof ctx.localVars.discardedCardId).toBe('string');

    const discardedId = ctx.localVars.discardedCardId as string;
    expect(result.state.cardMap[discardedId]).toBeDefined();
    expect(result.state.players.P1.hand).not.toContain(discardedId);
    expect(result.state.zones.discardPile).toContain(discardedId);
  });

  it('judge 后跟 condition phase 读取 localVars 正确判断', () => {
    const ctx = makeCtx();
    const plan: SkillPhase[] = [
      {
        type: 'atoms',
        ops: [
          { type: '判定', player: 'P1' },
        ],
      },
      {
        type: 'condition',
        check: { hasValue: { $: 'ctx', path: 'localVars.judgeCardId' } },
        then: [
          {
            type: 'atoms',
            ops: [
              { type: '摸牌', player: 'P1', count: 1 },
            ],
          },
        ],
        else: [
          {
            type: 'atoms',
            ops: [
              { type: '摸牌', player: 'P1', count: 2 },
            ],
          },
        ],
      },
    ];

    const beforeHand = state.players.P1.hand.length;
    const result = executePlan(state, plan, ctx);
    expect(result.error).toBeUndefined();
    expect(ctx.localVars.judgeCardId).toBeDefined();
    expect(result.state.players.P1.hand.length).toBe(beforeHand + 1);
  });

  it('多个 atom 结果顺序合并到 localVars', () => {
    const ctx = makeCtx();
    const plan: SkillPhase[] = [
      {
        type: 'atoms',
        ops: [
          { type: '判定', player: 'P1' },
          { type: '随机弃置', player: 'P2', count: 1, from: '手牌' },
        ],
      },
    ];

    const result = executePlan(state, plan, ctx);
    expect(result.error).toBeUndefined();
    expect(ctx.localVars.judgeCardId).toBeDefined();
    expect(ctx.localVars.judgeSuit).toBeDefined();
    expect(ctx.localVars.judgeColor).toBeDefined();
    expect(ctx.localVars.discardedCardId).toBeDefined();
  });
});
