// 激将(刘备·主公技):出牌阶段,主公可请求一名蜀势力角色出杀。
//   该角色选择出杀或不出(不出则主公摸 1 张)。
//
// 实现:
//   - use action:validate(主公 + 蜀势力目标)→ execute(请求回应 → 检查处理区有杀)
//   - 出杀:杀进处理区 → 激将 execute 移杀到弃牌堆 → 指定目标 → 询问闪 → 造成伤害
//   - 不出:主公摸 1 张
//
// 验证:
//   1. 正面:蜀势力角色出杀 → 对 killTarget 造成伤害
//   2. 正面:蜀势力角色不出杀 → 主公摸 1 张
//   3. 负面:非主公(ownerId≠0)不能使用
//   4. 负面:目标非蜀势力 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, Faction, GameState, PlayerState } from '../../src/engine/types';

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
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
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
    faction: opts.faction,
  };
}

describe('激将', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:蜀势力角色出杀 → 造成伤害 ──────────────────────────

  it('正面:主公激将 → 蜀势力角色出杀 → killTarget 扣血', async () => {
    const restoreAutoCompare = disableAutoCompare();
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['杀'], faction: '蜀' }),
        makePlayer({ index: 2, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P0(主公)发动激将,请求 P1(蜀)出杀指定 P2
    await P0.triggerAction('激将', 'use', { target: 1, killTarget: 2 });

    // P1 被询问是否出杀
    const slot = harness.state.pendingSlots.get(1);
    expect(slot?.atom.type).toBe('请求回应');
    expect((slot?.atom as { requestType?: string }).requestType).toBe('杀/respondKill');

    // P1 出杀
    await P1.respond('杀', { cardId: 'k1' });

    // P2 被询问闪
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪

    // P2 扣1血
    expect(harness.state.players[2].health).toBe(3);
    // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
    restoreAutoCompare();
  });

  // ─── 正面:蜀势力角色不出杀 → 主公摸1张 ────────────────────────

  it('正面:蜀势力角色不出杀 → 主公摸 1 张', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', hand: ['k1'], skills: ['杀'], faction: '蜀' }),
        makePlayer({ index: 2, name: 'P2', skills: [] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length;
    await P0.triggerAction('激将', 'use', { target: 1 });

    // P1 被询问但不出杀
    const slot = harness.state.pendingSlots.get(1);
    expect(slot?.atom.type).toBe('请求回应');

    await P1.pass(); // 不出杀

    // 主公摸 1 张
    expect(harness.state.players[0].hand.length).toBe(handBefore + 1);
    // P1 的杀未消耗
    expect(harness.state.players[1].hand).toContain('k1');
  });

  // ─── 负面:非主公不能使用激将 ─────────────────────────────────

  it('负面:非主公(ownerId≠0)使用激将 → 拒绝', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: [] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1'],
          skills: ['激将', '杀'],
          faction: '蜀',
        }),
        makePlayer({ index: 2, name: 'P2', skills: [], faction: '蜀' }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1(index=1)不是主公 → 拒绝
    await P1.expectRejected({
      skillId: '激将',
      actionType: 'use',
      params: { target: 2, killTarget: 0 },
    });
  });

  // ─── 负面:目标非蜀势力 → 拒绝 ────────────────────────────────

  it('负面:目标非蜀势力(魏)→ 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', skills: ['杀'], faction: '魏' }),
        makePlayer({ index: 2, name: 'P2', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 是魏势力 → 拒绝
    await P0.expectRejected({
      skillId: '激将',
      actionType: 'use',
      params: { target: 1, killTarget: 2 },
    });
  });

  // ─── 负面:非自己回合 → 拒绝 ──────────────────────────────────

  it('负面:非自己回合使用激将 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['激将'], faction: '蜀' }),
        makePlayer({ index: 1, name: 'P1', skills: ['杀'], faction: '蜀' }),
        makePlayer({ index: 2, name: 'P2', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '激将',
      actionType: 'use',
      params: { target: 1, killTarget: 2 },
    });
  });
});
