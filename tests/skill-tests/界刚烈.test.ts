// 界刚烈(界夏侯惇·被动技)测试
//   受到伤害后判定,红色对其造成1点伤害,黑色弃置其一张牌。
//   不是锁定技,可选择是否发动。
//
// 验证:
//   1. 发动 + 红色判定 → 对来源造成 1 点伤害
//   2. 发动 + 黑色判定 + 来源有手牌 → 弃置来源一张手牌
//   3. 发动 + 黑色判定 + 来源有装备 → 弃置来源装备
//   4. 发动 + 黑色判定 + 来源无牌可弃 → 跳过(无事发生)
//   5. 不发动 → 无事发生
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
    // 询问界夏侯惇是否发动界刚烈
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true }); // 发动 → 红色判定 → 直接伤害,无后续 pending
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
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true }); // 发动
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
    // 询问界夏侯惇是否发动界刚烈
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true }); // 发动 → 黑色 → 弹选牌面板
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
    await P1.respond('界刚烈', { choice: true }); // 发动 → 黑色 → 弹选牌面板
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { zone: 'equipment', cardId: 'w1' });

    expect(harness.state.players[0].health).toBe(4); // 未受伤害
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
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
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true }); // 发动 → 黑色,但无牌可弃 → 跳过
    // P0 出杀后手牌为空,装备/判定区也空 → 无牌可弃 → 跳过,无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(4); // 未受伤害
    expect(harness.state.players[0].hand).toEqual([]);
  });

  // ─── 不发动 → 无事 ────────────────────────────
  it('不发动界刚烈:无事发生', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // 黑色(若发动会有效果)
    const extra1 = makeCard('e1', '闪', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1', 'e1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge, e1: extra1 },
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
    // 询问界夏侯惇是否发动界刚烈
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: false }); // 不发动

    // 不发动:无判定,无事
    expect(harness.state.players[1].health).toBe(3); // P1 受杀 1 伤
    expect(harness.state.players[0].health).toBe(4); // P0 无伤
    expect(harness.state.players[0].hand).toEqual(['e1']); // 手牌不变
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 2点伤害:两次都发动红色 → 来源受2点伤害 ────────────────────
  it('2点伤害:两次发动红色判定 → 来源受2点伤害', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const wine = makeCard('w1', '酒', '♦', '5');
    const judge1 = makeCard('j1', '杀', '♥', '5'); // 第1次判定:红色
    const judge2 = makeCard('j2', '杀', '♦', '5'); // 第2次判定:红色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['w1', 'k1'], skills: ['酒', '杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, w1: wine, j1: judge1, j2: judge2 },
      zones: { deck: ['j1', 'j2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 喝酒(下一杀+1伤害)
    await P0.useCard('酒', 'w1');
    await harness.waitForStable();
    harness.processAllEvents();

    // P0 出杀(伤害=2)→ P1 不闪 → 界刚烈触发2次
    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    // 第1次:发动 → 红色 → P0 受1伤
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true });
    // 第2次:发动 → 红色 → P0 受1伤
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true });

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(2); // P1 受杀 2 伤
    expect(harness.state.players[0].health).toBe(2); // P0 受界刚烈 2 次 1 伤
  });

  // ─── 2点伤害:第一次发动,第二次不发动 ────────────────────
  it('2点伤害:第一次发动红色,第二次不发动', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const wine = makeCard('w1', '酒', '♦', '5');
    const judge1 = makeCard('j1', '杀', '♥', '5'); // 第1次判定:红色
    const judge2 = makeCard('j2', '杀', '♠', '5'); // 第2次判定牌(不会判定,不发动)
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['w1', 'k1'], skills: ['酒', '杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, w1: wine, j1: judge1, j2: judge2 },
      zones: { deck: ['j1', 'j2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCard('酒', 'w1');
    await harness.waitForStable();
    harness.processAllEvents();

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    // 第1次:发动 → 红色 → P0 受1伤
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true });
    // 第2次:不发动
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: false });

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(2); // P1 受杀 2 伤
    expect(harness.state.players[0].health).toBe(3); // P0 仅受1次界刚烈伤害
  });

  // ─── 2点伤害:第一次红色造伤致死来源 → 第二次不再触发 ────────────────────
  it('2点伤害:来源仅剩1血,第一次红色造伤致死 → 第二次不触发', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const wine = makeCard('w1', '酒', '♦', '5');
    const judge1 = makeCard('j1', '杀', '♥', '5'); // 第1次判定:红色
    const judge2 = makeCard('j2', '杀', '♦', '5'); // 第2次判定牌(不会用到)
    const state: GameState = createGameState({
      players: [
        // P0 初始 1 血:第一次红色造伤即死 → 第二次不再触发
        makePlayer({ index: 0, name: 'P0', hand: ['w1', 'k1'], skills: ['酒', '杀'], health: 1 }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, w1: wine, j1: judge1, j2: judge2 },
      zones: { deck: ['j1', 'j2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCard('酒', 'w1');
    await harness.waitForStable();
    harness.processAllEvents();

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    // 第1次:发动 → 红色 → P0 受1伤 → P0 濒死(0血)
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true });

    // P0 濒死,无人出桃 → pass 掉所有求桃 pending → P0 死亡
    while (harness.state.pendingSlots.size > 0) {
      const seatIdx = [...harness.state.pendingSlots.keys()][0];
      await harness.player(harness.state.players[seatIdx].name).pass();
    }

    expect(harness.state.players[0].alive).toBe(false); // P0 死亡
    expect(harness.state.players[1].health).toBe(2); // P1 受杀 2 伤
    // 来源死亡后第二次不再触发
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
