// 界刚烈(界夏侯惇·被动技)测试
//   受到伤害后判定,红色对其造成1点伤害,黑色弃置其一张牌。
//
// 验证:
//   1. 红色判定 → 对来源造成 1 点伤害
//   2. 黑色判定 + 来源有手牌 → 弃置来源一张手牌
//   3. 黑色判定 + 来源有装备 → 弃置来源装备
//   4. 黑色判定 + 来源无牌可弃 → 跳过(无事发生)
//   5. 来源死亡/不存活 → 不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
// 临时注册界刚烈(主 agent 会统一注册到 index.ts)
import { skillLoaders } from '../../src/engine/skills';
import * as 界刚烈Module from '../../src/engine/skills/界刚烈';
import type { SkillModule } from '../../src/engine/skill';
skillLoaders['界刚烈'] = async () => 界刚烈Module as unknown as SkillModule;

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
    character: '界夏侯惇',
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

describe('界刚烈', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 红色判定:对来源造成 1 点伤害 ────────────────────
  it('红色判定:对来源造成1点伤害', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♥', '5'); // 红色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // P1 不出闪
    // 红色判定 → 直接对来源造成 1 点伤害,无 pending
    expect(harness.state.pendingSlots.size).toBe(0);

    expect(harness.state.players[1].health).toBe(3); // P1 受杀 1 伤
    expect(harness.state.players[0].health).toBe(3); // P0 受界刚烈 1 伤
  });

  // ─── 红色判定(方块):同样造成伤害 ────────────────────
  it('红色判定(方块):对来源造成1点伤害', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♦', '5'); // 红色(方块)
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(3); // 受界刚烈 1 伤
  });

  // ─── 黑色判定 + 来源有手牌:弃置来源一张手牌 ────────────────────
  it('黑色判定:弃置来源一张手牌', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // 黑色
    const extra1 = makeCard('e1', '闪', '♦', '3');
    const extra2 = makeCard('e2', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1', 'e1', 'e2'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge, e1: extra1, e2: extra2 },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    // 黑色 → 弹选牌面板,界夏侯惇从来源手牌选一张弃置
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { zone: 'hand', handIndex: 0 }); // 盲选第 1 张手牌

    expect(harness.state.players[1].health).toBe(3); // P1 受杀 1 伤
    expect(harness.state.players[0].health).toBe(4); // P0 未受伤害
    // P0 出杀后剩 [e1,e2],被弃一张 → 剩 1 张
    expect(harness.state.players[0].hand.length).toBe(1);
    // 弃牌堆含被弃的牌(k1 已进弃牌堆 + 选中的手牌)
    expect(harness.state.zones.discardPile.length).toBeGreaterThanOrEqual(2);
  });

  // ─── 黑色判定 + 来源有装备:弃置来源装备 ────────────────────
  it('黑色判定:弃置来源装备', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♣', '5'); // 黑色
    const weapon = makeCard('w1', '诸葛连弩', '♣', 'A', '装备牌');
    const state: GameState = createGameState({
      players: [
        {
          ...makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
          equipment: { 武器: 'w1' },
        },
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge, w1: weapon },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { zone: 'equipment', cardId: 'w1' });

    expect(harness.state.players[0].health).toBe(4); // 未受伤害
    expect(harness.state.players[0].equipment["武器"]).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('w1');
  });

  // ─── 黑色判定 + 来源无牌可弃:跳过 ────────────────────
  it('黑色判定:来源无牌可弃,跳过', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // 黑色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    // P0 出杀后手牌为空,装备/判定区也空 → 无牌可弃 → 跳过,无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(4); // 未受伤害
    expect(harness.state.players[0].hand).toEqual([]);
  });
});
