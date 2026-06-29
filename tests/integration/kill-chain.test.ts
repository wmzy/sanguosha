// 完整结算链路验证:杀→询问闪→出闪/不出闪 + 被询问闪时不能出杀
import { frameCards } from '../../src/engine/create-engine';
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function build(): GameState {
  const slash: Card = { id: 's0', name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
  const dodge: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
  const slash2: Card = { id: 's2', name: '杀', suit: '♣', color: '黑', rank: '5', type: '基本牌' };
  return createGameState({
    players: [
      {
        index: 0,
        name: 'P1',
        character: '主公',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: ['s0'],
        equipment: {},
        skills: ['杀'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '反',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: ['d1', 's2'],
        equipment: {},
        skills: ['闪', '杀'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
    ],
    cardMap: { s0: slash, d1: dodge, s2: slash2 },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('杀结算链路 + 前端校验对齐', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('出杀→P2出闪→不扣血→处理区清空', async () => {
    await harness.setup(build());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    await P1.useCardAndTarget('杀', 's0', [1]);
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });
    expect(harness.state.players[1].health).toBe(4);
    expect(frameCards(harness.state)).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('s0');
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  it('出杀→P2不出闪→扣1血→处理区清空', async () => {
    await harness.setup(build());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    await P1.useCardAndTarget('杀', 's0', [1]);
    P2.expectPending('询问闪');
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
    expect(frameCards(harness.state)).toEqual([]);
  });

  it('被询问闪时出杀被respond validate拒绝(FixRespond修复验证)', async () => {
    await harness.setup(build());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    await P1.useCardAndTarget('杀', 's0', [1]);
    P2.expectPending('询问闪');
    // P2 尝试用杀 respond —— 必须被拒绝
    await P2.expectRejected({ skillId: '杀', actionType: 'respond', params: { cardId: 's2' } });
    // 处理区应该只有杀牌
    expect(frameCards(harness.state)).toEqual(['s0']);
    // 询问闪仍在
    P2.expectPending('询问闪');
  });

  it('出杀→P2出闪→P2手牌减少→闪进弃牌堆', async () => {
    await harness.setup(build());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    await P1.useCardAndTarget('杀', 's0', [1]);
    await P2.respond('闪', { cardId: 'd1' });
    // P2 手牌从2变1(出了闪),还有杀
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.zones.discardPile).toContain('d1');
  });
});
