// tests/skill-tests/杀.test.ts
// 杀(基本牌)技能测试示范
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function buildState(opts?: { p2Hand?: string[]; extraCardMap?: Record<string, Card> }): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  const dodge: Card = { id: 'c3', name: '闪', suit: '♥', rank: '2', type: '基本牌' };
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['杀'] }),
      makePlayer({ index: 1, name: 'P2', hand: opts?.p2Hand ?? [], skills: ['闪'] }),
    ],
    cardMap: { c1: slash, c3: dodge, ...opts?.extraCardMap },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

function makePlayer(opts: { index: number; name: string; hand: string[]; skills: string[] }) {
  return {
    ...opts, character: '主公', health: 4, maxHealth: 4, alive: true,
    equipment: {}, vars: {}, marks: [], pendingTricks: [], judgeZone: [],
  };
}

describe('杀', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('P1 对 P2 出杀,P2 不出闪 → P2 扣 1 血', async () => {
    harness.setup(buildState());
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', ['P2']);
    await P2.pass();

    expect(P2.view.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  it('P1 对 P2 出杀,P2 出闪 → 双方不扣血,杀和闪结算完毕进入弃牌堆', async () => {
    harness.setup(buildState({ p2Hand: ['c3'] }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', ['P2']);
    // 中间状态:杀已离开 P1 手牌,正在处理区,等待 P2 出闪
    expect(harness.state.zones.processing).toContain('c1');
    expect(P1.view.players[0].hand).not.toContain('c1');

    await P2.respond('闪', { cardId: 'c3' });
    // 结算完成:杀和闪都已最终落到弃牌堆
    expect(P2.view.players[1].health).toBe(4);
    expect(harness.state.zones.discardPile).toEqual(
      expect.arrayContaining(['c1', 'c3']),
    );
    expect(harness.state.zones.processing).toEqual([]);
  });

  it('同回合不能出第二张杀', async () => {
    const c2: Card = { id: 'c2', name: '杀', suit: '♠', rank: '2', type: '基本牌' };
    harness.setup(buildState({ extraCardMap: { c2 } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'c1', ['P2']);
    await P2.pass();

    await expect(
      P1.useCardAndTarget('杀', 'c2', ['P2']),
    ).rejects.toThrow(/出杀次数已用尽/);
  });
});
