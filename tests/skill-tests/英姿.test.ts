// 英姿(周瑜·被动技)测试
//   摸牌阶段，你可以额外摸一张牌。
//
// 验证:
//   1. 摸牌阶段发动英姿 → 摸 3 张(而非 2 张)
//   2. 摸牌阶段不发动英姿 → 摸 2 张
//   3. 英姿只在自己摸牌阶段触发(无中生有摸牌不触发)
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
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '周瑜',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
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

describe('英姿', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 发动英姿 → 摸 3 张 ─────────────────────────────
  it('摸牌阶段发动英姿:摸 3 张(而非 2 张)', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const d3 = makeCard('d3', '桃', '♦', '4');
    const d4 = makeCard('d4', '酒', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['英姿', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['回合管理'] }),
      ],
      cardMap: { d1, d2, d3, d4 },
      zones: { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 启动回合:准备→判定→摸牌。摸牌时英姿询问是否发动。
    await P0.triggerAction('回合管理', 'start');
    P0.expectPending('请求回应');
    await P0.respond('英姿', { choice: true }); // 发动英姿

    // 发动英姿额外摸一张:本应摸 2,实际摸 3
    expect(harness.state.players[0].hand.length).toBe(3);
    // 牌堆消耗 3 张(剩 1)
    expect(harness.state.zones.deck.length).toBe(1);
    // 限一次标记已设
    expect(harness.state.players[0].vars['英姿/usedThisTurn']).toBe(true);
  });

  // ─── 2. 不发动英姿 → 摸 2 张 ─────────────────────────
  it('摸牌阶段不发动英姿:摸 2 张', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const d3 = makeCard('d3', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['英姿', '回合管理'] }),
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
    await P0.respond('英姿', { choice: false }); // 不发动

    // 不发动:正常摸 2 张
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.deck.length).toBe(1);
    expect(harness.state.players[0].vars['英姿/usedThisTurn']).toBeUndefined();
  });

  // ─── 3. 无中生有摸牌不触发英姿 ───────────────────────
  it('无中生有摸牌不触发英姿(只在摸牌阶段)', async () => {
    const wu = makeCard('wz', '无中生有', '♥', '7', '锦囊牌');
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        // 出牌阶段,持有无中生有 + 英姿
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['wz'],
          skills: ['英姿', '无中生有'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { wz: wu, d1, d2 },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCard('无中生有', 'wz');
    // 无中生有先经无懈可击窗口
    P0.expectPending('请求回应');
    await P0.pass();

    // 无中生有摸 2 张(英姿不触发:不是摸牌阶段)
    expect(harness.state.players[0].hand.length).toBe(2);
    // 无 pending(英姿未询问)
    P0.expectNoPending();
  });
});
