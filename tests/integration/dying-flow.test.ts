// tests/integration/dying-flow.test.ts
// 模块 C:濒死流程修正验证(对齐 docs/flow-redesign.md 模块 C / neardeath.md)。
//
// 验证点(对齐 assignment 模块 C 验收):
//   1. P1 回合内 P2 濒死 → 从 P1(当前回合角色)起逆时针询问:P1 → P0 → P3 → P2
//   2. P2 被救但仍濒死 → 从救者重新逆时针
//   3. 进入濒死状态时 atom 在求桃(请求回应)前发出
//   4. 无人救 → runDeathFlow 触发(alive=false, 系统处理牌 发出)
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import { registerBeforeHook } from '../../src/engine/skill';
import { SkillTestHarness } from '../engine-harness';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♥' || suit === '♦' ? '红' : '黑', rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
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
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 从 atomHistory 提取所有 atom 的 type 列表(按发出顺序)。 */
function atomTypes(state: GameState): string[] {
  return (state.atomHistory as Array<{ kind: string; atom?: { type: string } }>)
    .filter((e) => e.kind === 'atom' && e.atom)
    .map((e) => e.atom!.type);
}

/** 读取当前唯一的 桃/求桃 pending 的 target 座次。 */
function readPeachTarget(state: GameState): number {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) throw new Error('无 pending');
  const atom = slots[0].atom as { type: string; requestType?: string; target?: number };
  if (atom.type !== '请求回应' || atom.requestType !== '桃/求桃') {
    throw new Error('当前 pending 不是桃/求桃,实际是 ' + atom.type + '/' + atom.requestType);
  }
  return atom.target!;
}

describe('模块 C:濒死流程修正', () => {
  // ─────────────────────────────────────────────────────────────
  // 验收 1:从当前回合角色起逆时针询问
  // 4 人局:P0(0) P1(1,当前回合) P2(2) P3(3)
  // P1 杀 P2(距离1,可达)→ P2 濒死 → 逆时针从 P1:P1 → P0 → P3 → P2
  // ─────────────────────────────────────────────────────────────
  it('从当前回合角色起逆时针询问:P1 回合 P2 濒死 → P1 → P0 → P3 → P2', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', skills: ['桃', '闪'] }),
        mkPlayer({ index: 1, name: 'P1', hand: [slash.id], skills: ['杀', '桃', '闪'] }),
        mkPlayer({ index: 2, name: 'P2', skills: ['桃', '闪'], health: 1, maxHealth: 4 }),
        mkPlayer({ index: 3, name: 'P3', skills: ['桃', '闪'] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });

    const { dispatchAndWait, fireTimeoutAndWait } = await import('../engine-harness');
    const { registerSkillsFromState } = await import('../../src/engine/create-engine');
    await registerSkillsFromState(state);

    // P1 杀 P2(距离1)
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 1,
      params: { cardId: slash.id, targets: [2] },
      baseSeq: state.seq,
    });

    // 记录 桃/求桃 询问顺序(fireTimeout 消耗所有 pending)
    const askOrder: number[] = [];
    let loops = 0;
    while (state.pendingSlots.size > 0 && loops < 30) {
      for (const slot of state.pendingSlots.values()) {
        const atom = slot.atom as { type?: string; requestType?: string; target?: number };
        if (atom.type === '请求回应' && atom.requestType === '桃/求桃') {
          askOrder.push(atom.target!);
          break;
        }
      }
      await fireTimeoutAndWait(state);
      loops += 1;
    }

    // 逆时针从当前回合 P1(idx1)起:P1 → P0 → P3 → P2
    expect(askOrder).toEqual([1, 0, 3, 2]);
    // P2 死亡(无人救)
    expect(state.players[2].alive).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────
  // 验收 2:P2 被救但仍濒死 → 从救者重新逆时针
  // 注册 before-hook on 回复体力:cancel → 模拟"被救但仍濒死"
  // ─────────────────────────────────────────────────────────────
  it('被救但仍濒死 → 从救者重新逆时针(新的濒死状态时 → 重置)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const peach = makeCard('p1', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', skills: ['桃', '闪'] }),
        mkPlayer({ index: 1, name: 'P1', hand: [slash.id, peach.id], skills: ['杀', '桃', '闪'] }),
        mkPlayer({ index: 2, name: 'P2', skills: ['桃', '闪'], health: 1, maxHealth: 4 }),
        mkPlayer({ index: 3, name: 'P3', skills: ['桃', '闪'] }),
      ],
      cardMap: { s1: slash, p1: peach },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });

    // before-hook on 回复体力:cancel → health 不增 → "仍濒死"路径
    registerBeforeHook(state, '__mockNegate', -1, '回复体力', async () => {
      return { kind: 'cancel' };
    });

    const { dispatchAndWait, fireTimeoutAndWait } = await import('../engine-harness');
    const { registerSkillsFromState } = await import('../../src/engine/create-engine');
    await registerSkillsFromState(state);

    // P1 杀 P2
    await dispatchAndWait(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 1,
      params: { cardId: slash.id, targets: [2] },
      baseSeq: state.seq,
    });

    const askOrder: number[] = [];
    let loops = 0;
    while (state.pendingSlots.size > 0 && loops < 30) {
      for (const slot of state.pendingSlots.values()) {
        const atom = slot.atom as { type?: string; requestType?: string; target?: number };
        if (atom.type === '请求回应' && atom.requestType === '桃/求桃') {
          askOrder.push(atom.target!);
          break;
        }
      }
      // 第一问 P1 → P1 有桃,出桃救援
      if (askOrder.length === 1 && askOrder[0] === 1) {
        await dispatchAndWait(state, {
          skillId: '桃',
          actionType: 'respond',
          ownerId: 1,
          params: { cardId: peach.id },
          baseSeq: state.seq,
        });
      } else {
        await fireTimeoutAndWait(state);
      }
      loops += 1;
    }

    // P1 被问(target=1),出桃 → 回复体力 cancel → 仍濒死 → 新的濒死状态时
    // 重置起点为 P1(救者),逆时针重新:P1(已问)→ P0 → P3 → P2
    // P0/P3/P2 无桃 → 全 pass → P2 死亡
    expect(askOrder).toEqual([1, 0, 3, 2]);
    expect(state.players[2].alive).toBe(false);

    // 验证 新的濒死状态时 atom 被发出
    const types = atomTypes(state);
    expect(types).toContain('新的濒死状态时');
  });

  // ─────────────────────────────────────────────────────────────
  // 验收 3:进入濒死状态时 atom 在请求回应(桃/求桃)前发出
  // ─────────────────────────────────────────────────────────────
  it('进入濒死状态时 atom 在请求回应(桃/求桃)前发出', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀', '闪'] }),
        mkPlayer({ index: 1, name: 'P1', skills: ['闪'], health: 1, maxHealth: 4 }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });

    const harness = new SkillTestHarness();
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P1.pass();
    await harness.waitForStable();

    const types = atomTypes(harness.state);
    const enterIdx = types.indexOf('进入濒死状态时');
    const firstRespondIdx = types.findIndex(
      (t, i) => i > enterIdx && t === '请求回应',
    );

    expect(enterIdx).toBeGreaterThanOrEqual(0);
    expect(firstRespondIdx).toBeGreaterThan(enterIdx);
  });

  // ─────────────────────────────────────────────────────────────
  // 验收 4:无人救 → runDeathFlow 触发(alive=false, 系统处理牌 发出)
  // ─────────────────────────────────────────────────────────────
  it('无人救援 → runDeathFlow 触发(alive=false, 系统处理牌 发出)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        mkPlayer({ index: 0, name: 'P0', hand: [slash.id], skills: ['杀', '闪'] }),
        mkPlayer({ index: 1, name: 'P1', skills: ['闪'], health: 1, maxHealth: 4 }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });

    const harness = new SkillTestHarness();
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P1.pass();
    await harness.waitForStable();

    // 2人局逆时针从 P0:P0 → P1。P0 无桃 pass,P1 无桃 pass → P1 死亡
    await P0.pass();
    await harness.waitForStable();
    await P1.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].alive).toBe(false);

    const types = atomTypes(harness.state);
    expect(types).toContain('死亡时');
    expect(types).toContain('系统处理牌');
  });
});
