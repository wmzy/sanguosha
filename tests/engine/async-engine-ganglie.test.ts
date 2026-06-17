// LEGACY TEST: references deleted v2 modules - skipped
// tests/engine/async-engine-ganglie.test.ts
//
// 阶段 D-3 刚烈 AsyncHook 端到端 PoC。
// 验证：监听 造成伤害 atom → 同步 judge → 非红桃时挂起等玩家响应

import { describe, it, expect, beforeEach } from 'vitest';
// import { createAsyncEngine } from '@engine/async-engine';  // LEGACY: removed (v2 module deleted)
// import { AsyncHookRegistry, type ResumeData } from '@engine/async-hook';  // LEGACY: removed (v2 module deleted)
import { gangLieAsyncHook } from '@engine/skills/刚烈.async';
import { createTestGame, setHealth } from '../engine-helpers';
import type { GameState, Atom } from '@engine/types';
import type { Card } from '@shared/types';

describe.skip('createAsyncEngine — 刚烈（夏侯惇）端到端集成', () => {
  let state: GameState;
  let asyncHooks: AsyncHookRegistry;
  // 把牌堆顶部设为指定花色/点数
  const setDeckTop = (s: GameState, suit: Card['suit'], rank: string, cardId = 'test-card'): GameState => {
    const card: Card = {
      id: cardId,
      name: '杀',
      type: '基本牌',
      subtype: '杀',
      suit,
      rank,
      description: '',
    };
    // 把 cardId 放牌堆顶（数组末尾 = 顶部）
    return {
      ...s,
      cardMap: { ...s.cardMap, [cardId]: card },
      zones: { ...s.zones, deck: [...s.zones.deck, cardId] },
    };
  };

  beforeEach(() => {
    asyncHooks = new AsyncHookRegistry();
    asyncHooks.register(gangLieAsyncHook);
    // 2 人局：夏侯惇 P1（4 血）vs 曹操 P2（4 血）
    let s = createTestGame({ characters: ['夏侯惇', '曹操'] });
    s = setHealth(setHealth(s, 'P1', 4), 'P2', 4);
    state = s;
  });

  it('判定红桃 → 不挂 pending，钩子 return continue', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    // 牌堆顶放红桃 5
    let s0 = setDeckTop(state, '♥', '5');
    // 曹操 P2 给 P1 造成 1 点伤害
    const result = await engine.dispatchAsync(s0, {
      type: '造成伤害',
      target: 'P1',
      amount: 1,
      source: 'P2',
    } as Atom);
    // 不挂起
    expect(result.state.pending).toBeNull();
    // P1 受伤 1 点
    expect(result.state.players.P1.health).toBe(3);
  });

  it('判定非红桃 → 挂 pending，等玩家选弃牌/受伤', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    // 牌堆顶放黑桃 7
    const s0 = setDeckTop(state, '♠', '7');
    const result = await engine.dispatchAsync(s0, {
      type: '造成伤害',
      target: 'P1',
      amount: 1,
      source: 'P2',
    } as Atom);
    // 钩子挂起
    expect(result.state.pending).not.toBeNull();
    expect(result.state.pending?.type).toBe('异步钩子挂起');
    const pending = result.state.pending as { type: '异步钩子挂起'; hookId: string; def: { ui: { title: string; options: Array<{ value: string }> } } };
    expect(pending.hookId).toBe('ganglie-async');
    expect(pending.def.ui.title).toBe('刚烈');
    expect(pending.def.ui.options).toHaveLength(2);
    // P1 还没受伤（damage atom 没 apply——钩子在 onAfter，damage 已 apply，P1 受伤 1 点）
    expect(result.state.players.P1.health).toBe(3);
  });

  it('玩家选 "damage" → 来源受 1 点伤害（曹操 P2 受伤）', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    const s0 = setDeckTop(state, '♠', '7');
    const first = await engine.dispatchAsync(s0, {
      type: '造成伤害',
      target: 'P1',
      amount: 1,
      source: 'P2',
    } as Atom);
    const pendingId = (first.state.pending as { id: string }).id;
    const second = await engine.resolveAsyncHookResponse(
      first.state,
      pendingId,
      { kind: 'response', value: 'damage' } as ResumeData,
    );
    // P1 受伤 1 点（P2 给的 damage）
    expect(second.state.players.P1.health).toBe(3);
    // P2 受 1 点反击伤害
    expect(second.state.players.P2.health).toBe(3);
    expect(second.state.pending).toBeNull();
  });

  it('玩家选 "discard" → PoC 阶段 no-op（多步 prompt 留 follow-up）', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    const s0 = setDeckTop(state, '♠', '7');
    const first = await engine.dispatchAsync(s0, {
      type: '造成伤害',
      target: 'P1',
      amount: 1,
      source: 'P2',
    } as Atom);
    const pendingId = (first.state.pending as { id: string }).id;
    const second = await engine.resolveAsyncHookResponse(
      first.state,
      pendingId,
      { kind: 'response', value: 'discard' } as ResumeData,
    );
    // P1 仍 3 血（已受伤），P2 仍 4 血（没反击）
    expect(second.state.players.P1.health).toBe(3);
    expect(second.state.players.P2.health).toBe(4);
    expect(second.state.pending).toBeNull();
  });

  it('体力非夏侯惇的目标 → filter 拒绝，不触发钩子', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    const s0 = setDeckTop(state, '♠', '7');
    // 给 P2（曹操）造成伤害
    const result = await engine.dispatchAsync(s0, {
      type: '造成伤害',
      target: 'P2',
      amount: 1,
      source: 'P1',
    } as Atom);
    expect(result.state.pending).toBeNull();
    expect(result.state.players.P2.health).toBe(3);
  });
});
