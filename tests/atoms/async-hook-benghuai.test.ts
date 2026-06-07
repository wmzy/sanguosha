// tests/atoms/async-hook-benghuai.test.ts
//
// ADR 0025 端到端 PoC：崩坏（董卓）AsyncHook 完整路径验证。
//
// 验证：
// 1. applyAtomsAsync 监听 阶段结束 atom，触发 benghuai-async 钩子
// 2. 钩子 await pending(...) 挂起，applyAtomsAsync 返回 AsyncPending
// 3. 模拟玩家响应：再次 applyAtomsAsync 带 _resume 参数
// 4. 钩子从 await 恢复，根据响应 emit 失去体力 atom
// 5. 最终 state.players.P1.health -1

import { describe, it, expect, beforeEach } from 'vitest';
import { AsyncHookRegistry } from '@engine/async-hook';
import { applyAtomsAsync } from '@engine/atom-async';
import { createTestGame, setHealth } from '../engine-helpers';
import { bengHuaiAsyncHook } from '@engine/skills/崩坏.async';
import type { GameState, Atom } from '@engine/types';
import type { ResumeData } from '@engine/async-hook';

describe('AsyncHook PoC — 崩坏（董卓）', () => {
  let registry: AsyncHookRegistry;
  let state: GameState;

  beforeEach(() => {
    registry = new AsyncHookRegistry();
    registry.register(bengHuaiAsyncHook);
    // 3 人局：董卓 P1（体力 5）、刘备 P2（体力 3）、张飞 P3（体力 3）
    // P1 体力非最低 → 崩坏触发
    let s = createTestGame({ characters: ['董卓', '刘备', '张飞'] });
    s = setHealth(setHealth(setHealth(s, 'P1', 5), 'P2', 3), 'P3', 3);
    // 同步 maxHealth 避免 health > maxHealth
    s = { ...s, players: { ...s.players, P1: { ...s.players.P1, maxHealth: 5 } } };
    state = s;
  });

  it('体力最低时崩坏不触发', async () => {
    // 把 P1 体力降到最低
    const lowState = setHealth(state, 'P1', 1);
    const result = await applyAtomsAsync(
      lowState,
      [{ type: '阶段结束', phase: '结束', player: 'P1' } as Atom],
      { asyncHooks: registry },
    );
    // filter 过滤：不挂 pending
    expect(result.pending).toBeNull();
    // state 未变
    expect(result.state.players.P1.health).toBe(1);
  });

  it('体力非最低时崩坏挂 pending，等玩家响应', async () => {
    const result = await applyAtomsAsync(
      state,
      [{ type: '阶段结束', phase: '结束', player: 'P1' } as Atom],
      { asyncHooks: registry },
    );
    // 钩子挂起
    expect(result.pending).not.toBeNull();
    expect(result.pending?.type).toBe('异步钩子挂起');
    expect(result.pending?.hookId).toBe('benghuai-async');
    expect(result.pending?.def.ui.title).toBe('崩坏');
    expect(result.pending?.def.ui.options).toHaveLength(2);
    // 挂起时 state 未变（体力 5 仍是 5）
    expect(result.state.players.P1.health).toBe(5);
  });

  it('玩家选 "health" 减体力 → 失去体力 atom apply', async () => {
    // 第一步：触发钩子挂起
    const first = await applyAtomsAsync(
      state,
      [{ type: '阶段结束', phase: '结束', player: 'P1' } as Atom],
      { asyncHooks: registry },
    );
    expect(first.pending).not.toBeNull();

    // 第二步：传 _resume 走恢复路径
    const resume: ResumeData = { kind: 'response', value: 'health' };
    const second = await applyAtomsAsync(
      first.state,
      [first.pending!.atomSnapshot!],
      { asyncHooks: registry },
      0,
      { resume },
    );
    expect(second.state.players.P1.health).toBe(4);
  });

  it('玩家选 "maxHealth" 减体力上限 → 设上限 atom apply', async () => {
    const first = await applyAtomsAsync(
      state,
      [{ type: '阶段结束', phase: '结束', player: 'P1' } as Atom],
      { asyncHooks: registry },
    );
    const resume: ResumeData = { kind: 'response', value: 'maxHealth' };
    const second = await applyAtomsAsync(
      first.state,
      [first.pending!.atomSnapshot!],
      { asyncHooks: registry },
      0,
      { resume },
    );
    expect(second.state.players.P1.maxHealth).toBe(4);
    // 设上限副作用：health 也 cap 到 maxHealth
    expect(second.state.players.P1.health).toBe(4);
  });

  it('玩家取消（cancel）→ 钩子 return continue，无副作用', async () => {
    const first = await applyAtomsAsync(
      state,
      [{ type: '阶段结束', phase: '结束', player: 'P1' } as Atom],
      { asyncHooks: registry },
    );
    const resume: ResumeData = { kind: 'cancel' };
    const second = await applyAtomsAsync(
      first.state,
      [first.pending!.atomSnapshot!],
      { asyncHooks: registry },
      0,
      { resume },
    );
    expect(second.state.players.P1.health).toBe(5);
    expect(second.state.players.P1.maxHealth).toBe(5);
    expect(second.pending).toBeNull();
  });

  it('超时（timeout）→ 同 cancel 路径', async () => {
    const first = await applyAtomsAsync(
      state,
      [{ type: '阶段结束', phase: '结束', player: 'P1' } as Atom],
      { asyncHooks: registry },
    );
    const resume: ResumeData = { kind: 'timeout' };
    const second = await applyAtomsAsync(
      first.state,
      [first.pending!.atomSnapshot!],
      { asyncHooks: registry },
      0,
      { resume },
    );
    expect(second.state.players.P1.health).toBe(5);
    expect(second.state.players.P1.maxHealth).toBe(5);
  });
});
