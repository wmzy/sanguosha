// 集成测试:武圣(关羽·转化技) — 将一张红色牌当【杀】使用或打出。
//
// 覆盖:
//   1. 正面:红桃(♥)当杀 → 出杀 → 对方不出闪 → 扣血
//   2. 正面:方块(♦)当杀 → 出杀 → 对方不出闪 → 扣血
//   3. 负面:黑桃(♠) → 武圣 transform 拒绝
//   4. 负面:梅花(♣) → 武圣 transform 拒绝
//
// 关键机制(武圣.ts):
//   preceding=[武圣.transform] + 主 action=杀.use 组合
//   武圣.validate 检查:自己回合 + 无 pending + 存活 + 手牌 + 红牌
//   武圣.execute 创建影子杀(cardMap[影子id]={name:'杀',shadowOf:原id})
//
// 模式:SkillTestHarness + transformThenUse + pass(不出闪)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
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
    character: '关羽',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['武圣'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('武圣:端到端(harness)', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:红桃当杀 → 出杀 → 扣血
  // ─────────────────────────────────────────────────────────────
  it('用例1:红桃(♥)当杀 → 出杀 → P2 不出闪 → 扣1血', async () => {
    const red = makeCard('c1', '桃', '♥', 'A'); // 红桃
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['武圣', '杀', '闪'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { c1: red },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 武圣转化:红桃当杀 + 出杀选目标 P2
    await P1.transformThenUse(
      '武圣',
      { cardId: 'c1' },
      '杀',
      { cardId: 'c1#武圣', targets: [1] },
    );

    // 影子杀已在 cardMap
    expect(harness.state.cardMap['c1#武圣']).toBeDefined();
    expect(harness.state.cardMap['c1#武圣'].name).toBe('杀');
    expect(harness.state.cardMap['c1#武圣'].shadowOf).toBe('c1');

    // P2 不出闪 → 扣血
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:方块当杀 → 出杀 → 扣血
  // ─────────────────────────────────────────────────────────────
  it('用例2:方块(♦)当杀 → 出杀 → P2 不出闪 → 扣1血', async () => {
    const red = makeCard('d1', '桃', '♦', '5'); // 方块
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['武圣', '杀', '闪'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { d1: red },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse(
      '武圣',
      { cardId: 'd1' },
      '杀',
      { cardId: 'd1#武圣', targets: [1] },
    );

    expect(harness.state.cardMap['d1#武圣'].name).toBe('杀');
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:黑桃 → 武圣 transform 拒绝
  // ─────────────────────────────────────────────────────────────
  it('用例3:黑桃(♠)当杀 → transform 被拒绝(不是红色)', async () => {
    const black = makeCard('s1', '桃', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'], skills: ['武圣'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { s1: black },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '武圣', actionType: 'transform', params: { cardId: 's1' } });
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:梅花 → 武圣 transform 拒绝
  // ─────────────────────────────────────────────────────────────
  it('用例4:梅花(♣)当杀 → transform 被拒绝(不是红色)', async () => {
    const club = makeCard('c2', '桃', '♣', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c2'], skills: ['武圣'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { c2: club },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '武圣', actionType: 'transform', params: { cardId: 'c2' } });
  });
});