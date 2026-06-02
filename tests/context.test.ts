/**
 * tests/v2/context.test.ts — 技能上下文构建
 */
import { describe, it, expect } from 'vitest';
import { buildSkillContext } from '@engine/context';
import type { GameEvent, TriggerRule } from '@engine/types';
import { createTestGame } from './engine-helpers';

function trigger(overrides?: Partial<TriggerRule>): TriggerRule {
  return {
    event: 'damageReceived',
    source: 'character',
    skillId: 'jianxiong',
    player: 'P1',
    priority: 100,
    ...overrides,
  };
}

describe('buildSkillContext', () => {
  const state = createTestGame();

  it('extracts target from event.target', () => {
    const event: GameEvent = { type: 'damageReceived', target: 'P2', source: 'P1', amount: 1 };
    const ctx = buildSkillContext(state, event, trigger());
    expect(ctx.target).toBe('P2');
  });

  it('falls back to defender when target absent', () => {
    const event: GameEvent = { type: 'killHit', attacker: 'P1', defender: 'P2' };
    const ctx = buildSkillContext(state, event, trigger());
    expect(ctx.target).toBe('P2');
  });

  it('extracts source from event.source', () => {
    const event: GameEvent = { type: 'damageReceived', target: 'P2', source: 'P1', amount: 1 };
    const ctx = buildSkillContext(state, event, trigger());
    expect(ctx.source).toBe('P1');
  });

  it('falls back to attacker when source absent', () => {
    const event: GameEvent = { type: 'killHit', attacker: 'P1', defender: 'P2' };
    const ctx = buildSkillContext(state, event, trigger());
    expect(ctx.source).toBe('P1');
  });

  it('extracts sourceCard from event.cardId', () => {
    const event: GameEvent = { type: 'cardPlayed', player: 'P1', cardId: 'card-123' };
    const ctx = buildSkillContext(state, event, trigger());
    expect(ctx.sourceCard).toBe('card-123');
  });

  it('sets skillId and self from trigger', () => {
    const event: GameEvent = { type: 'damageReceived', target: 'P2', source: 'P1', amount: 1 };
    const t = trigger({ skillId: 'fankui', player: 'P2' });
    const ctx = buildSkillContext(state, event, t);
    expect(ctx.skillId).toBe('fankui');
    expect(ctx.self).toBe('P2');
  });

  it('initializes localVars as empty object', () => {
    const event: GameEvent = { type: 'damageReceived', target: 'P2', source: 'P1', amount: 1 };
    const ctx = buildSkillContext(state, event, trigger());
    expect(ctx.localVars).toEqual({});
  });

  it('passes event through', () => {
    const event: GameEvent = { type: 'turnStart', player: 'P1' };
    const ctx = buildSkillContext(state, event, trigger());
    expect(ctx.event).toBe(event);
  });

  it('handles events with no optional fields', () => {
    const event: GameEvent = { type: 'turnStart', player: 'P1' };
    const ctx = buildSkillContext(state, event, trigger());
    expect(ctx.target).toBeUndefined();
    expect(ctx.source).toBeUndefined();
    expect(ctx.sourceCard).toBeUndefined();
  });
});
