// tests/skill-tests/青囊.test.ts
// 青囊(华佗·群雄)技能测试:
//   出牌阶段限一次,你可以弃置一张手牌,然后令一名角色回复 1 点体力。
//
// 验证:
//   1. 正面:弃一张手牌 → 自己回复 1 体力,本回合不可再用
//   2. 正面:令他人回复 1 体力
//   3. 负面:非自己回合 → 拒绝
//   4. 负面:本回合已用过 → 拒绝(限一次)
//   5. 负面:目标体力已满 → 拒绝
//   6. 负面:不在手牌的牌 → 拒绝
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
    character: '华佗',
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

describe('青囊', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:自救 ─────────────────────────────

  it('use:弃一张手牌 → 自己回复 1 体力,本回合不可再用', async () => {
    const card = makeCard('d1', '杀', '♠', '2'); // 任意手牌即可(颜色无关)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '华佗',
          hand: ['d1'],
          skills: ['青囊'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { d1: card },
      currentPlayerIndex: 0, // 华佗回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const HuaTuo = harness.player('华佗');

    // 对自己使用青囊(target=0)
    await HuaTuo.useCardAndTarget('青囊', 'd1', [0]);

    // 体力 2 → 3(满),手牌进弃牌堆
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('d1');
    expect(harness.state.players[0].hand).not.toContain('d1');
    // 限一次标记已置
    expect(harness.state.players[0].vars['青囊/usedThisTurn']).toBe(true);

    // view 级断言:turnUsage 已同步(前端据此禁用按钮)
    HuaTuo.processEvents();
    HuaTuo.expectView((v) => expect(v.players[0].turnUsage?.['青囊/usedThisTurn']).toBe(true));
  });

  // ─── 正面:救他人 ───────────────────────────

  it('use:弃一张手牌 → 令他人回复 1 体力', async () => {
    const card = makeCard('d1', '闪', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '华佗',
          hand: ['d1'],
          skills: ['青囊'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          health: 2,
          maxHealth: 4,
        }),
      ],
      cardMap: { d1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const HuaTuo = harness.player('华佗');

    // 对 P1 使用青囊(target=1)
    await HuaTuo.useCardAndTarget('青囊', 'd1', [1]);

    expect(harness.state.players[1].health).toBe(3); // 2 → 3
    expect(harness.state.zones.discardPile).toContain('d1');
    // 华佗自身体力不变(仍满)
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 负面 ─────────────────────────────────

  it('use:非自己回合 → 拒绝', async () => {
    const card = makeCard('d1', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '华佗',
          hand: ['d1'],
          skills: ['青囊'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { d1: card },
      currentPlayerIndex: 1, // P1 回合,不是华佗
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const HuaTuo = harness.player('华佗');

    await HuaTuo.expectRejected({
      skillId: '青囊',
      actionType: 'use',
      params: { cardId: 'd1', targets: [0] },
    });
  });

  it('use:本回合已用过 → 拒绝(限一次)', async () => {
    const c1 = makeCard('d1', '杀', '♠', '2');
    const c2 = makeCard('d2', '闪', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '华佗',
          hand: ['d1', 'd2'],
          skills: ['青囊'],
          health: 1,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { d1: c1, d2: c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const HuaTuo = harness.player('华佗');

    // 第一次:合法
    await HuaTuo.useCardAndTarget('青囊', 'd1', [0]);
    expect(harness.state.players[0].health).toBe(2);

    // 第二次:本回合已用过 → 拒绝
    await HuaTuo.expectRejected({
      skillId: '青囊',
      actionType: 'use',
      params: { cardId: 'd2', targets: [0] },
    });
  });

  it('use:目标体力已满 → 拒绝', async () => {
    const card = makeCard('d1', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '华佗',
          hand: ['d1'],
          skills: ['青囊'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { d1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const HuaTuo = harness.player('华佗');

    // 目标 P1 体力已满(4/4) → 拒绝
    await HuaTuo.expectRejected({
      skillId: '青囊',
      actionType: 'use',
      params: { cardId: 'd1', targets: [1] },
    });
  });

  it('use:不在手牌的牌 → 拒绝', async () => {
    const fake = makeCard('dX', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '华佗',
          hand: [],
          skills: ['青囊'],
          health: 2,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { dX: fake },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const HuaTuo = harness.player('华佗');

    await HuaTuo.expectRejected({
      skillId: '青囊',
      actionType: 'use',
      params: { cardId: 'dX', targets: [0] },
    });
  });
});
