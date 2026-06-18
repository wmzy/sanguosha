// 南蛮入侵行为测试:验证逐个询问杀 + 伤害结算 + 无懈可击
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function build(opts?: { p2Hand?: string[]; p3?: boolean; extraCards?: Record<string, Card> }): GameState {
  const slash: Card = { id: 'c0', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  const nanman: Card = { id: 'nm1', name: '南蛮入侵', suit: '♠', rank: '7', type: '锦囊牌' };
  const cards: Record<string, Card> = { c0: slash, nm1: nanman, ...opts?.extraCards };
  const players = [
    { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true,
      hand: ['nm1'], equipment: {}, skills: ['南蛮入侵'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    { index: 1, name: 'P2', character: '反', health: 4, maxHealth: 4, alive: true,
      hand: opts?.p2Hand ?? [], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
  ];
  if (opts?.p3) {
    players.push({ index: 2, name: 'P3', character: '反', health: 4, maxHealth: 4, alive: true,
      hand: [], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] });
  }
  return createGameState({ players, cardMap: cards, currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} } });
}

describe('南蛮入侵', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  it('P2 无杀 → P2 扣 1 血, 南蛮进弃牌堆', async () => {
    await harness.setup(build());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);
    // 先有无懈可击询问 → pass
    const slot0 = [...harness.state.pendingSlots.values()][0];
    if (slot0 && (slot0.atom as { type: string }).type === '请求回应') {
      await P2.pass();
    }
    // P2 被询问杀
    P2.expectPending('询问杀');
    await P2.pass(); // P2 不出杀

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('nm1');
    expect(harness.state.zones.processing).not.toContain('nm1');
  });

  it('P2 出杀 → P2 不扣血, 杀和南蛮都进弃牌堆', async () => {
    await harness.setup(build({ p2Hand: ['c0'], extraCards: { c0: { id: 'c0', name: '杀', suit: '♠', rank: '2', type: '基本牌' } } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);
    // 先有无懈可击询问 → pass
    const slot0 = [...harness.state.pendingSlots.values()][0];
    if (slot0 && (slot0.atom as { type: string }).type === '请求回应') {
      await P2.pass();
    }
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 'c0' });

    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('nm1');
    expect(harness.state.zones.discardPile).toContain('c0');
  });

  it('3人局: P2出杀P3无杀 → P3扣血', async () => {
    const c2: Card = { id: 'c2', name: '杀', suit: '♠', rank: '3', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['c2'], p3: true, extraCards: { c2 } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);
    // 先有无懈可击询问 → pass
    const slot0 = [...harness.state.pendingSlots.values()][0];
    if (slot0 && (slot0.atom as { type: string }).type === '请求回应') {
      await P2.pass();
    }
    // P2 先被询问
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 'c2' });
    // P3 被询问
    const slot1 = [...harness.state.pendingSlots.values()][0];
    if (slot1 && (slot1.atom as { type: string }).type === '请求回应') {
      await P2.pass();
    }
    P3.expectPending('询问杀');
    await P3.pass();

    expect(harness.state.players[1].health).toBe(4); // P2 出杀不扣血
    expect(harness.state.players[2].health).toBe(3); // P3 无杀扣血
  });

  it('validate: 非自己回合拒绝', async () => {
    await harness.setup(build());
    const P2 = harness.player('P2');
    // P2 不是当前玩家
    await P2.expectRejected({ skillId: '南蛮入侵', actionType: 'use', params: { cardId: 'nm1', targets: [] } });
  });

  it('validate: pending期间拒绝', async () => {
    await harness.setup(build());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    await P1.useCardAndTarget('南蛮入侵', 'nm1', []);
    // pending 期间 P1 再用
    await P1.expectRejected({ skillId: '南蛮入侵', actionType: 'use', params: { cardId: 'nm1', targets: [] } });
  });
});
