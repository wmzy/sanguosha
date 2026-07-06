// 享乐(刘禅)行为测试:
//   1. 来源弃基本牌 → 杀有效 → 刘禅不出闪受伤
//   2. 来源无基本牌 → 杀对刘禅无效(不受伤)
//   3. 来源有基本牌但选择不弃 → 杀对刘禅无效
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  return { id, name, suit, color, rank, type };
}

function build(opts?: {
  p0Hand?: string[];
  p1Hand?: string[];
  extraCards?: Record<string, Card>;
}): GameState {
  const cards: Record<string, Card> = { ...opts?.extraCards };
  return createGameState({
    players: [
      {
        index: 0,
        name: '刘禅',
        character: '刘禅',
        health: 3,
        maxHealth: 3,
        alive: true,
        hand: opts?.p0Hand ?? [],
        equipment: {},
        skills: ['享乐'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
      {
        index: 1,
        name: 'P1',
        character: '反',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: opts?.p1Hand ?? [],
        equipment: {},
        skills: ['杀'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
    ],
    cardMap: cards,
    // P1 的回合,这样 P1 可以出杀
    currentPlayerIndex: 1,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('享乐', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('来源弃基本牌 → 杀有效 → 刘禅受伤', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    const shan = mkCard('s1', '闪', '♥', '5');
    await harness.setup(
      build({ p1Hand: [kill.id, shan.id], extraCards: { k1: kill, s1: shan } }),
    );
    const P0 = harness.player('刘禅');
    const P1 = harness.player('P1');

    // P1 对刘禅出杀
    await P1.useCardAndTarget('杀', 'k1', [0]);
    // 享乐:来源须额外弃一张基本牌 → P1 选弃闪
    P1.expectPending('请求回应');
    await P1.respond('享乐', { cardId: 's1' });
    // 杀有效 → 刘禅被询问闪 → 不出闪
    P0.expectPending('询问闪');
    await P0.pass();

    // 刘禅受伤(3 → 2)
    expect(harness.state.players[0].health).toBe(2);
    // 闪被弃置,杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('s1');
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  it('来源无基本牌 → 杀对刘禅无效(不受伤)', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    // P1 只有一张杀,打出后手牌空 → 无基本牌可弃
    await harness.setup(build({ p1Hand: [kill.id], extraCards: { k1: kill } }));
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    // 享乐:无基本牌 → 杀无效(自动),无 pending 给来源,刘禅不受伤害
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3);
    // 杀进弃牌堆(结算收尾)
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  it('来源有基本牌但选择不弃 → 杀对刘禅无效', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    const shan = mkCard('s1', '闪', '♥', '5');
    await harness.setup(
      build({ p1Hand: [kill.id, shan.id], extraCards: { k1: kill, s1: shan } }),
    );
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    // 享乐询问来源弃基本牌 → 来源选择不弃(pass/超时)
    P1.expectPending('请求回应');
    await P1.pass();

    // 杀无效:刘禅不受伤
    expect(harness.state.players[0].health).toBe(3);
    // 闪未被弃(仍在 P1 手牌)
    expect(harness.state.players[1].hand).toContain('s1');
  });
});
