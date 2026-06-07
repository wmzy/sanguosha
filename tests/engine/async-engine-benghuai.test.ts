// tests/engine/async-engine-benghuai.test.ts
//
// 阶段 D-2 集成测试：createAsyncEngine 把 AsyncHook 接入 dispatchAsync 路径。
// 验证：
// 1. dispatchAsync 触发 AsyncHook 钩子挂起 → state.pending 写入 PendingAsyncHook
// 2. dispatch 收到 '异步钩子响应' action → 调 applyAtomsAsync 恢复
// 3. 钩子返回 additionalAtoms 正确 apply（health / maxHealth 改变）
// 4. 错位响应（pendingId 不匹配）拒绝
// 5. 挂起期间其它 action 拒绝

import { describe, it, expect, beforeEach } from 'vitest';
import { createAsyncEngine } from '@engine/async-engine';
import { AsyncHookRegistry } from '@engine/async-hook';
import { bengHuaiAsyncHook } from '@engine/skills/崩坏.async';
import { createTestGame, setHealth } from '../engine-helpers';
import type { GameState, Atom } from '@engine/types';

describe('createAsyncEngine — 崩坏（董卓）端到端集成', () => {
  let state: GameState;
  let asyncHooks: AsyncHookRegistry;

  beforeEach(() => {
    asyncHooks = new AsyncHookRegistry();
    asyncHooks.register(bengHuaiAsyncHook);

    // 3 人局：董卓 P1（体力 5，maxHealth 5）vs 刘备 P2（3）/ 张飞 P3（3）
    let s = createTestGame({ characters: ['董卓', '刘备', '张飞'] });
    s = setHealth(setHealth(setHealth(s, 'P1', 5), 'P2', 3), 'P3', 3);
    s = { ...s, players: { ...s.players, P1: { ...s.players.P1, maxHealth: 5 } } };
    state = s;
  });

  it('dispatchAsync 触发 AsyncHook 挂起 → state.pending 写入 PendingAsyncHook', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    const result = await engine.dispatchAsync(state, {
      type: '阶段结束',
      player: 'P1',
    });
    // state.pending 是 PendingAsyncHook
    expect(result.state.pending).not.toBeNull();
    expect(result.state.pending?.type).toBe('异步钩子挂起');
    const pending = result.state.pending as { type: '异步钩子挂起'; hookId: string; def: { ui: { title: string } } };
    expect(pending.hookId).toBe('benghuai-async');
    expect(pending.def.ui.title).toBe('崩坏');
  });

  it('挂起期间收到非 异步钩子响应 action → 拒绝', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    const first = await engine.dispatchAsync(state, { type: '阶段结束', player: 'P1' });
    expect(first.state.pending).not.toBeNull();
    // 玩家误打 '结束回合' action
    const rejected = await engine.dispatchAsync(first.state, {
      type: '结束回合',
      player: 'P1',
    });
    expect(rejected.error).toMatch(/异步钩子挂起期间只接受/);
    // state 未变（仍挂起）
    expect(rejected.state.pending).not.toBeNull();
  });

  it('错位响应（pendingId 不匹配）拒绝', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    const first = await engine.dispatchAsync(state, { type: '阶段结束', player: 'P1' });
    const wrongId = await engine.dispatchAsync(first.state, {
      type: '异步钩子响应',
      pendingId: 'wrong-id',
      resume: { kind: 'response', value: 'health' },
    });
    expect(wrongId.error).toMatch(/pendingId 不匹配/);
  });

  it('玩家选 "health" → 完整恢复并 apply 失去体力 atom', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    const first = await engine.dispatchAsync(state, { type: '阶段结束', player: 'P1' });
    const pendingId = (first.state.pending as { id: string }).id;
    const second = await engine.dispatchAsync(first.state, {
      type: '异步钩子响应',
      pendingId,
      resume: { kind: 'response', value: 'health' },
    });
    expect(second.error).toBeUndefined();
    expect(second.state.players.P1.health).toBe(4);
    expect(second.state.pending).toBeNull();
  });

  it('玩家选 "maxHealth" → 完整恢复并 apply 设上限 atom', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    const first = await engine.dispatchAsync(state, { type: '阶段结束', player: 'P1' });
    const pendingId = (first.state.pending as { id: string }).id;
    const second = await engine.dispatchAsync(first.state, {
      type: '异步钩子响应',
      pendingId,
      resume: { kind: 'response', value: 'maxHealth' },
    });
    expect(second.error).toBeUndefined();
    expect(second.state.players.P1.maxHealth).toBe(4);
    // 设上限副作用：health 也 cap 到 maxHealth
    expect(second.state.players.P1.health).toBe(4);
    expect(second.state.pending).toBeNull();
  });

  it('玩家取消 → 钩子 return continue，无副作用', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    const first = await engine.dispatchAsync(state, { type: '阶段结束', player: 'P1' });
    const pendingId = (first.state.pending as { id: string }).id;
    const second = await engine.dispatchAsync(first.state, {
      type: '异步钩子响应',
      pendingId,
      resume: { kind: 'cancel' },
    });
    expect(second.error).toBeUndefined();
    expect(second.state.players.P1.health).toBe(5);
    expect(second.state.players.P1.maxHealth).toBe(5);
    expect(second.state.pending).toBeNull();
  });

  it('体力最低时 filter 过滤 → 不挂 pending', async () => {
    const engine = createAsyncEngine({ asyncHooks });
    const lowState = setHealth(state, 'P1', 1);
    const result = await engine.dispatchAsync(lowState, { type: '阶段结束', player: 'P1' });
    expect(result.state.pending).toBeNull();
    expect(result.state.players.P1.health).toBe(1);
  });
});
