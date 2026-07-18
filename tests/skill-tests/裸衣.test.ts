// 裸衣(许褚·主动技)测试
//   摸牌阶段少摸一张,本回合杀/决斗伤害 +1。
//
// 验证:
//   1. 增伤效果:有裸衣标签时,杀造成 2 点伤害
//   2. 无标签:杀造成 1 点伤害(对照)
//   3. 摸牌阶段发动裸衣 → 少摸一张(摸 1 而非 2)
//   4. 决斗伤害 +1
//   5. 许褚回合结束清标签(本回合语义)
//   6. 其他玩家回合结束不清许褚标签
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

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
  tags?: string[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '许褚',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: opts.tags ?? [],
    judgeZone: [],
  };
}

describe('裸衣', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 增伤效果(隔离测试:直接挂标签)────────────────────
  it('有裸衣增伤标签:杀造成 2 点伤害', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        // P0(许褚)带裸衣增伤标签
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀', '裸衣'], tags: ['裸衣/bonus'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // 不出闪

    // 裸衣增伤:基础 1 + 1 = 2
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 对照:无标签,杀造成 1 点 ────────────────────
  it('无裸衣标签:杀造成 1 点伤害(对照)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀', '裸衣'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 摸牌阶段发动裸衣 → 少摸一张 ────────────────────
  it('摸牌阶段发动裸衣:摸 1 张(而非 2 张)', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const d3 = makeCard('d3', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        // 许褚为主公位(seat 0),含 回合管理 以驱动回合流程
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['裸衣', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { d1, d2, d3 },
      zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 启动回合:准备→判定→摸牌。摸牌时裸衣询问是否发动。
    await P0.triggerAction('回合管理', 'start');
    // 摸牌阶段:裸衣询问
    P0.expectPending('请求回应');
    await P0.respond('裸衣', { choice: true }); // 发动裸衣

    // 发动裸衣少摸一张:本应摸 2,实际摸 1
    expect(harness.state.players[0].hand.length).toBe(1);
    // 牌堆消耗 1 张(剩 2)
    expect(harness.state.zones.deck.length).toBe(2);
    // 标签已挂上(增伤生效)
    expect(harness.state.players[0].tags).toContain('裸衣/bonus');
  });

  // ─── 摸牌阶段不发动裸衣 → 摸 2 张 ────────────────────
  it('摸牌阶段不发动裸衣:摸 2 张', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const d3 = makeCard('d3', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['裸衣', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { d1, d2, d3 },
      zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('回合管理', 'start');
    P0.expectPending('请求回应');
    await P0.respond('裸衣', { choice: false }); // 不发动

    // 不发动:正常摸 2 张
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.deck.length).toBe(1);
    expect(harness.state.players[0].tags).not.toContain('裸衣/bonus');
  });

  // ─── 决斗增伤(隔离测试:直接挂标签)────────────────────
  it('有裸衣增伤标签:决斗造成 2 点伤害', async () => {
    const duel = makeCard('jd1', '决斗', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        // P0(许褚)带裸衣增伤标签
        makePlayer({ index: 0, name: 'P0', hand: ['jd1'], skills: ['决斗', '裸衣'], tags: ['裸衣/bonus'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['杀'] }),
      ],
      cardMap: { jd1: duel },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('决斗', 'jd1', [1]);
    await P1.pass(); // 无懈可击窗口
    await P1.pass(); // 询问杀 → 不出杀 → 输

    // 裸衣增伤:基础 1 + 1 = 2
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 许褚回合结束清除增伤标签(本回合语义)────────────────
  it('许褚回合结束时清除增伤标签', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['裸衣'], tags: ['裸衣/bonus'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].tags).toContain('裸衣/bonus');

    // 推进到许褚自己回合结束
    const { applyAtom } = await import('../../src/engine/create-engine');
    await applyAtom(harness.state, { type: '回合结束', player: 0 });
    harness.processAllEvents();

    // 标签已清除(本回合结束)
    expect(harness.state.players[0].tags).not.toContain('裸衣/bonus');
  });

  // ─── 其他玩家回合结束不清许褚标签 ────────────────────
  it('其他玩家回合结束不清除许褚的增伤标签', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['裸衣'], tags: ['裸衣/bonus'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    expect(harness.state.players[0].tags).toContain('裸衣/bonus');

    // P1 回合结束 → 不应清除许褚(P0)的标签
    const { applyAtom } = await import('../../src/engine/create-engine');
    await applyAtom(harness.state, { type: '回合结束', player: 1 });
    harness.processAllEvents();

    // 标签仍在(仅许褚自己回合结束才清)
    expect(harness.state.players[0].tags).toContain('裸衣/bonus');
  });
});
