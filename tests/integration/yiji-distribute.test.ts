// 集成测试:遗计(郭嘉·被动技) — 受到伤害后摸两张牌,分配给任意角色。
//
// 覆盖:
//   1. 受伤 → 摸2牌 → 分配给指定玩家(P2)
//   2. 受伤 → 摸2牌 → 分配给多方(P0+1)
//   3. 受伤 → 摸2牌 → 全部分配给自己
//
// 关键机制(遗计.ts):
//   registerAfterHook(造成伤害)→ target===ownerId → 摸牌×2 → 请求回应 遗计/distribute
//   收到 allocation 后 → 给予(给目标玩家)
//
// 模式:SkillTestHarness + useCardAndTarget(杀) + pass(不出闪) + respond(遗计,allocation)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

describe('遗计:端到端(harness)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:受伤 → 摸2牌 → 全部分配给 P2
  // ─────────────────────────────────────────────────────────────
  it('用例1:P0 杀 P1(遗计) → 不出闪 → 摸2牌 → 全部分配给 P2', async () => {
    const slash: Card = { id: 's1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['遗计', '闪'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: [] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // harness.setup 自动填充 20 张测试牌到牌堆
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', 's1', [1]);
    // P1 不出闪 → 扣血 → 遗计 after hook → 摸2牌 → distribute pending
    await P1.pass();

    // P1 已扣血
    expect(harness.state.players[1].health).toBe(3);

    // 应有遗计/distribute pending
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...harness.state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('遗计/distribute');

    // P1 摸了 2 张牌(来自自动填充牌堆)
    const p1Cards = harness.state.players[1].hand.slice();
    expect(p1Cards.length).toBe(2);

    // 全部分配给 P2
    await P1.respond('遗计', { allocation: [{ target: 2, cardIds: p1Cards }] });

    // P2 获得两张牌
    expect(harness.state.players[2].hand).toEqual(expect.arrayContaining(p1Cards));
    expect(harness.state.players[2].hand.length).toBe(2);
    // P1 不再持有这2张牌
    for (const cid of p1Cards) {
      expect(harness.state.players[1].hand).not.toContain(cid);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:受伤 → 摸2牌 → 分配给多方(P0 和 P2)
  // ─────────────────────────────────────────────────────────────
  it('用例2:受伤 → 摸2牌 → 分配给 P0 和 P2 各一张', async () => {
    const slash: Card = { id: 's1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['遗计', '闪'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: [] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();

    // P1 摸了 2 张牌
    const p1Cards = harness.state.players[1].hand.slice();
    expect(p1Cards.length).toBe(2);

    // 各分一张:第1张给 P0,第2张给 P2
    await P1.respond('遗计', {
      allocation: [
        { target: 0, cardIds: [p1Cards[0]] },
        { target: 2, cardIds: [p1Cards[1]] },
      ],
    });

    // P0 获得一张(之前只有杀,被杀用掉后手牌为空,现在得到一张)
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.players[0].hand[0]).toBe(p1Cards[0]);
    // P2 获得一张
    expect(harness.state.players[2].hand.length).toBe(1);
    expect(harness.state.players[2].hand[0]).toBe(p1Cards[1]);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:受伤 → 摸2牌 → 全分配给自己(不放)
  // ─────────────────────────────────────────────────────────────
  it('用例3:受伤 → 摸2牌 → 全分配给自己(P1)', async () => {
    const slash: Card = { id: 's1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['s1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['遗计', '闪'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: [] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();

    // P1 摸了 2 张牌
    const p1Cards = harness.state.players[1].hand.slice();
    expect(p1Cards.length).toBe(2);

    // 全分配给自己
    await P1.respond('遗计', {
      allocation: [{ target: 1, cardIds: p1Cards }],
    });

    // P1 仍然持有这2张牌
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(p1Cards));
    expect(harness.state.players[1].hand.length).toBe(2);
  });
});