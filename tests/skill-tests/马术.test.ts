// 马术(马超·锁定技):你计算与其他角色的距离时,始终-1。
//
// 验证:
//   1. 单元:onInit 后 vars['距离/进攻修正'] = 1
//   2. 单元:4 人局 P0→P2 座位距离 2,马术使 effectiveDistance = 1
//   3. 触发(实际 dispatch):P0 徒手(范围 1)对距离 2 的 P2 出杀 → 命中(马术把距离缩到 1)
//   4. 负面:无马术时同场景出杀被拒(距离 2 > 范围 1)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { effectiveDistance } from '../../src/engine/distance';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
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
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
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

/** 4 人存活局:P0/P1/P2/P3 */
function build4PlayerState(p0Skills: string[], p0Hand: string[] = []): GameState {
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: p0Hand, skills: p0Skills }),
      makePlayer({ index: 1, name: 'P2', skills: [] }),
      makePlayer({ index: 2, name: 'P3', skills: [] }),
      makePlayer({ index: 3, name: 'P4', skills: [] }),
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('马术', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('单元:onInit 后 vars[距离/进攻修正] = 1', async () => {
    await harness.setup(build4PlayerState(['马术']));
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(1);
  });

  it('单元:4 人局 P0→P2 座位距离 2,马术使 effectiveDistance = 1', async () => {
    await harness.setup(build4PlayerState(['马术']));
    // 座位距离 2,进攻修正 1 → 实际距离 1
    expect(effectiveDistance(harness.state, 0, 2)).toBe(1);
  });

  it('单元:无马术时 P0→P2 effectiveDistance = 2', async () => {
    await harness.setup(build4PlayerState([]));
    expect(effectiveDistance(harness.state, 0, 2)).toBe(2);
  });

  it('触发:P0(徒手,范围1)对距离 2 的 P3 出杀 → 命中(马术缩距到 1)', async () => {
    const slash = makeCard('s1', '杀', '♠', 'A');
    const state = build4PlayerState(['马术', '杀'], ['s1']);
    state.cardMap = { s1: slash };
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    // 无马术时距离 2 > 范围 1 会被拒;有马术距离缩为 1 → 接受
    await P1.useCardAndTarget('杀', 's1', [2]);
    // P3 被询问闪 → 不出 → 受 1 点伤害
    await P3.pass();
    expect(harness.state.players[2].health).toBe(3);
  });

  it('负面:无马术 → 对距离 2 的 P3 出杀被拒(超出范围)', async () => {
    const slash = makeCard('s1', '杀', '♠', 'A');
    const state = build4PlayerState(['杀'], ['s1']);
    state.cardMap = { s1: slash };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 's1', targets: [2] },
    });
  });
});
