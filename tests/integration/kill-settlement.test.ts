// 杀的完整结算流程测试:出杀→询问闪→出闪/不出闪→伤害/miss→处理区清理
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function build(opts?: { p1Hand?: string[]; p2Hand?: string[]; extraCards?: Record<string, Card> }): GameState {
  const slash: Card = { id: 's0', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  const cards: Record<string, Card> = { s0: slash, ...opts?.extraCards };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true,
        hand: ['s0'], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '反', health: 4, maxHealth: 4, alive: true,
        hand: opts?.p2Hand ?? [], equipment: {}, skills: ['闪'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('杀完整结算流程', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  it('出杀→P2 不出闪→扣1血→杀牌进弃牌堆→处理区清空', async () => {
    const dodge: Card = { id: 'd1', name: '闪', suit: '♥', rank: '2', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['d1'], extraCards: { d1: dodge } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's0', [1]);
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪

    expect(harness.state.players[1].health).toBe(3);
    // 杀牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('s0');
    // 处理区清空
    expect(harness.state.zones.processing).toEqual([]);
  });

  it('出杀→P2 出闪→不扣血→杀和闪都进弃牌堆→处理区清空', async () => {
    const dodge: Card = { id: 'd1', name: '闪', suit: '♥', rank: '2', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['d1'], extraCards: { d1: dodge } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's0', [1]);
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });

    expect(harness.state.players[1].health).toBe(4); // 不扣血
    expect(harness.state.zones.discardPile).toContain('s0');
    expect(harness.state.zones.discardPile).toContain('d1');
    expect(harness.state.zones.processing).toEqual([]);
  });

  it('BUG验证:被询问闪时不能 respond 杀(P2有杀技能)', async () => {
    // P2 同时有杀和闪技能,手牌只有杀
    const slash2: Card = { id: 's2', name: '杀', suit: '♣', rank: '5', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['s2'], extraCards: { s2: slash2 } }));
    // 手动给 P2 加杀技能
    harness.state.players[1].skills.push('杀');
    harness.rebuildViews();
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's0', [1]);
    P2.expectPending('询问闪');
    // P2 尝试用杀 respond(应该被拒绝——当前是询问闪不是询问杀)
    await P2.expectRejected({ skillId: '杀', actionType: 'respond', params: { cardId: 's2' } });
    // 处理区应该只有杀牌(没被污染)
    expect(harness.state.zones.processing).toEqual(['s0']);
  });

  it('出杀后处理区状态:只有杀牌(无其他泄漏)', async () => {
    await harness.setup(build());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's0', [1]);
    // 询问闪期间,处理区应该只有杀牌
    expect(harness.state.zones.processing).toEqual(['s0']);
    await P2.pass();
    // 结算后处理区清空
    expect(harness.state.zones.processing).toEqual([]);
  });
});
