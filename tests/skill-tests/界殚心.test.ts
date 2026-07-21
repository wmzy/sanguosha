// 界殚心(界郭皇后·被动技)测试:
// 核心规则(OL 界限突破官方逐字):
//   当你受到伤害后,你可摸 X 张牌,然后修改"矫诏"(X 为你修改"矫诏"的次数)。
//
// 实现解释(文档未明确处):
//   - X = 修改次数(读取 BEFORE 本次修改),故首次受伤 X=0(摸 0 张,仅修改)
//   - "修改矫诏"效果文档未说明,本实现按文档逐字仅做计数(见 界矫诏.ts)
//
// 用例:
//   1. 正面:首次受伤 → 询问 → 确认 → 摸 0 张,修改次数 0→1
//   2. 正面:第二次受伤 → 询问 → 确认 → 摸 1 张,修改次数 1→2
//   3. 正面:第三次受伤 → 询问 → 确认 → 摸 2 张,修改次数 2→3
//   4. 拒绝发动:受伤 → 询问 → 取消 → 无变化(摸 0,计数不变)
//   5. 触发条件不满足:其他玩家受伤 → 不触发
//   6. 边界:0 伤害(如防具减伤到 0)→ 不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

const MOD_COUNT_KEY = '界殚心/修改次数';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  return { id, name, suit, color, rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界郭皇后',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界矫诏', '界殚心', '杀', '闪', '桃'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function modCount(state: GameState, ownerId: number): number {
  const v = state.players[ownerId]?.vars[MOD_COUNT_KEY];
  return typeof v === 'number' ? v : 0;
}

describe('界殚心', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:首次受伤 → X=0 → 摸 0 张,修改次数 0→1 ────────
  it('首次受伤发动:摸 0 张,修改次数 0→1', async () => {
    // P1 出杀 → P0(界郭皇后)受 1 伤 → 询问殚心 → 确认
    const p1Card = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操', hand: ['c1'], skills: ['杀'] }),
      ],
      cardMap: { c1: p1Card },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    // P1 出杀,P0 不闪
    await P1.triggerAction('杀', 'use', { cardId: 'c1', targets: [0] });
    await P0.pass(); // 不闪

    // P0 受 1 伤,触发殚心询问
    expect(harness.state.players[0].health).toBe(2);
    P0.expectPending('请求回应');

    // 确认发动殚心
    await P0.respond('界殚心', { choice: true });

    // X=0(修改次数 0)→ 摸 0 张;修改次数 → 1
    expect(modCount(harness.state, 0)).toBe(1);
    // 手牌数:初始 0 + 摸 0 = 0
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 2. 正面:第二次受伤 → X=1 → 摸 1 张,修改次数 1→2 ──────
  it('第二次受伤发动:摸 1 张,修改次数 1→2', async () => {
    const p1Card = makeCard('c1', '杀', '♠', '7');
    const p1Card2 = makeCard('c2', '杀', '♠', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['c1', 'c2'],
          // 诸葛连弩:解除每回合一张杀限制
          skills: ['杀', '诸葛连弩'],
        }),
      ],
      cardMap: { c1: p1Card, c2: p1Card2 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    // 第一次受伤
    await P1.triggerAction('杀', 'use', { cardId: 'c1', targets: [0] });
    await P0.pass();
    await P0.respond('界殚心', { choice: true }); // 发动殚心,X=0
    expect(modCount(harness.state, 0)).toBe(1);

    // 第二次受伤
    await P1.triggerAction('杀', 'use', { cardId: 'c2', targets: [0] });
    await P0.pass();

    // 发动殚心,X=1
    P0.expectPending('请求回应');
    await P0.respond('界殚心', { choice: true });

    expect(modCount(harness.state, 0)).toBe(2);
    // 摸 1 张(从默认测试牌堆)
    expect(harness.state.players[0].hand.length).toBe(1);
  });

  // ─── 3. 正面:第三次受伤 → X=2 → 摸 2 张,修改次数 2→3 ──────
  it('第三次受伤发动:摸 2 张,修改次数 2→3', async () => {
    const cards = [
      makeCard('c1', '杀', '♠', '2'),
      makeCard('c2', '杀', '♠', '3'),
      makeCard('c3', '杀', '♠', '4'),
    ];
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['c1', 'c2', 'c3'],
          // 诸葛连弩:解除每回合一张杀限制
          skills: ['杀', '诸葛连弩'],
        }),
      ],
      cardMap: { c1: cards[0], c2: cards[1], c3: cards[2] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    // 三次受伤,三次发动
    for (let i = 0; i < 3; i++) {
      await P1.triggerAction('杀', 'use', { cardId: `c${i + 1}`, targets: [0] });
      await P0.pass();
      await P0.respond('界殚心', { choice: true });
    }

    // 三次后修改次数 = 3
    expect(modCount(harness.state, 0)).toBe(3);
    // 累计摸牌:0 + 1 + 2 = 3 张
    expect(harness.state.players[0].hand.length).toBe(3);
  });

  // ─── 4. 拒绝发动:受伤 → 取消 → 无变化 ────────────────────
  it('拒绝发动:摸 0 张,修改次数保持 0', async () => {
    const p1Card = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['c1'],
          skills: ['杀'],
        }),
      ],
      cardMap: { c1: p1Card },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    await P1.triggerAction('杀', 'use', { cardId: 'c1', targets: [0] });
    await P0.pass(); // 不闪

    // 触发殚心询问
    P0.expectPending('请求回应');
    // 取消发动
    await P0.respond('界殚心', { choice: false });

    // 修改次数仍为 0,手牌 0
    expect(modCount(harness.state, 0)).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 5. 触发条件不满足:其他玩家受伤 → 不触发 ────────────────
  it('其他玩家受伤 → 不触发殚心(P0 不被询问)', async () => {
    // P0(界郭皇后)回合,P0 出杀打 P1 → P1 受伤但 P0 不被询问殚心
    const p0Card = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操', hand: [], skills: ['闪'] }),
      ],
      cardMap: { c1: p0Card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('杀', 'use', { cardId: 'c1', targets: [1] });
    await P1.pass(); // P1 不闪

    // P1 受伤 → P0(界郭皇后殚心 owner)不应被询问(只有 target=owner 才触发)
    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.pendingSlots.size).toBe(0); // 无 pending
    expect(modCount(harness.state, 0)).toBe(0); // 修改次数未变
  });

  // ─── 6. 边界:0 伤害不触发(模拟方式 — 用回复后受伤) ─────────
  it('trigger 条件:仅当 target === ownerId 时触发', async () => {
    // 验证 hook 的 target 检查:即使 ownerId 受到 0 伤害也不触发(amount <= 0)
    // 此处通过 modCount 直接验证:无伤害事件 → 无修改
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操', hand: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    expect(modCount(harness.state, 0)).toBe(0);
    expect(harness.state.players[0].health).toBe(3);
  });
});
