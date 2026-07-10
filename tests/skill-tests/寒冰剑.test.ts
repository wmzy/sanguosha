// 寒冰剑(武器,范围 2):每当你使用【杀】对目标造成伤害时,
//   你可以防止此伤害,改为弃置其两张牌。
//
// 实现:
//   - before hook 挂「造成伤害」:source=自己 + 武器=寒冰剑 + 目标有手牌
//     → 请求回应(寒冰剑/confirm)→ 确认则弃目标最多2张牌 + cancel(防止伤害)
//   - respond action:处理 寒冰剑/confirm 确认
//
// 验证:
//   1. 正面:发动寒冰剑 → 弃目标2张牌,不扣血
//   2. 正面:不发动 → 正常扣血
//   3. 负面:目标无手牌 → 不触发(直接伤害)
//   4. 负面:无寒冰剑装备 → 不触发
//   5. 边界:目标只有1张手牌 → 弃1张
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

const HANBING: Card = {
  id: 'hb',
  name: '寒冰剑',
  suit: '♠',
  color: '黑',
  rank: '5',
  type: '装备牌',
  subtype: '武器',
  range: 2,
};

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  equipment?: Record<string, string>;
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
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

describe('寒冰剑', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:发动寒冰剑 → 弃目标2张牌,不扣血 ────────────────────

  it('正面:发动寒冰剑 → 弃目标2张牌,不扣血', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const c1 = makeCard('d1', '闪', '♥', '2');
    const c2 = makeCard('d2', '闪', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀', '寒冰剑'],
          equipment: { 武器: 'hb' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1', 'd2'],
          skills: ['闪'],
        }),
      ],
      cardMap: { hb: HANBING, k1: slash, d1: c1, d2: c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    // P2 被询问闪 → 不出闪
    await P2.pass();

    // 造成伤害前 → 寒冰剑 before hook 触发 → 询问 P1 是否发动
    const slot = harness.state.pendingSlots.get(0);
    expect(slot?.atom.type).toBe('请求回应');
    expect((slot?.atom as { requestType?: string }).requestType).toBe('寒冰剑/confirm');

    // P1 确认发动
    await P1.respond('寒冰剑', { choice: true });

    // 寒冰剑生效:弃 P2 两张牌,不扣血
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['d1', 'd2']));
    // 杀也进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
    restoreAutoCompare();
  });

  // ─── 正面:不发动 → 正常扣血 ─────────────────────────────────

  it('正面:不发动寒冰剑 → 正常扣 1 血', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const c1 = makeCard('d1', '闪', '♥', '2');
    const c2 = makeCard('d2', '闪', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀', '寒冰剑'],
          equipment: { 武器: 'hb' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1', 'd2'],
          skills: ['闪'],
        }),
      ],
      cardMap: { hb: HANBING, k1: slash, d1: c1, d2: c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass(); // 不出闪

    // 寒冰剑/confirm pending
    expect(harness.state.pendingSlots.get(0)?.atom).toBeDefined();

    // P1 不发动(pass)
    await P1.pass();

    // 正常扣血
    expect(harness.state.players[1].health).toBe(3);
    // P2 手牌未被弃
    expect(harness.state.players[1].hand.length).toBe(2);
    restoreAutoCompare();
  });

  // ─── 负面:目标无手牌 → 不触发 ───────────────────────────────

  it('负面:目标无手牌 → 寒冰剑不触发,正常扣血', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀', '寒冰剑'],
          equipment: { 武器: 'hb' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: ['闪'],
        }),
      ],
      cardMap: { hb: HANBING, k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass(); // 不出闪

    // 目标无手牌 → before hook 直接 return,不创建 寒冰剑/confirm pending
    // 直接造成伤害
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 负面:无寒冰剑装备 → 不触发 ─────────────────────────────

  it('负面:无寒冰剑装备 → 不触发,正常扣血', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const c1 = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀'], // 无寒冰剑技能
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1'],
          skills: ['闪'],
        }),
      ],
      cardMap: { k1: slash, d1: c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass(); // 不出闪

    // 无寒冰剑 → 正常扣血
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 边界:目标只有1张手牌 → 弃1张 ──────────────────────────

  it('边界:目标只有1张手牌 → 弃1张,不扣血', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const c1 = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀', '寒冰剑'],
          equipment: { 武器: 'hb' },
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1'],
          skills: ['闪'],
        }),
      ],
      cardMap: { hb: HANBING, k1: slash, d1: c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass(); // 不出闪

    // 寒冰剑/confirm pending
    expect(harness.state.pendingSlots.get(0)?.atom).toBeDefined();

    await P1.respond('寒冰剑', { choice: true });

    // 弃1张(只有1张),不扣血
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toContain('d1');
    restoreAutoCompare();
  });
});
