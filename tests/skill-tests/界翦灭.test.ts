// 界翦灭(界张春华·主动技)测试:
//   "出牌阶段限一次,你可与一名其他角色同时选择一种颜色,你与其弃置各自选择颜色的手牌,
//    然后弃置牌较多的角色视为对另一角色使用【决斗】。"
//
// 覆盖:
//   1. 春华弃得多 → 春华 视为对 目标 使用决斗
//   2. 目标弃得多 → 目标 视为对 春华 使用决斗
//   3. 弃置数相等 → 不决斗
//   4. 限一次/回合:第二次被拒
//   5. 不能以自己为目标
//   6. 不是自己回合 → 拒绝
//   7. 目标无手牌 → 拒绝
//   8. 春华无手牌 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
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
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界张春华',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? opts.health ?? 3,
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

/** 红色手牌(♥/♦) */
function redCard(id: string, name = '杀', rank = 'A'): Card {
  return makeCard(id, name, '♥', rank);
}
/** 黑色手牌(♠/♣) */
function blackCard(id: string, name = '杀', rank = 'A'): Card {
  return makeCard(id, name, '♠', rank);
}

describe('界翦灭', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 春华弃得多 → 春华 视为对 目标 使用决斗 ────────────
  it('春华弃得多 → 春华决斗目标(目标受1伤害,春华满血)', async () => {
    // 春华 3 红;目标 1 红。春华选红、目标选红 → 春华弃3张 > 目标弃1张 → 春华决斗目标
    // 春华手牌全是杀,决斗中目标无杀→输→受1点伤害(春华来源→绝情→失去体力)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: ['r1', 'r2', 'r3'],
          skills: ['界翦灭', '界绝情'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: '敌',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: {
        r1: redCard('r1'),
        r2: redCard('r2'),
        r3: redCard('r3'),
        t1: redCard('t1'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');
    const P1 = harness.player('敌');

    await P0.triggerAction('界翦灭', 'use', { target: 1 });
    await waitForStable(harness.state);

    // 春华选红(choice=true)
    await P0.respond('界翦灭', { choice: true });
    await waitForStable(harness.state);
    // 目标选红(choice=true)
    await P1.respond('界翦灭', { choice: true });
    await waitForStable(harness.state);

    // 决斗:春华发起,目标先出杀。目标无杀(已被弃置)→ 输 → 受1点伤害
    // 但目标唯一手牌 t1 已被弃置。决斗开始时目标无杀可出 → 输 → 受伤
    // 等所有 pending 结束
    while (harness.state.pendingSlots.size > 0) {
      // 决斗询问杀:目标无杀,pass
      await P1.pass();
      await waitForStable(harness.state);
    }

    // 目标受伤(失去体力,因春华绝情)
    expect(harness.state.players[1].health).toBe(2); // 3 - 1
    expect(harness.state.players[0].health).toBe(3);
    // 限一次标记
    expect(harness.state.players[0].vars['界翦灭/usedThisTurn']).toBe(true);
  });

  // ─── 2. 目标弃得多 → 目标 视为对 春华 使用决斗 ────────────
  it('目标弃得多 → 目标决斗春华(春华受1伤害)', async () => {
    // 春华 1 黑;目标 3 黑。春华选黑、目标选黑 → 目标弃3 > 春华弃1 → 目标决斗春华
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: ['b1'],
          skills: ['界翦灭'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: '敌',
          character: '曹操',
          hand: ['t1', 't2', 't3'],
          skills: [],
        }),
      ],
      cardMap: {
        b1: blackCard('b1'),
        t1: blackCard('t1'),
        t2: blackCard('t2'),
        t3: blackCard('t3'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');
    const P1 = harness.player('敌');

    await P0.triggerAction('界翦灭', 'use', { target: 1 });
    await waitForStable(harness.state);
    // 春华选黑(choice=false)
    await P0.respond('界翦灭', { choice: false });
    await waitForStable(harness.state);
    // 目标选黑
    await P1.respond('界翦灭', { choice: false });
    await waitForStable(harness.state);

    // 决斗:目标发起,春华先出杀。春华手牌已被弃光 → 输 → 受1伤(目标来源,正常伤害)
    while (harness.state.pendingSlots.size > 0) {
      await P0.pass();
      await waitForStable(harness.state);
    }

    expect(harness.state.players[0].health).toBe(2); // 3 - 1
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 3. 弃置数相等 → 不决斗 ────────────────────────────
  it('弃置数相等(双方均0)→ 不决斗,无事发生', async () => {
    // 春华 2 红;目标 2 黑。春华选黑(choice=false,0张)、目标选红(choice=true,0张)
    // 双方各弃0张 → 相等 → 无决斗
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: ['r1', 'r2'],
          skills: ['界翦灭'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: '敌',
          character: '曹操',
          hand: ['t1', 't2'],
          skills: [],
        }),
      ],
      cardMap: {
        r1: redCard('r1'),
        r2: redCard('r2'),
        t1: blackCard('t1'),
        t2: blackCard('t2'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');
    const P1 = harness.player('敌');

    await P0.triggerAction('界翦灭', 'use', { target: 1 });
    await waitForStable(harness.state);
    // 春华选黑(她没有黑色 → 弃0)
    await P0.respond('界翦灭', { choice: false });
    await waitForStable(harness.state);
    // 目标选红(他没有红色 → 弃0)
    await P1.respond('界翦灭', { choice: true });
    await waitForStable(harness.state);

    // 双方均未受伤,手牌未变
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[1].hand.length).toBe(2);
    // 无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    // 限一次仍标记
    expect(harness.state.players[0].vars['界翦灭/usedThisTurn']).toBe(true);
  });

  // ─── 4. 限一次/回合 ────────────────────────────────────
  it('每回合限一次:第二次发动被拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: ['r1', 'r2'],
          skills: ['界翦灭'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: '敌',
          character: '曹操',
          hand: ['t1'],
          skills: [],
        }),
      ],
      cardMap: {
        r1: redCard('r1'),
        r2: redCard('r2'),
        t1: blackCard('t1'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');
    const P1 = harness.player('敌');

    // 第一次
    await P0.triggerAction('界翦灭', 'use', { target: 1 });
    await waitForStable(harness.state);
    await P0.respond('界翦灭', { choice: false });
    await waitForStable(harness.state);
    await P1.respond('界翦灭', { choice: true });
    await waitForStable(harness.state);
    while (harness.state.pendingSlots.size > 0) {
      await P0.pass();
      await waitForStable(harness.state);
    }

    // 第二次:拒绝
    await P0.expectRejected({
      skillId: '界翦灭',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 5. 不能以自己为目标 ────────────────────────────────
  it('validate:不能以自己为目标', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '春华', hand: ['r1'], skills: ['界翦灭'] }),
        makePlayer({ index: 1, name: '敌', character: '曹操', hand: ['t1'], skills: [] }),
      ],
      cardMap: { r1: redCard('r1'), t1: blackCard('t1') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');

    await P0.expectRejected({
      skillId: '界翦灭',
      actionType: 'use',
      params: { target: 0 },
    });
  });

  // ─── 6. 不是自己回合 → 拒绝 ────────────────────────────
  it('不是自己回合 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '春华', hand: ['r1'], skills: ['界翦灭'] }),
        makePlayer({ index: 1, name: '敌', character: '曹操', hand: ['t1'], skills: [] }),
      ],
      cardMap: { r1: redCard('r1'), t1: blackCard('t1') },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');

    await P0.expectRejected({
      skillId: '界翦灭',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 7. 目标无手牌 → 拒绝 ────────────────────────────────
  it('目标无手牌 → use 被拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '春华', hand: ['r1'], skills: ['界翦灭'] }),
        makePlayer({ index: 1, name: '敌', character: '曹操', hand: [], skills: [] }),
      ],
      cardMap: { r1: redCard('r1') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');

    await P0.expectRejected({
      skillId: '界翦灭',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  // ─── 8. 春华无手牌 → 拒绝 ────────────────────────────────
  it('春华无手牌 → use 被拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '春华', hand: [], skills: ['界翦灭'] }),
        makePlayer({ index: 1, name: '敌', character: '曹操', hand: ['t1'], skills: [] }),
      ],
      cardMap: { t1: blackCard('t1') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');

    await P0.expectRejected({
      skillId: '界翦灭',
      actionType: 'use',
      params: { target: 1 },
    });
  });
});
