// 陆绩(吴·风林火山,OL hero/402)技能测试:
//   怀橘(锁定技):游戏开始获得3橘;有橘受到伤害时防止并移除1橘;有橘摸牌阶段多摸一张
//   遗礼(被动技):出牌阶段开始时,失去1点体力或移除1枚橘,令一名其他角色获得1枚橘
//   整论(被动技):若你没有橘,可以跳过摸牌阶段并获得1枚橘
//
// 测试覆盖:
//   怀橘——开局3橘 / 仅一次 / 免伤移橘 / 橘耗尽正常受伤 / 多摸一张 / 橘保护其他角色
//   遗礼——失去体力给橘 / 移除橘给橘 / 不发动 / 无橘时仅失去体力(跳过代价选择)
//   整论——无橘跳过摸牌获橘 / 无橘不发动正常摸牌 / 有橘不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
// 临时注册怀橘/遗礼/整论(主 agent 会统一注册到 index.ts)
import { skillLoaders } from '../../src/engine/skills';
import * as 怀橘Module from '../../src/engine/skills/怀橘';
import * as 遗礼Module from '../../src/engine/skills/遗礼';
import * as 整论Module from '../../src/engine/skills/整论';
skillLoaders['怀橘'] = async () => 怀橘Module;
skillLoaders['遗礼'] = async () => 遗礼Module;
skillLoaders['整论'] = async () => 整论Module;

import { createGameState, suitColor } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import { runDamageFlow } from '../../src/engine/flows/damage';
import type { Card, GameState, Json, Mark, PlayerState } from '../../src/engine/types';

const JU_PREFIX = '怀橘/橘:';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  marks?: Mark[];
  vars?: Record<string, Json>;
  alive?: boolean;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: opts.marks ?? [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 预置 N 枚橘标记(id 用 'pre' 前缀避免与运行时 state.seq 生成的 id 冲突) */
function makeJuMarks(count: number, player = 0): Mark[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${JU_PREFIX}pre${i}`,
    scope: player,
  }));
}

function juCount(state: GameState, player: number): number {
  return state.players[player]?.marks.filter((m) => m.id.startsWith(JU_PREFIX)).length ?? 0;
}

/** 当前唯一 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return null;
  return (slots[0].atom as unknown as { requestType?: string }).requestType ?? null;
}

// ────────────────────────────────────────────────────────────────
// 怀橘
// ────────────────────────────────────────────────────────────────
describe('怀橘', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 游戏开始:获得 3 枚橘 ──────────────────────────
  it('首次回合开始 → 获得 3 枚橘标记', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', skills: ['怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    expect(juCount(harness.state, 0)).toBe(0);
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(juCount(harness.state, 0)).toBe(3);
  });

  // ─── 2. 游戏开始初始化仅触发一次 ──────────────────────────
  it('游戏开始初始化仅触发一次', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', skills: ['怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(juCount(harness.state, 0)).toBe(3);

    // 后续回合开始不再加橘
    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(juCount(harness.state, 0)).toBe(3);
  });

  // ─── 3. 有橘受到伤害:防止伤害并移除 1 枚橘 ──────────────────────────
  it('有橘受到伤害 → 防止伤害(不扣血)+ 移除 1 枚橘', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', health: 3, marks: makeJuMarks(3), skills: ['怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    const hpBefore = harness.state.players[0].health;
    void runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(hpBefore); // 防止伤害
    expect(juCount(harness.state, 0)).toBe(2); // 移除 1 枚橘
  });

  // ─── 4. 多点伤害也只移除 1 枚橘并完全防止 ──────────────────────────
  it('多点伤害(3)有橘 → 完全防止 + 仅移除 1 枚橘', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', health: 3, marks: makeJuMarks(2), skills: ['怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    const hpBefore = harness.state.players[0].health;
    void runDamageFlow(harness.state, 1, 0, 3);
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(hpBefore); // 完全防止
    expect(juCount(harness.state, 0)).toBe(1); // 仅移除 1 枚橘
  });

  // ─── 5. 无橘:正常受到伤害 ──────────────────────────
  it('无橘 → 正常受到伤害(不防止)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', health: 3, marks: [], skills: ['怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    void runDamageFlow(harness.state, 1, 0, 2);
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(1); // 3-2=1
    expect(juCount(harness.state, 0)).toBe(0);
  });

  // ─── 6. 橘保护其他角色(遗礼给的橘同样免伤) ──────────────────────────
  it('橘保护其他角色:P1 有橘受到伤害 → 防止 + 移除 1 橘', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', skills: ['怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操', health: 4, maxHealth: 4, marks: makeJuMarks(2, 1), skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    const hpBefore = harness.state.players[1].health;
    // P0(陆绩,怀橘拥有者)对 P1(持有橘)造成伤害 → 怀橘 hook 检查 target=P1 有橘
    void runDamageFlow(harness.state, 0, 1, 1);
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(hpBefore); // 防止
    expect(juCount(harness.state, 1)).toBe(1); // 移除 1 枚橘
  });

  // ─── 7. 有橘摸牌阶段多摸一张 ──────────────────────────
  it('有橘 + 自己摸牌阶段 → 多摸一张(2→3)', async () => {
    const d1 = mkCard('d1', '杀', '♠', '2');
    const d2 = mkCard('d2', '闪', '♥', '3');
    const d3 = mkCard('d3', '桃', '♦', '4');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', hand: [], marks: makeJuMarks(1), skills: ['怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: { d1, d2, d3 },
        zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '摸牌', player: 0, count: 2 });
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toHaveLength(3); // 2+1
  });

  // ─── 8. 无橘摸牌阶段不多摸 ──────────────────────────
  it('无橘 + 自己摸牌阶段 → 不多摸(正常 2 张)', async () => {
    const d1 = mkCard('d1', '杀', '♠', '2');
    const d2 = mkCard('d2', '闪', '♥', '3');
    const d3 = mkCard('d3', '桃', '♦', '4');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', hand: [], marks: [], skills: ['怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: { d1, d2, d3 },
        zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '摸牌',
        turn: { round: 1, phase: '摸牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '摸牌', player: 0, count: 2 });
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toHaveLength(2); // 无橘不多摸
  });

  // ─── 9. 非自己回合的摸牌不多摸(无中生有等) ──────────────────────────
  it('非自己回合的摸牌(模拟无中生有)→ 不触发怀橘多摸', async () => {
    const d1 = mkCard('d1', '杀', '♠', '2');
    const d2 = mkCard('d2', '闪', '♥', '3');
    const d3 = mkCard('d3', '桃', '♦', '4');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', hand: [], marks: makeJuMarks(1), skills: ['怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: { d1, d2, d3 },
        zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
        // P1 的回合,P0 有橘但非自己摸牌阶段
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '摸牌', player: 0, count: 2 });
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toHaveLength(2); // 非摸牌阶段,不多摸
  });
});

// ────────────────────────────────────────────────────────────────
// 遗礼
// ────────────────────────────────────────────────────────────────
describe('遗礼', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 发动:失去体力 → 目标获得 1 枚橘 ──────────────────────────
  it('出牌阶段开始 → 发动遗礼(失去体力)→ 目标获得 1 枚橘', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', health: 3, marks: makeJuMarks(0), skills: ['遗礼', '怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操', health: 4, maxHealth: 4, skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('陆绩');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();

    // 1) confirm:是否发动
    expect(currentRequestType(harness.state)).toBe('遗礼/confirm');
    await P0.respond('遗礼', { confirmed: true });
    await harness.waitForStable();

    // 2) cost:陆绩无橘 → 跳过代价选择,直接进入选目标
    expect(currentRequestType(harness.state)).toBe('遗礼/target');
    await P0.respond('遗礼', { target: 1 });
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(2); // 失去 1 点体力
    expect(juCount(harness.state, 1)).toBe(1); // P1 获得 1 枚橘
  });

  // ─── 2. 发动:有橘时选"移除橘" → 目标获得 1 枚橘 ──────────────────────────
  it('出牌阶段开始 → 有橘时选择移除橘 → 目标获得橘', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', health: 3, marks: makeJuMarks(2), skills: ['遗礼', '怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操', health: 4, maxHealth: 4, skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('陆绩');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();

    await P0.respond('遗礼', { confirmed: true });
    await harness.waitForStable();

    // cost 选择(有橘 → 两种选项)
    expect(currentRequestType(harness.state)).toBe('遗礼/cost');
    await P0.respond('遗礼', { option: 'removeJu' });
    await harness.waitForStable();

    expect(currentRequestType(harness.state)).toBe('遗礼/target');
    await P0.respond('遗礼', { target: 1 });
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3); // 未失去体力
    expect(juCount(harness.state, 0)).toBe(1); // 移除 1 枚橘(2→1)
    expect(juCount(harness.state, 1)).toBe(1); // P1 获得 1 枚橘
  });

  // ─── 3. 有橘时选"失去体力" ──────────────────────────
  it('有橘时选择失去体力 → 自己体力-1,橘不变,目标获得橘', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', health: 3, marks: makeJuMarks(2), skills: ['遗礼', '怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操', health: 4, maxHealth: 4, skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('陆绩');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();

    await P0.respond('遗礼', { confirmed: true });
    await harness.waitForStable();
    await P0.respond('遗礼', { option: 'loseHp' });
    await harness.waitForStable();
    await P0.respond('遗礼', { target: 1 });
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(2); // 失去 1 点体力
    expect(juCount(harness.state, 0)).toBe(2); // 橘不变
    expect(juCount(harness.state, 1)).toBe(1); // P1 获得 1 枚橘
  });

  // ─── 4. 不发动 ──────────────────────────
  it('出牌阶段开始 → 不发动遗礼 → 状态不变', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', health: 3, marks: makeJuMarks(1), skills: ['遗礼', '怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操', health: 4, maxHealth: 4, skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('陆绩');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    await P0.respond('遗礼', { confirmed: false });
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3); // 不变
    expect(juCount(harness.state, 0)).toBe(1); // 不变
    expect(juCount(harness.state, 1)).toBe(0); // P1 未获得橘
  });

  // ─── 5. 无其他存活角色 → 不触发 ──────────────────────────
  it('无其他存活角色 → 不触发遗礼', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', health: 3, marks: makeJuMarks(1), skills: ['遗礼', '怀橘'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: false, skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();

    // 无其他存活角色 → 不询问
    expect(currentRequestType(harness.state)).toBeNull();
    expect(harness.state.players[0].health).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────
// 整论
// ────────────────────────────────────────────────────────────────
describe('整论', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 无橘 + 发动 → 跳过摸牌阶段并获得 1 枚橘 ──────────────────────────
  it('无橘 → 发动整论 → 跳过摸牌阶段 + 获得 1 枚橘(不摸牌)', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const d1 = mkCard('d1', '杀', '♠', '2');
    const d2 = mkCard('d2', '闪', '♥', '3');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', hand: [], marks: [], skills: ['整论', '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: { d1, d2 },
        zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '判定',
        turn: { round: 1, phase: '判定', vars: {} },
      }),
    );
    const P0 = harness.player('陆绩');

    // 从判定阶段推进 → 回合管理推进到摸牌 → 整论 before-hook 触发
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '判定' });
    await harness.waitForStable();

    expect(currentRequestType(harness.state)).toBe('整论/confirm');
    await P0.respond('整论', { confirmed: true });
    await harness.waitForStable();

    expect(juCount(harness.state, 0)).toBe(1); // 获得 1 枚橘
    // 跳过摸牌:未摸牌(牌堆未动)
    expect(harness.state.zones.deck).toHaveLength(2);
    expect(harness.state.players[0].hand).toHaveLength(0);
    restoreAutoCompare();
  });

  // ─── 2. 无橘 + 不发动 → 正常摸牌(2 张) ──────────────────────────
  it('无橘 → 不发动整论 → 正常摸牌 2 张', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const d1 = mkCard('d1', '杀', '♠', '2');
    const d2 = mkCard('d2', '闪', '♥', '3');
    const d3 = mkCard('d3', '桃', '♦', '4');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', hand: [], marks: [], skills: ['整论', '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: { d1, d2, d3 },
        zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '判定',
        turn: { round: 1, phase: '判定', vars: {} },
      }),
    );
    const P0 = harness.player('陆绩');

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '判定' });
    await harness.waitForStable();

    expect(currentRequestType(harness.state)).toBe('整论/confirm');
    await P0.respond('整论', { confirmed: false });
    await harness.waitForStable();

    // 正常摸牌 2 张
    expect(harness.state.players[0].hand).toHaveLength(2);
    expect(juCount(harness.state, 0)).toBe(0); // 未获橘
    restoreAutoCompare();
  });

  // ─── 3. 有橘 → 不触发整论(正常摸牌 + 怀橘多摸) ──────────────────────────
  it('有橘 → 不触发整论 + 怀橘多摸一张(共 3 张)', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const d1 = mkCard('d1', '杀', '♠', '2');
    const d2 = mkCard('d2', '闪', '♥', '3');
    const d3 = mkCard('d3', '桃', '♦', '4');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '陆绩', hand: [], marks: makeJuMarks(1), skills: ['整论', '怀橘', '回合管理'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: { d1, d2, d3 },
        zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '判定',
        turn: { round: 1, phase: '判定', vars: {} },
      }),
    );

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '判定' });
    await harness.waitForStable();

    // 有橘 → 整论不触发,无询问,直接正常摸牌
    expect(currentRequestType(harness.state)).toBeNull();
    // 怀橘多摸:2+1=3
    expect(harness.state.players[0].hand).toHaveLength(3);
    expect(juCount(harness.state, 0)).toBe(1); // 橘数不变
    restoreAutoCompare();
  });
});
