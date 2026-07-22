// 界惴恐(界伏皇后·群·被动技)测试(界限突破版):
// 核心差异(相对标伏皇后 惴恐;标版未实现,基于官方描述对比):
//   1. 标版"没赢"=距离视为1;界版"没赢"=获得对方拼点牌 + 对方视为对你出杀
//
// 用例:
//   1. owner 拼点赢 → 目标被限制:对其他玩家出杀被取消
//   2. owner 拼点没赢 → owner 获得对方拼点牌 + 被虚拟杀命中
//   3. owner 平局(算没赢)→ 同 2
//   4. owner 未受伤 → 不触发
//   5. owner 自己回合开始 → 不触发
//   6. owner 拒绝发动 → 不触发
//   7. owner 无手牌 → 不触发
//   8. 目标无手牌 → 不触发
//   9. owner 赢 → 目标可对自己使用桃(允许)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
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
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 当前 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  if (state.pendingSlots.size === 0) return null;
  const slot = [...state.pendingSlots.values()][0];
  return (slot.atom as { requestType?: string }).requestType ?? null;
}

describe('界惴恐', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. owner 拼点赢 → 目标被限制 ──────────────────────
  it('owner 拼点赢 → 目标被限制(不能对他人指定目标)', async () => {
    // P0=界伏皇后(已受伤,手牌 K);P1=目标(手牌 2);P2=另一存活玩家
    const pindianWin = makeCard('c1', '杀', '♠', 'K');
    const pindianLow = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: ['c1'],
          skills: ['界惴恐'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['闪', '回合管理'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: [],
          skills: ['闪', '回合管理'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1: pindianWin, c2: pindianLow },
      currentPlayerIndex: 1,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界伏皇后');
    const P1 = harness.player('P1');

    // 触发 P1 的回合开始 → 惴恐 hook 询问 owner 是否发动
    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await waitForStable(harness.state);

    // owner confirm: 发动
    expect(currentRequestType(harness.state)).toBe('界惴恐/confirm');
    await P0.respond('界惴恐', { choice: true });
    await waitForStable(harness.state);

    // owner 选拼点牌(K)
    expect(currentRequestType(harness.state)).toBe('界惴恐/ownerCard');
    await P0.respond('界惴恐', { cardId: 'c1' });
    await waitForStable(harness.state);

    // 目标 选拼点牌(2)
    expect(currentRequestType(harness.state)).toBe('界惴恐/targetCard');
    await P1.respond('界惴恐', { cardId: 'c2' });
    await waitForStable(harness.state);

    // owner 赢(K > 2)→ 目标 vars 上有 restricted 标记
    expect(harness.state.players[1].vars['界惴恐/restricted/usedThisTurn']).toBe(true);
    // 两张拼点牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');

    // 指定目标 hook 生效:P1 对 P2 指定 → 被 cancel(返回 false)
    const r1 = await applyAtom(harness.state, {
      type: '指定目标',
      source: 1,
      target: 2,
      cardId: 'c1',
    });
    expect(r1).toBe(false);
    // P1 对自己指定 → 允许(返回 true)
    const r2 = await applyAtom(harness.state, {
      type: '指定目标',
      source: 1,
      target: 1,
      cardId: 'c1',
    });
    expect(r2).toBe(true);
    // P2(未被限制)对 P1 指定 → 允许(返回 true)
    const r3 = await applyAtom(harness.state, {
      type: '指定目标',
      source: 2,
      target: 1,
      cardId: 'c1',
    });
    expect(r3).toBe(true);
  });

  // ─── 2. owner 拼点没赢 → owner 获得对方拼点牌 + 被虚拟杀命中 ──
  it('owner 拼点没赢 → owner 获得对方拼点牌 + 受 1 点伤害', async () => {
    // P0=界伏皇后(已受伤;手牌 2);P1=目标(手牌 K=桃)
    // 目标的拼点牌是桃(非闪),owner 获得后不能当闪用 → 被虚拟杀命中
    const low = makeCard('c1', '杀', '♠', '2');
    const high = makeCard('c2', '桃', '♥', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: ['c1'],
          skills: ['界惴恐'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['闪', '回合管理'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1: low, c2: high },
      currentPlayerIndex: 1,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界伏皇后');
    const P1 = harness.player('P1');

    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await waitForStable(harness.state);

    await P0.respond('界惴恐', { choice: true });
    await waitForStable(harness.state);
    await P0.respond('界惴恐', { cardId: 'c1' });
    await waitForStable(harness.state);
    await P1.respond('界惴恐', { cardId: 'c2' });
    await waitForStable(harness.state);

    // owner 没赢(2 < K)
    // owner 获得对方拼点牌(c2=桃)→ 在 owner 手牌中
    expect(harness.state.players[0].hand).toContain('c2');
    // 虚拟杀该闪(owner 无闪)→ 走 闪问询 → pass 不出闪 → 命中 → owner 受 1 点伤害
    await P0.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[0].health).toBe(1); // 2 - 1
    // P1 未受伤
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 3. 平局算"没赢" ─────────────────────────────────
  it('拼点平局(相等)→ 算没赢,owner 获得对方牌 + 被虚拟杀命中', async () => {
    const a1 = makeCard('c1', '杀', '♠', '7');
    const a2 = makeCard('c2', '桃', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: ['c1'],
          skills: ['界惴恐'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['闪', '回合管理'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1: a1, c2: a2 },
      currentPlayerIndex: 1,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界伏皇后');
    const P1 = harness.player('P1');

    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await waitForStable(harness.state);

    await P0.respond('界惴恐', { choice: true });
    await waitForStable(harness.state);
    await P0.respond('界惴恐', { cardId: 'c1' });
    await waitForStable(harness.state);
    await P1.respond('界惴恐', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 7 == 7 → 没赢
    expect(harness.state.players[0].hand).toContain('c2'); // owner 获得对方牌
    // 虚拟杀问询闪 → pass → 命中
    await P0.pass();
    await waitForStable(harness.state);
    expect(harness.state.players[0].health).toBe(1); // 受虚拟杀
  });

  // ─── 4. owner 未受伤 → 不触发 ─────────────────────────
  it('owner 满血 → 不触发惴恐(无 pending)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: ['c1'],
          skills: ['界惴恐'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 1,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await waitForStable(harness.state);

    // 无 pending 触发
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 5. owner 自己回合开始 → 不触发 ───────────────────
  it('owner 自己回合开始 → 不触发', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: ['c1'],
          skills: ['界惴恐'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await waitForStable(harness.state);

    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 6. owner 拒绝发动 → 不触发 ────────────────────────
  it('owner 拒绝发动 → 不进入拼点', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: ['c1'],
          skills: ['界惴恐'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 1,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界伏皇后');

    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await waitForStable(harness.state);

    expect(currentRequestType(harness.state)).toBe('界惴恐/confirm');
    await P0.respond('界惴恐', { choice: false });
    await waitForStable(harness.state);

    // 未进入拼点;双方手牌未变
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toEqual(['c1']);
    expect(harness.state.players[1].hand).toEqual(['c2']);
  });

  // ─── 7. owner 无手牌 → 不触发 ─────────────────────────
  it('owner 无手牌 → 不触发(无法拼点)', async () => {
    const c2 = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: [],
          skills: ['界惴恐'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { c2 },
      currentPlayerIndex: 1,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await waitForStable(harness.state);

    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 8. 目标无手牌 → 不触发(无法拼点) ─────────────────
  it('目标无手牌 → 不触发(无法拼点)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: ['c1'],
          skills: ['界惴恐'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['闪', '回合管理'],
        }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 1,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await waitForStable(harness.state);

    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 9. owner 赢 → 限制不影响 owner 自己 ─────────────────
  it('owner 赢 → owner 不受限制(可对目标指定)', async () => {
    // P0=界伏皇后(手牌 K);P1=目标(手牌 2)
    const pindianWin = makeCard('c1', '杀', '♠', 'K');
    const pindianLow = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界伏皇后',
          hand: ['c1'],
          skills: ['界惴恐'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['闪', '回合管理'],
          health: 3,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1: pindianWin, c2: pindianLow },
      currentPlayerIndex: 1,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界伏皇后');
    const P1 = harness.player('P1');

    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await waitForStable(harness.state);
    await P0.respond('界惴恐', { choice: true });
    await waitForStable(harness.state);
    await P0.respond('界惴恐', { cardId: 'c1' });
    await waitForStable(harness.state);
    await P1.respond('界惴恐', { cardId: 'c2' });
    await waitForStable(harness.state);

    // owner 赢 → P1 被限制;owner 不被限制
    expect(harness.state.players[1].vars['界惴恐/restricted/usedThisTurn']).toBe(true);
    expect(harness.state.players[0].vars['界惴恐/restricted/usedThisTurn']).toBeUndefined();
    // owner(未受限)对 P1 指定 → 允许
    const r = await applyAtom(harness.state, {
      type: '指定目标',
      source: 0,
      target: 1,
      cardId: 'c1',
    });
    expect(r).toBe(true);
  });
});
