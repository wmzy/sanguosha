// 奇才(黄月英·锁定技):你使用任何锦囊牌无距离限制。
//
// 验证:
//   1. 单元:onInit 后 owner.tags 含「奇才/无距离限制」
//   2. 触发(实际 dispatch):P0(奇才)对距离 2 的 P3 用顺手牵羊 → validate 通过(忽略距离)
//   3. 负面:无奇才时同场景顺手牵羊被拒(距离 2 > 1)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
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

function build4PlayerState(p0Skills: string[], p0Hand: string[] = []): GameState {
  const sq = makeCard('sq1', '顺手牵羊', '♠', '4');
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: p0Hand, skills: p0Skills }),
      makePlayer({ index: 1, name: 'P2', skills: [] }),
      // P3(idx 2) 持有一张手牌,供顺手牵羊获取
      makePlayer({ index: 2, name: 'P3', hand: ['v1'], skills: [] }),
      makePlayer({ index: 3, name: 'P4', skills: [] }),
    ],
    cardMap: {
      sq1: sq,
      v1: makeCard('v1', '杀', '♥', '5', '基本牌'),
    },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('奇才', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('单元:onInit 后 owner.tags 含「奇才/无距离限制」', async () => {
    await harness.setup(build4PlayerState(['奇才', '顺手牵羊'], ['sq1']));
    expect(harness.state.players[0].tags).toContain('奇才/无距离限制');
  });

  it('触发:P0(奇才)对距离 2 的 P3 用顺手牵羊 → validate 通过(忽略距离)', async () => {
    await harness.setup(build4PlayerState(['奇才', '顺手牵羊'], ['sq1']));
    const P1 = harness.player('P1');

    // 距离 2(座位距离 2,无进攻修正),奇才忽略距离 → validate 通过
    // 通过后进入无懈可击窗口(请求回应),证明 validate 已放行
    await P1.triggerAction('顺手牵羊', 'use', { cardId: 'sq1', target: 2 });
    P1.expectPending('请求回应');
    // 锦囊已打出:不在 P0 手牌,且在栈顶结算帧的处理区牌列表中
    expect(harness.state.players[0].hand).not.toContain('sq1');
    const topFrame =
      harness.state.settlementStack[harness.state.settlementStack.length - 1];
    expect(topFrame?.cards).toContain('sq1');
  });

  it('负面:无奇才 → 对距离 2 的 P3 用顺手牵羊被拒(距离太远)', async () => {
    await harness.setup(build4PlayerState(['顺手牵羊'], ['sq1']));
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 2 },
    });
  });
});
