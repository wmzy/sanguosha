import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from './engine-harness';
import '../src/engine/atoms';
import '../src/engine/skills';
import type { Card, GameState } from '../src/engine/types';
import { createGameState } from '../src/engine/types';

function buildGuanShiFuState(): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  const dodge: Card = { id: 'c3', name: '闪', suit: '♥', rank: '2', type: '基本牌' };
  const weapon: Card = { id: 'w1', name: '贯石斧', suit: '♣', rank: '5', type: '装备牌', subtype: '武器', range: 3 };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true, hand: ['c1', 'h1', 'h2'], equipment: { 武器: 'w1' }, skills: ['杀', '装备通用', '贯石斧'], vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '忠臣', health: 4, maxHealth: 4, alive: true, hand: ['c3'], equipment: {}, skills: ['闪', '装备通用'], vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [] },
    ],
    cardMap: { c1: slash, c3: dodge, w1: weapon, h1: { id: 'h1', name: '桃', suit: '♥', rank: 'A', type: '基本牌' }, h2: { id: 'h2', name: '酒', suit: '♣', rank: 'A', type: '基本牌' } },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('贯石斧 probe', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  it('trace 贯石斧 fire', async () => {
    await harness.setup(buildGuanShiFuState());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // Setup says: P2 needs to dodge first
    await P1.useCardAndTarget('杀', 'c1', [1]);
    // Now 询问闪 pending for P2 (target=1)
    console.log('after useCard, pending:', harness.state.pendingSlots.size);
    let slot = [...harness.state.pendingSlots.values()][0];
    console.log('pending atom:', JSON.stringify(slot?.atom).slice(0, 200));

    await P2.respond('闪', { cardId: 'c3' });
    // After P2 responds, 询问闪 resolves → 询问闪 after hooks fire → 贯石斧 hook creates 请求回应 pending
    console.log('after P2 dodge, pending:', harness.state.pendingSlots.size);
    if (harness.state.pendingSlots.size > 0) {
      slot = [...harness.state.pendingSlots.values()][0];
      console.log('pending atom:', JSON.stringify(slot?.atom).slice(0, 300));
    }
    console.log('P2 health:', harness.state.players[1].health);
    console.log('P1 hand:', harness.state.players[0].hand);
    console.log('discard:', harness.state.zones.discardPile);
    console.log('processing:', harness.state.zones.processing);

    expect(true).toBe(true); // trace only
  });
});