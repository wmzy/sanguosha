// 界秘计(界王异·魏·主动技)行为测试:
//   OL 界限突破官方逐字:
//   "结束阶段,你可以摸X张牌(X为你已损失的体力值),
//    然后你可以交给其他角色至多X张牌。"
//
// 验证场景:
//   ① happy path:X=2 → 摸2张 → 不分发
//   ② 摸2 + 分发1张给其他角色
//   ③ X=0(满血)→ 不触发
//   ④ 王异不发动 → 无效果
//   ⑤ 由贞烈选项②挂起 → 强制发动一次(无发动确认,但仍可选分发)
//
// 触发方式:applyAtom({ type: '阶段开始', player: 0, phase: '回合结束' })
//   引擎中"结束阶段" = phase '回合结束'(详见 勤学/崩坏/界志继)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
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
    character: opts.character ?? '界王异',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: '魏',
  };
}

/** 触发结束阶段:阶段开始(回合结束) atom */
async function triggerEndPhase(harness: SkillTestHarness, player: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { applyAtom } = await import('../../src/engine/create-engine');
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '回合结束' });
  await harness.waitForStable();
}

describe('界秘计', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── ① happy path:X=2 → 摸2张(不分发) ───────────────────

  it('①:结束阶段已损2体 → 摸2张牌,不分发', async () => {
    const draw1 = makeCard('dr1', '杀', '♠', '3');
    const draw2 = makeCard('dr2', '闪', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界秘计'],
          health: 1, // 已损 2(3-1)
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { dr1: draw1, dr2: draw2 },
      zones: { deck: ['dr2', 'dr1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应'); // 是否发动

    await P0.respond('界秘计', { choice: true });
    P0.expectPending('请求回应'); // 是否分发

    await P0.respond('界秘计', { choice: false }); // 不分发
    await harness.waitForStable();

    // 断言:P0 摸2张(dr1, dr2);无 pending
    expect(harness.state.players[0].hand).toEqual(['dr1', 'dr2']);
    expect(harness.state.zones.deck).toEqual([]);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── ② 摸2 + 分发1张 ───────────────────────────────────

  it('②:结束阶段已损2体 → 摸2张 → 分发1张给 P1', async () => {
    const draw1 = makeCard('dr1', '杀', '♠', '3');
    const draw2 = makeCard('dr2', '闪', '♥', '4');
    const ownCard = makeCard('own1', '桃', '♦', '6');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['own1'],
          skills: ['界秘计'],
          health: 1, // 已损 2
          maxHealth: 3,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { dr1: draw1, dr2: draw2, own1: ownCard },
      zones: { deck: ['dr2', 'dr1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应');

    await P0.respond('界秘计', { choice: true }); // 发动
    P0.expectPending('请求回应'); // 是否分发

    await P0.respond('界秘计', { choice: true }); // 分发
    P0.expectPending('请求回应'); // 选目标

    await P0.respond('界秘计', { target: 1 }); // P1
    P0.expectPending('请求回应'); // 选 0..X 张手牌

    // P0 手牌:own1 + dr1 + dr2(共 3 张);选 own1 给 P1
    await P0.respond('界秘计', { cardIds: ['own1'] });
    await harness.waitForStable();

    // 断言:P0 摸了2张,给 P1 一张 own1
    expect(harness.state.players[0].hand).toEqual(['dr1', 'dr2']);
    expect(harness.state.players[1].hand).toEqual(['own1']);
  });

  // ─── ③ X=0(满血)→ 不触发 ───────────────────────────────

  it('③:结束阶段满血(X=0)→ 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界秘计'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: {},
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);

    await triggerEndPhase(harness, 0);
    // 无 pending(X=0 不触发)
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── ④ 不发动 → 无效果 ──────────────────────────────────

  it('④:结束阶段询问发动 → 选择不发动 → 无效果', async () => {
    const draw1 = makeCard('dr1', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界秘计'],
          health: 1,
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { dr1: draw1 },
      zones: { deck: ['dr1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应'); // 是否发动

    await P0.respond('界秘计', { choice: false }); // 不发动
    await harness.waitForStable();

    // 断言:P0 未摸牌;无 pending
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['dr1']);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── ⑤ 贞烈挂起 → 强制发动一次 ───────────────────────────

  it('⑤:贞烈选项②挂起(turn.vars 标记)→ 结束阶段强制发动一次,然后询问主动发动', async () => {
    const draw1 = makeCard('dr1', '杀', '♠', '3');
    const draw2 = makeCard('dr2', '闪', '♥', '4');
    const draw3 = makeCard('dr3', '桃', '♦', '5');
    const draw4 = makeCard('dr4', '酒', '♣', '6');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界秘计'],
          health: 1, // 已损 2
          maxHealth: 3,
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { dr1: draw1, dr2: draw2, dr3: draw3, dr4: draw4 },
      zones: { deck: ['dr4', 'dr3', 'dr2', 'dr1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: {
        round: 1,
        phase: '回合结束',
        vars: { '秘计/pendingFrom贞烈/0': true as Json },
      },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness, 0);

    // 强制发动跳过 confirm,直接弹"是否分发"(强制秘计)
    P0.expectPending('请求回应');
    // 通过 requestType 验证是 giveConfirm(强制发动已自动摸2张)
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { requestType?: string }).requestType).toBe('秘计/giveConfirm');

    // 选择不分发
    await P0.respond('界秘计', { choice: false });
    await harness.waitForStable();

    // 然后主动询问是否发动(正常秘计)
    P0.expectPending('请求回应');
    const slot2 = [...harness.state.pendingSlots.values()][0];
    expect((slot2.atom as { requestType?: string }).requestType).toBe('秘计/confirm');

    // 选择主动发动 → 摸2张
    await P0.respond('界秘计', { choice: true });
    P0.expectPending('请求回应'); // 是否分发

    await P0.respond('界秘计', { choice: false }); // 不分发
    await harness.waitForStable();

    // 断言:挂起标记已清;P0 共摸 4 张(强制2 + 主动2)
    expect(harness.state.turn.vars['秘计/pendingFrom贞烈/0']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['dr1', 'dr2', 'dr3', 'dr4']);
  });
});
