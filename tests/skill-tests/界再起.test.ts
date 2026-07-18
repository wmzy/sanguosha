// 界再起(界孟获·蜀·主动技)行为测试:
//   OL 官方(hero/492)逐字:
//   "结束阶段,你可以令至多 X 名角色各选择一项
//    (X 为本回合置入弃牌堆的红色牌数量):
//      1.摸一张牌;
//      2.令你回复 1 点体力。"
//
// 与标版再起完全不同(标版=摸牌阶段展示牌堆顶红桃回血)。界版基于弃牌堆红牌计数,
// 结束阶段令至多 X 名角色各选摸 1 张或令孟获回 1 血。
//
// 验证:
//   1. happy path:本回合 2 张红牌入弃牌堆 → X=2 → 孟获选 2 名目标 →
//      目标 A 选 1(摸一张);目标 B 选 2(孟获回 1 血)
//   2. X=0(无红牌)→ 不触发
//   3. 仅黑牌入弃牌堆 → X=0 → 不触发
//   4. 孟获选择不发动 → 无效果
//   5. 孟获选 0 名目标 → 无效果
//   6. 孟获可令自己为目标,选 2 → 自身回 1 血
//   7. 红牌计数含本回合新进弃牌堆(基线之前的红牌不计)
//
// 事实来源:OL hero/492 界孟获·界再起
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, Faction, GameState, Json, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♠' || suit === '♣' ? '黑' : '红', rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  hand?: string[];
  skills?: string[];
  vars?: Record<string, Json>;
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction ?? '蜀',
  };
}

describe('界再起', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── happy path:2 张红牌 → X=2 → 2 目标,各选不同项 ────────────

  it('本回合 2 张红牌入弃牌堆 → X=2,选 2 名目标,A 选 1 摸牌,B 选 2 令孟获回血', async () => {
    const draw1 = makeCard('draw1', '杀', '♠', '3');
    const draw2 = makeCard('draw2', '杀', '♠', '4');
    const red1 = makeCard('red1', '杀', '♥', '5');
    const red2 = makeCard('red2', '杀', '♦', '6');
    const black1 = makeCard('black1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // P0 = 界孟获(蜀),health 2/4(便于验证回血)
        makePlayer({
          index: 0,
          name: '界孟获',
          character: '界孟获',
          health: 2,
          maxHealth: 4,
          skills: ['界再起'],
          faction: '蜀',
        }),
        // P1 = 甘宁,空手便于断言摸牌
        makePlayer({ index: 1, name: '甘宁', character: '甘宁', skills: [], faction: '吴' }),
        // P2 = 张飞
        makePlayer({ index: 2, name: '张飞', character: '张飞', skills: [], faction: '蜀' }),
      ],
      cardMap: { draw1, draw2, red1, red2, black1 },
      zones: {
        // deck:末尾为牌堆顶(与 摸牌 atom 一致),故 draw1 在顶
        deck: ['draw2', 'draw1'],
        // 弃牌堆:2 红(本回合新进)+ 1 黑(本回合新进)。基线=0 → X=2
        discardPile: ['red1', 'red2', 'black1'],
        processing: [],
      },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: { '界再起/base': 0 } },
    });
    await harness.setup(state);
    const MH = harness.player('界孟获');
    const GN = harness.player('甘宁');
    const ZF = harness.player('张飞');

    // 触发结束阶段:界再起 after-hook 询问是否发动
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 孟获选择发动
    await MH.respond('界再起', { choice: true });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 孟获选 2 名目标:甘宁(1)、张飞(2)
    await MH.respond('界再起', { targets: [1, 2] });
    await harness.waitForStable();
    GN.expectPending('请求回应');

    // 甘宁选 1(摸一张牌)
    await GN.respond('界再起', { choice: true });
    await harness.waitForStable();
    ZF.expectPending('请求回应');

    // 张飞选 2(令孟获回 1 血)
    await ZF.respond('界再起', { choice: false });
    await harness.waitForStable();

    // 断言:甘宁摸 draw1(牌堆顶);孟获回血 2→3;张飞未摸牌
    expect(harness.state.players[1].hand).toEqual(['draw1']);
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[2].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['draw2']); // draw1 被摸走
  });

  // ─── X=0(弃牌堆为空)→ 不触发 ────────────────────────────

  it('弃牌堆无红牌(X=0)→ 界再起不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界孟获',
          character: '界孟获',
          health: 2,
          maxHealth: 4,
          skills: ['界再起'],
          faction: '蜀',
        }),
        makePlayer({ index: 1, name: '甘宁', character: '甘宁', skills: [], faction: '吴' }),
      ],
      cardMap: {},
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: { '界再起/base': 0 } },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();

    // 无 pending(界再起未触发)
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 仅黑牌入弃牌堆 → X=0 → 不触发 ────────────────────────

  it('本回合仅黑牌入弃牌堆 → X=0 → 不触发', async () => {
    const black1 = makeCard('black1', '杀', '♠', '7');
    const black2 = makeCard('black2', '杀', '♣', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界孟获',
          character: '界孟获',
          health: 2,
          maxHealth: 4,
          skills: ['界再起'],
          faction: '蜀',
        }),
        makePlayer({ index: 1, name: '甘宁', character: '甘宁', skills: [], faction: '吴' }),
      ],
      cardMap: { black1, black2 },
      zones: { deck: [], discardPile: ['black1', 'black2'], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: { '界再起/base': 0 } },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 孟获选择不发动 → 无效果 ────────────────────────────

  it('孟获选择不发动 → 无目标、无效果', async () => {
    const red1 = makeCard('red1', '杀', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界孟获',
          character: '界孟获',
          health: 2,
          maxHealth: 4,
          skills: ['界再起'],
          faction: '蜀',
        }),
        makePlayer({ index: 1, name: '甘宁', character: '甘宁', skills: [], faction: '吴' }),
      ],
      cardMap: { red1 },
      zones: { deck: [], discardPile: ['red1'], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: { '界再起/base': 0 } },
    });
    await harness.setup(state);
    const MH = harness.player('界孟获');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 选择不发动
    await MH.respond('界再起', { choice: false });
    await harness.waitForStable();

    // 无后续询问、无效果
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[1].hand).toEqual([]);
  });

  // ─── 孟获选 0 名目标 → 无效果 ────────────────────────────

  it('孟获发动后选 0 名目标 → 无效果', async () => {
    const red1 = makeCard('red1', '杀', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界孟获',
          character: '界孟获',
          health: 2,
          maxHealth: 4,
          skills: ['界再起'],
          faction: '蜀',
        }),
        makePlayer({ index: 1, name: '甘宁', character: '甘宁', skills: [], faction: '吴' }),
      ],
      cardMap: { red1 },
      zones: { deck: [], discardPile: ['red1'], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: { '界再起/base': 0 } },
    });
    await harness.setup(state);
    const MH = harness.player('界孟获');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 发动
    await MH.respond('界再起', { choice: true });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 选 0 名目标
    await MH.respond('界再起', { targets: [] });
    await harness.waitForStable();

    // 无效果
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[1].hand).toEqual([]);
  });

  // ─── 孟获令自己为目标,选 2 → 自身回 1 血 ────────────────────

  it('孟获令自己为目标,选 2(令孟获回 1 血)→ 自身回血 2→3', async () => {
    const red1 = makeCard('red1', '杀', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界孟获',
          character: '界孟获',
          health: 2,
          maxHealth: 4,
          skills: ['界再起'],
          faction: '蜀',
        }),
        makePlayer({ index: 1, name: '甘宁', character: '甘宁', skills: [], faction: '吴' }),
      ],
      cardMap: { red1 },
      zones: { deck: [], discardPile: ['red1'], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: { '界再起/base': 0 } },
    });
    await harness.setup(state);
    const MH = harness.player('界孟获');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 发动
    await MH.respond('界再起', { choice: true });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 选自己(0)为目标
    await MH.respond('界再起', { targets: [0] });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 自己选 2(令孟获回 1 血)
    await MH.respond('界再起', { choice: false });
    await harness.waitForStable();

    // 自身回血 2→3
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 红牌计数仅含本回合新进(基线之前的红牌不计)────────────

  it('基线之前的红牌不计入 X(基线=1 → 仅末尾 1 张红牌计入)', async () => {
    const red0 = makeCard('red0', '杀', '♥', '2'); // 上回合遗留(基线之前)
    const red1 = makeCard('red1', '杀', '♦', '5'); // 本回合新进
    const draw1 = makeCard('draw1', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界孟获',
          character: '界孟获',
          health: 2,
          maxHealth: 4,
          skills: ['界再起'],
          faction: '蜀',
        }),
        makePlayer({ index: 1, name: '甘宁', character: '甘宁', skills: [], faction: '吴' }),
      ],
      cardMap: { red0, red1, draw1 },
      zones: { deck: ['draw1'], discardPile: ['red0', 'red1'], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      // 基线=1:本回合新进只有 red1 → X=1
      turn: { round: 1, phase: '回合结束', vars: { '界再起/base': 1 } },
    });
    await harness.setup(state);
    const MH = harness.player('界孟获');
    const GN = harness.player('甘宁');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 发动(提示文案应含 X=1)
    await MH.respond('界再起', { choice: true });
    await harness.waitForStable();
    MH.expectPending('请求回应');

    // 选 2 名目标(超过 X=1)→ 应被 validate 拒绝
    await MH.respond('界再起', { targets: [0, 1] });
    await harness.waitForStable();
    // 仍 pending(validate 拒绝 → 不消费)
    MH.expectPending('请求回应');

    // 改选 1 名目标:甘宁
    await MH.respond('界再起', { targets: [1] });
    await harness.waitForStable();
    GN.expectPending('请求回应');

    // 甘宁选 1(摸一张)
    await GN.respond('界再起', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[1].hand).toEqual(['draw1']);
  });
});
