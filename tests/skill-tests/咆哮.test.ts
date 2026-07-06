// 咆哮(张飞·锁定技):出牌阶段使用【杀】无次数限制。
//
// 验证:
//   1. 单元:咆哮在 skills 中 → slashMax(state, 0) === Infinity
//   2. 单元:无咆哮 → slashMax 默认 1
//   3. 触发(实际 dispatch):P0 连续出 2 张杀均生效,P1 受 2 点伤害
//   4. 负面:无咆哮时第二张杀被拒(出杀次数上限 1)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { slashMax } from '../../src/engine/slash-quota';
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

describe('咆哮', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('单元:咆哮在 skills 中 → slashMax = Infinity', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['咆哮', '杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    expect(slashMax(harness.state, 0)).toBe(Infinity);
  });

  it('单元:无咆哮 → slashMax 默认 1', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    expect(slashMax(harness.state, 0)).toBe(1);
  });

  it('触发:P0 连续出 2 张杀 → 均生效,P1 受 2 点伤害', async () => {
    const s1 = makeCard('s1', '杀', '♠', 'A');
    const s2 = makeCard('s2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1', 's2'], skills: ['咆哮', '杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { s1, s2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 第一张杀
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass(); // 不出闪 → 受 1 点伤害
    expect(harness.state.players[1].health).toBe(3);

    // 第二张杀(咆哮突破上限,无咆哮则此处会被拒)
    await P1.useCardAndTarget('杀', 's2', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
  });

  it('负面:无咆哮 → 第二张杀被拒(出杀次数上限 1)', async () => {
    const s1 = makeCard('s1', '杀', '♠', 'A');
    const s2 = makeCard('s2', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1', 's2'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { s1, s2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 第一张杀:用掉本回合唯一的出杀次数
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);

    // 第二张杀:无咆哮,usedCount(1) 已达上限 → 被拒
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 's2', targets: [1] },
    });
  });
});
