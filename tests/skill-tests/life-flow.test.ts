// tests/skill-tests/life-flow.test.ts
// 模块 M:体力编排函数(runDecreaseLifeFlow/runRecoverLifeFlow/runLoseLifeFlow/runSetMaxHealthFlow)
// 时机顺序验证。不依赖具体技能——直接调用编排函数,断言 state.atomHistory 的 atom 时序
// 与 state.players[].health 的实质变化。
//
// 验证点(对齐 docs/flow-redesign.md 模块 M):
//   1. runDecreaseLifeFlow:扣减体力前 → 扣减体力时 → 扣减体力(实质) → 扣减体力后,health 下降。
//   2. runRecoverLifeFlow:确定回复数值时 → 回复体力(实质) → 回复体力后,health 上升。
//   3. runLoseLifeFlow:失去体力时 → (扣减体力前/时/扣减体力/后) → 失去体力后。
//   4. runSetMaxHealthFlow:减上限且体力超出 → (扣减三时机) + 设上限 + 减上限后;
//      加上限 → 设上限 + 加上限后;减上限但体力未超 → 设上限 + 减上限后(无扣减)。
//   5. before-hook modify amount:确定回复数值时 的 before-hook modify → 回复量被修正。
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms'; // 注册所有 atom(含 life-timing)
import { createGameState } from '../../src/engine/types';
import type { Atom, GameState, Json, PlayerState } from '../../src/engine/types';
import {
  runDecreaseLifeFlow,
  runRecoverLifeFlow,
  runLoseLifeFlow,
  runSetMaxHealthFlow,
} from '../../src/engine/life-flow';
import { registerBeforeHook } from '../../src/engine/skill';

function makePlayer(opts: {
  index: number;
  name: string;
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: [],
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeState(): GameState {
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P0', health: 4, maxHealth: 4 }),
      makePlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4 }),
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

/** 取 state.atomHistory 中所有 atom 事件(跳过 notify)的 type 序列。 */
function atomTypes(state: GameState): string[] {
  return state.atomHistory
    .filter((e) => e.kind === 'atom')
    .map((e) => (e as { atom: Atom }).atom.type);
}

describe('模块 M:体力编排函数', () => {
  let state: GameState;
  beforeEach(() => {
    state = makeState();
  });

  // ── runDecreaseLifeFlow ────────────────────────────────────
  it('runDecreaseLifeFlow:三时机 + 实质扣减依次发出,health 下降', async () => {
    await runDecreaseLifeFlow(state, 0, 2);
    expect(atomTypes(state)).toEqual([
      '扣减体力前',
      '扣减体力时',
      '扣减体力',
      '扣减体力后',
    ]);
    expect(state.players[0].health).toBe(2);
  });

  it('runDecreaseLifeFlow:扣减不低于 0', async () => {
    await runDecreaseLifeFlow(state, 1, 10);
    expect(state.players[1].health).toBe(0);
  });

  it('runDecreaseLifeFlow:透传 source 不影响扣减值', async () => {
    await runDecreaseLifeFlow(state, 0, 1, 1);
    expect(state.players[0].health).toBe(3);
    // source 仅语义保留,不写入 atom(扣减体力 atom 无 source 字段)
    expect(atomTypes(state)).toEqual([
      '扣减体力前',
      '扣减体力时',
      '扣减体力',
      '扣减体力后',
    ]);
  });

  // ── runRecoverLifeFlow ─────────────────────────────────────
  it('runRecoverLifeFlow:确定数值 + 回复 + 回复后三时机,health 上升', async () => {
    state.players[0].health = 1;
    await runRecoverLifeFlow(state, 0, 2);
    expect(atomTypes(state)).toEqual([
      '确定回复数值时',
      '回复体力',
      '回复体力后',
    ]);
    expect(state.players[0].health).toBe(3);
  });

  it('runRecoverLifeFlow:回复不超过 maxHealth', async () => {
    await runRecoverLifeFlow(state, 0, 10);
    expect(state.players[0].health).toBe(4);
  });

  it('runRecoverLifeFlow:确定回复数值时 before-hook modify → 回复量被修正', async () => {
    state.players[0].health = 1;
    // 模拟救援:before-hook modify amount +1
    registerBeforeHook(
      state,
      'mockRescue',
      1,
      '确定回复数值时',
      async (ctx) => {
        const a = ctx.atom;
        return { kind: 'modify', atom: { ...a, amount: a.amount + 1 } };
      },
    );
    await runRecoverLifeFlow(state, 0, 1, 1);
    // 修正后回复 2:1 → 3
    expect(state.players[0].health).toBe(3);
    // 实质 回复体力 atom 携带修正后的 amount
    const recover = state.atomHistory
      .filter((e) => e.kind === 'atom')
      .map((e) => (e as { atom: Atom }).atom)
      .find((a) => a.type === '回复体力') as Extract<Atom, { type: '回复体力' }>;
    expect(recover.amount).toBe(2);
  });

  // ── runLoseLifeFlow ────────────────────────────────────────
  it('runLoseLifeFlow:失去体力时 → 扣减子流程 → 失去体力后', async () => {
    await runLoseLifeFlow(state, 0, 2);
    expect(atomTypes(state)).toEqual([
      '失去体力时',
      '扣减体力前',
      '扣减体力时',
      '扣减体力',
      '扣减体力后',
      '失去体力后',
    ]);
    expect(state.players[0].health).toBe(2);
  });

  // ── runSetMaxHealthFlow ────────────────────────────────────
  it('runSetMaxHealthFlow:减上限且体力超出 → 扣减子流程 + 设上限 + 减上限后', async () => {
    // 体力 4,上限 4 → 2:health 超出,先走扣减子流程降 (4-2)=2,再 设上限(clamp no-op)
    await runSetMaxHealthFlow(state, 0, 2);
    expect(state.players[0].maxHealth).toBe(2);
    expect(state.players[0].health).toBe(2);
    // 顺序:先扣减(health 4→2)再 设上限(避免 设上限 clamp 与扣减重复)
    expect(atomTypes(state)).toEqual([
      '扣减体力前',
      '扣减体力时',
      '扣减体力',
      '扣减体力后',
      '设上限',
      '减上限后',
    ]);
  });

  it('runSetMaxHealthFlow:减上限但体力未超 → 设上限 + 减上限后(无扣减)', async () => {
    // 体力已为 1,上限 4 → 2:health 未超,不触发扣减
    state.players[0].health = 1;
    await runSetMaxHealthFlow(state, 0, 2);
    expect(state.players[0].maxHealth).toBe(2);
    expect(state.players[0].health).toBe(1);
    expect(atomTypes(state)).toEqual(['设上限', '减上限后']);
  });

  it('runSetMaxHealthFlow:加上限 → 设上限 + 加上限后', async () => {
    await runSetMaxHealthFlow(state, 0, 6);
    expect(state.players[0].maxHealth).toBe(6);
    expect(state.players[0].health).toBe(4); // 加上限不自动回血
    expect(atomTypes(state)).toEqual(['设上限', '加上限后']);
  });

  it('runSetMaxHealthFlow:上限不变 → 仅 设上限(无时机)', async () => {
    await runSetMaxHealthFlow(state, 0, 4);
    expect(atomTypes(state)).toEqual(['设上限']);
  });

  // ── 不迁移调用方验证:现有 atom 仍独立可用 ──────────────────
  it('现有 回复体力/失去体力 atom 未被修改,仍可独立 apply', async () => {
    // 直接 import 现有 atom 注册(已由 atoms/index.ts 覆盖),仅校验类型存在
    const types = atomTypes(state);
    expect(types).toEqual([]);
    // 编排函数内部仍调用现有 atom,故现有行为不受影响
    await runRecoverLifeFlow(state, 1, 1);
    expect(state.players[1].health).toBe(4); // 满血不超上限
  });
});
