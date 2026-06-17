// 示范:用 expectRejected 捕获 validate 缺陷(之前 SkillTestHarness 测不出的)
// 验证 mimo 修复的 use action validate 拒绝非法时机
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function build(opts?: { p0Extra?: string[]; extraCards?: Record<string, Card> }): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  const cards: Record<string, Card> = { c1: slash, ...opts?.extraCards };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true,
        hand: ['c1', ...(opts?.p0Extra ?? [])], equipment: {}, skills: ['杀'],
        vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '反', health: 4, maxHealth: 4, alive: true,
        hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('validate 负面测试示范(expectRejected)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  it('出不在手牌的牌被拒绝', async () => {
    const fake: Card = { id: 'cX', name: '杀', suit: '♠', rank: '2', type: '基本牌' };
    await harness.setup(build({ extraCards: { cX: fake } }));
    const P1 = harness.player('P1');
    // cX 不在 P1 手牌中
    await P1.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: 'cX', targets: [1] } });
  });

  it('出的牌名不是杀被拒绝(用闪的 cardId 出杀)', async () => {
    const dodge: Card = { id: 'd1', name: '闪', suit: '♥', rank: '2', type: '基本牌' };
    await harness.setup(build({ p0Extra: ['d1'], extraCards: { d1: dodge } }));
    const P1 = harness.player('P1');
    await P1.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: 'd1', targets: [1] } });
  });

  it('pending 期间出杀被拒绝(防死锁)', async () => {
    await harness.setup(build());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    // 出杀 → P2 询问闪 pending
    await P1.useCardAndTarget('杀', 'c1', [1]);
    // 此时 pending 存在,P1 再出杀应被拒
    const slash2: Card = { id: 'c2', name: '杀', suit: '♠', rank: '3', type: '基本牌' };
    harness.state.cardMap['c2'] = slash2;
    harness.state.players[0].hand.push('c2');
    await P1.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: 'c2', targets: [1] } });
  });

  it('非自己回合出杀被拒绝', async () => {
    await harness.setup(build());
    const P2 = harness.player('P2'); // P2 不是当前玩家
    await P2.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: 'c1', targets: [0] } });
  });
});
