// 界直言(界虞翻·主动技)测试,OL hero/603:
//   你上家或你的结束阶段,你可以令一名角色摸一张牌并展示之,
//   若为装备牌,其使用之并回复1点体力。若为非装备牌且其体力值不等于你,其失去1点体力。
//
// 触发方式:applyAtom(阶段开始, phase='回合结束') 触发结束阶段。
//
// 验证:
//   A. 自己结束阶段 + 选目标 + 摸到非装备牌(目标体力≠自己)→ 目标失去1点体力
//   B. 自己结束阶段 + 摸到非装备牌(目标体力==自己)→ 无效果(只摸牌)
//   C. 自己结束阶段 + 摸到装备牌 → 目标装备之 + 回复1点体力
//   D. 自己结束阶段 + 不发动 → 无效果
//   E. 上家(P1)结束阶段 → P0(界虞翻)触发
//   F. 非自己也非上家结束阶段 → 不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkArmor(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype: '防具' };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
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

/** 触发 player 的结束阶段(applyAtom 阶段开始 phase='回合结束')*/
async function triggerEndPhase(harness: SkillTestHarness, player: number): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player, phase: '回合结束' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界直言(界虞翻·主动技)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── A. 自己结束阶段 + 非装备 + 体力不等于自己 → 失去1点 ─
  it('自己结束阶段,选目标(体力2≠自己3)→ 摸到非装备 → 目标失去1点体力', async () => {
    // 牌堆顶放一张非装备牌
    const top = mkCard('top1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: [],
          skills: ['界直言'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: '目标', hand: [], health: 2, maxHealth: 4 }),
      ],
      cardMap: { top1: top },
      zones: { deck: ['top1'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应'); // 是否发动

    // 发动
    await P0.respond('界直言', { choice: true });
    await harness.waitForStable();
    P0.expectPending('请求回应'); // 选目标

    // 选 P1
    await P0.respond('界直言', { target: 1 });
    await harness.waitForStable();

    // P1 摸到 top1(非装备)且 P1.health=2 ≠ P0.health=3 → P1 失去1点
    expect(harness.state.players[1].hand).toContain('top1');
    expect(harness.state.players[1].health).toBe(1); // 2→1
    // P0 体力不变
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── B. 自己结束阶段 + 非装备 + 体力相等 → 只摸牌,无伤害 ─
  it('自己结束阶段,目标体力==自己 → 摸到非装备 → 无失去体力(只摸牌)', async () => {
    const top = mkCard('top1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: [],
          skills: ['界直言'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: '目标', hand: [], health: 3, maxHealth: 4 }),
      ],
      cardMap: { top1: top },
      zones: { deck: ['top1'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');

    await triggerEndPhase(harness, 0);
    await P0.respond('界直言', { choice: true });
    await harness.waitForStable();
    await P0.respond('界直言', { target: 1 });
    await harness.waitForStable();

    // P1 摸到非装备,体力相等 → 无失去体力
    expect(harness.state.players[1].hand).toContain('top1');
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── C. 自己结束阶段 + 装备牌 → 目标装备之 + 回复1点 ────
  it('自己结束阶段,选受伤目标 → 摸到装备(防具)→ 目标装备之 + 回复1点体力', async () => {
    const armor = mkArmor('ar1', '八卦阵', '♣');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: [],
          skills: ['界直言'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: '目标', hand: [], health: 2, maxHealth: 4 }),
      ],
      cardMap: { ar1: armor },
      zones: { deck: ['ar1'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');

    await triggerEndPhase(harness, 0);
    await P0.respond('界直言', { choice: true });
    await harness.waitForStable();
    await P0.respond('界直言', { target: 1 });
    await harness.waitForStable();

    // 装备到防具栏
    expect(harness.state.players[1].equipment['防具']).toBe('ar1');
    expect(harness.state.players[1].hand).not.toContain('ar1');
    // 回复1点(2→3)
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── D. 自己结束阶段 + 不发动 → 无效果 ─────────────────
  it('自己结束阶段 → 不发动 → 无效果', async () => {
    const top = mkCard('top1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: [],
          skills: ['界直言'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: '目标', hand: [], health: 2, maxHealth: 4 }),
      ],
      cardMap: { top1: top },
      zones: { deck: ['top1'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');

    await triggerEndPhase(harness, 0);
    P0.expectPending('请求回应');

    // 不发动
    await P0.respond('界直言', { choice: false });
    await harness.waitForStable();

    // 无后续询问,无效果
    P0.expectNoPending();
    // 牌堆顶仍为 top1(未被摸走)
    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('top1');
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── E. 上家(P1)结束阶段 → P0(界虞翻)触发 ─────────────
  it('上家(P1)结束阶段 → P0(界虞翻)触发询问', async () => {
    // 2人:P1 是 P0 的上家(findNextAlive(P1)=P0)
    const top = mkCard('top1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: [],
          skills: ['界直言'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 3, maxHealth: 4 }),
      ],
      cardMap: { top1: top },
      zones: { deck: ['top1'], processing: [], discardPile: [] },
      currentPlayerIndex: 1, // P1 的回合
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');

    // P1 结束阶段 → P0 触发
    await triggerEndPhase(harness, 1);
    P0.expectPending('请求回应');

    // 拒绝(本测试只验证触发)
    await P0.respond('界直言', { choice: false });
    await harness.waitForStable();
    P0.expectNoPending();
  });

  // ─── F. 非自己也非上家结束阶段 → 不触发 ─────────────────
  it('非上家的其他角色(P2)结束阶段 → P0 不触发(4人场景)', async () => {
    // 4人:P0=界虞翻,P1=下家,P2=非上家也非自己,P3=上家(findNextAlive(P3)=P0)
    // P2 结束阶段 → 不触发 P0
    const top = mkCard('top1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: [],
          skills: ['界直言'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 3, maxHealth: 4 }),
        mkPlayer({ index: 2, name: 'P2', hand: [], health: 3, maxHealth: 4 }),
        mkPlayer({ index: 3, name: 'P3', hand: [], health: 3, maxHealth: 4 }),
      ],
      cardMap: { top1: top },
      zones: { deck: ['top1'], processing: [], discardPile: [] },
      currentPlayerIndex: 2, // P2 的回合
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');

    await triggerEndPhase(harness, 2);
    P0.expectNoPending();
    // 牌堆顶未被摸走
    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('top1');
  });

  // ─── G. 也可以对自己使用(目标=自己,体力相等则无伤害)─────
  it('自己结束阶段,选自己为目标 → 摸到非装备,体力相等 → 只摸牌', async () => {
    const top = mkCard('top1', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        mkPlayer({
          index: 0,
          name: '界虞翻',
          hand: [],
          skills: ['界直言'],
          health: 3,
          maxHealth: 3,
        }),
        mkPlayer({ index: 1, name: 'P1', hand: [], health: 3, maxHealth: 4 }),
      ],
      cardMap: { top1: top },
      zones: { deck: ['top1'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界虞翻');

    await triggerEndPhase(harness, 0);
    await P0.respond('界直言', { choice: true });
    await harness.waitForStable();
    await P0.respond('界直言', { target: 0 }); // 选自己
    await harness.waitForStable();

    // P0 摸到非装备,体力与自己相等 → 无失去体力
    expect(harness.state.players[0].hand).toContain('top1');
    expect(harness.state.players[0].health).toBe(3);
  });
});
