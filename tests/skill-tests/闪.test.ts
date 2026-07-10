// 闪(基本牌)技能测试:
//   respond:成为杀的目标时,打出闪抵消伤害(闪牌移到处理区供杀结算检查)
//   闪没有 use action(不能主动使用)
//
// 验证:
//   1. 正面:被杀时出闪 → 抵消伤害,杀和闪进弃牌堆
//   2. 正面:被杀时出闪 → 双方不扣血
//   3. 负面:非出闪窗口(无 pending)respond 被拒绝
//   4. 负面:牌名不是闪(用杀当闪)被拒绝
//   5. 负面:不在手牌的卡被拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
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

function makePlayer(opts: {
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
  };
}

describe('闪', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:被杀时出闪 → 抵消伤害 ─────────────────────────────

  it('正面:被杀时出闪 → 抵消伤害,杀和闪进弃牌堆', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('s1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['s1'], skills: ['闪'] }),
      ],
      cardMap: { k1: slash, s1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀 → P2 被询问闪
    await P1.useCardAndTarget('杀', 'k1', [1]);
    P2.expectPending('询问闪');

    // P2 出闪
    await P2.respond('闪', { cardId: 's1' });

    // 杀被闪抵消 → P2 不扣血
    expect(harness.state.players[1].health).toBe(4);
    // 杀和闪都进弃牌堆
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['k1', 's1']));
    // view 级断言
    P2.processEvents();
    P2.expectView((v) => expect(v.players[1].health).toBe(4));
  });

  it('正面:被杀时不出闪 → 扣血(对照)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪

    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 负面 ───────────────────────────────────────────────────

  it('负面:非出闪窗口(无 pending)respond 被拒绝', async () => {
    const dodge = makeCard('s1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'], skills: ['闪'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { s1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 无 pending,闪的 respond validate 应拒绝
    await P1.expectRejected({ skillId: '闪', actionType: 'respond', params: { cardId: 's1' } });
  });

  it('负面:牌名不是闪(用杀当闪)被拒绝', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const kill2 = makeCard('k2', '杀', '♣', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['k2'], skills: ['闪'] }),
      ],
      cardMap: { k1: slash, k2: kill2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P2.expectPending('询问闪');

    // P2 试图用杀当闪 → 被拒绝
    await P2.expectRejected({ skillId: '闪', actionType: 'respond', params: { cardId: 'k2' } });
  });

  it('负面:不在手牌的卡被拒绝', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const dodgeElsewhere = makeCard('sX', '闪', '♥', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { k1: slash, sX: dodgeElsewhere },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P2.expectPending('询问闪');

    // P2 试图用不在手牌的闪 → 被拒绝
    await P2.expectRejected({ skillId: '闪', actionType: 'respond', params: { cardId: 'sX' } });
  });
});
