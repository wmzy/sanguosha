// tests/skill-tests/damage-flow.test.ts
// 模块 A1:伤害编排函数 runDamageFlow 时机顺序验证(对齐 docs/flow-redesign.md 模块 A / damage.md)。
// 不依赖具体技能——直接调用编排函数,断言 state.atomHistory 的 atom 时序、amount 传递
// 与 state.players[].health 的实质变化。
//
// 验证点(对齐 docs/flow-redesign.md 模块 A 验收):
//   1. 正常伤害:7 时机 + 扣减体力子流程(模块 M 四时机)依次发出,health 下降。
//   2. before-hook modify amount:造成伤害时 modify → 后续时机与扣减量携带新值。
//   3. 受到伤害时 cancel → 跳到伤害结算结束时,不执行 造成/受到伤害后、不扣血。
//   4. 伤害结算开始时 cancel → 跳过整个伤害流程。
//   5. 不迁移调用方:现有 造成伤害 atom 未被修改,仍可独立 apply。
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms'; // 注册所有 atom(含 damage-timing)
import { createGameState } from '../../src/engine/types';
import type { Atom, GameState, PlayerState } from '../../src/engine/types';
import { runDamageFlow } from '../../src/engine/damage-flow';
import { applyAtom } from '../../src/engine/create-engine';
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

/** 从 atomHistory 取第一个匹配 type 的 atom(断言为对应形状)。 */
function findAtom<T extends Atom>(state: GameState, type: string): T {
  return state.atomHistory
    .filter((e) => e.kind === 'atom')
    .map((e) => (e as { atom: Atom }).atom)
    .find((a) => a.type === type) as T;
}

describe('模块 A1:伤害编排函数 runDamageFlow', () => {
  let state: GameState;
  beforeEach(() => {
    state = makeState();
  });

  // ── 时机顺序 ───────────────────────────────────────────────
  it('正常伤害:7 时机 + 扣减体力子流程依次发出,health 下降', async () => {
    // source=1(攻击方) 对 target=0 造成 2 点伤害
    await runDamageFlow(state, 1, 0, 2);
    expect(atomTypes(state)).toEqual([
      '伤害结算开始时',
      '造成伤害时',
      '受到伤害时',
      // 扣减体力子流程(模块 M 四时机)
      '扣减体力前',
      '扣减体力时',
      '扣减体力',
      '扣减体力后',
      '造成伤害后',
      '受到伤害后',
      '伤害结算结束时',
      '伤害结算结束后',
    ]);
    expect(state.players[0].health).toBe(2);
    // 来源方不受伤害
    expect(state.players[1].health).toBe(4);
  });

  it('伤害值=0 时不走扣减体力子流程,仍发全部时机', async () => {
    await runDamageFlow(state, 1, 0, 0);
    expect(atomTypes(state)).toEqual([
      '伤害结算开始时',
      '造成伤害时',
      '受到伤害时',
      // amount=0 → 跳过扣减子流程
      '造成伤害后',
      '受到伤害后',
      '伤害结算结束时',
      '伤害结算结束后',
    ]);
    expect(state.players[0].health).toBe(4);
  });

  it('damageType 透传到各时机 atom', async () => {
    await runDamageFlow(state, 1, 0, 1, undefined, '火焰');
    const begin = findAtom<Extract<Atom, { type: '伤害结算开始时' }>>(state, '伤害结算开始时');
    expect(begin.damageType).toBe('火焰');
    const suffer = findAtom<Extract<Atom, { type: '受到伤害时' }>>(state, '受到伤害时');
    expect(suffer.damageType).toBe('火焰');
    const after = findAtom<Extract<Atom, { type: '伤害结算结束后' }>>(state, '伤害结算结束后');
    expect(after.damageType).toBe('火焰');
  });

  // ── before-hook modify amount ──────────────────────────────
  it('造成伤害时 before-hook modify +1 → 后续时机与扣减量携带新值', async () => {
    // 模拟裸衣:造成伤害时 modify amount +1
    registerBeforeHook(state, 'mockLuoYi', 1, '造成伤害时', async (ctx) => {
      const a = ctx.atom;
      return { kind: 'modify', atom: { ...a, amount: a.amount + 1 } };
    });
    await runDamageFlow(state, 1, 0, 2);
    // 基础 2 + 加伤 1 = 3
    expect(state.players[0].health).toBe(1);
    // 修正后的值传递到 扣减体力 atom
    const decrease = findAtom<Extract<Atom, { type: '扣减体力' }>>(state, '扣减体力');
    expect(decrease.amount).toBe(3);
    // 受到伤害时 收到加伤后的 amount(减伤 hook 看到的是加过的值)
    const suffer = findAtom<Extract<Atom, { type: '受到伤害时' }>>(state, '受到伤害时');
    expect(suffer.amount).toBe(3);
  });

  it('造成伤害时 + 受到伤害时 双 modify 链式叠加(加伤后减伤)', async () => {
    // 裸衣 +1(来源方加伤)
    registerBeforeHook(state, 'mockLuoYi', 1, '造成伤害时', async (ctx) => {
      const a = ctx.atom;
      return { kind: 'modify', atom: { ...a, amount: a.amount + 1 } };
    });
    // 藤甲 -1(目标方减伤)——火焰伤害加伤改为减伤示意
    registerBeforeHook(state, 'mockTengJia', 0, '受到伤害时', async (ctx) => {
      const a = ctx.atom;
      return { kind: 'modify', atom: { ...a, amount: Math.max(0, a.amount - 1) } };
    });
    await runDamageFlow(state, 1, 0, 2);
    // 基础 2 → 加伤 3 → 减伤 2
    expect(state.players[0].health).toBe(2);
    const decrease = findAtom<Extract<Atom, { type: '扣减体力' }>>(state, '扣减体力');
    expect(decrease.amount).toBe(2);
  });

  it('伤害结算开始时 modify amount 生效', async () => {
    // 模拟狂风大雾:伤害结算开始时 modify amount +2
    registerBeforeHook(state, 'mockWind', 0, '伤害结算开始时', async (ctx) => {
      const a = ctx.atom;
      return { kind: 'modify', atom: { ...a, amount: a.amount + 2 } };
    });
    await runDamageFlow(state, 1, 0, 1);
    // 基础 1 + 修正 2 = 3
    expect(state.players[0].health).toBe(1);
    const cause = findAtom<Extract<Atom, { type: '造成伤害时' }>>(state, '造成伤害时');
    expect(cause.amount).toBe(3);
  });

  // ── cancel 语义 ────────────────────────────────────────────
  it('受到伤害时 cancel → 跳到伤害结算结束时,不扣血、不触发 造成/受到伤害后', async () => {
    // 模拟寒冰剑/仁王盾:受到伤害时 cancel(完全防止)
    registerBeforeHook(state, 'mockPrevent', 0, '受到伤害时', async () => {
      return { kind: 'cancel' };
    });
    await runDamageFlow(state, 1, 0, 2);
    // cancel 的 atom(受到伤害时)不进 atomHistory,直接跳到结算结束时
    expect(atomTypes(state)).toEqual([
      '伤害结算开始时',
      '造成伤害时',
      '伤害结算结束时',
      '伤害结算结束后',
    ]);
    // 不扣血
    expect(state.players[0].health).toBe(4);
    // 结束时/结束后 amount=0
    const end = findAtom<Extract<Atom, { type: '伤害结算结束时' }>>(state, '伤害结算结束时');
    expect(end.amount).toBe(0);
  });

  it('伤害结算开始时 cancel → 跳过整个伤害流程(绝情)', async () => {
    registerBeforeHook(state, 'mockJueQing', 1, '伤害结算开始时', async () => {
      return { kind: 'cancel' };
    });
    await runDamageFlow(state, 1, 0, 2);
    // 仅 伤害结算开始时(cancel 后不进 atomHistory),整个流程终止
    expect(atomTypes(state)).toEqual([]);
    expect(state.players[0].health).toBe(4);
  });

  // ── 不迁移调用方:现有 造成伤害 atom 仍独立可用 ──────────────
  it('现有 造成伤害 atom 未被修改,仍可独立 apply', async () => {
    await applyAtom(state, { type: '造成伤害', source: 1, target: 0, amount: 3 });
    expect(state.players[0].health).toBe(1);
    // runDamageFlow 与旧 atom 并存:旧 atom 走自身 before/after hook,不经新时机
    expect(atomTypes(state)).toEqual(['造成伤害']);
  });
});
