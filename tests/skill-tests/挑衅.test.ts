// 挑衅(姜维)行为测试:
//   1. 目标出杀 → 姜维不出闪 → 受 1 点伤害
//   2. 目标不出杀 → 姜维弃其一张牌
//   3. 目标有杀但不出 → 姜维弃其一张牌(同 2)
//   4. 每回合限一次:第二次发动被拒绝
//   5. validate:不能选自己
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
        name: '姜维',
        character: '姜维',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: opts?.p0Hand ?? [],
        equipment: {},
        skills: ['挑衅'],
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
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('挑衅', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('目标出杀 + 姜维不出闪 → 姜维受 1 点伤害', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    await harness.setup(build({ p1Hand: [kill.id], extraCards: { k1: kill } }));
    const P0 = harness.player('姜维');
    const P1 = harness.player('P1');

    // 姜维发动挑衅,指定 P1(两人局距离 1,P1 能用杀攻击到姜维)
    await P0.triggerAction('挑衅', 'use', { target: 1 });
    // P1 被请求对姜维出杀
    P1.expectPending('请求回应');
    await P1.respond('杀', { cardId: 'k1' });
    // 杀结算:姜维被询问闪 → 不出闪
    P0.expectPending('询问闪');
    await P0.pass();

    expect(harness.state.players[0].health).toBe(3);
    // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  it('目标无杀不出 → 姜维弃其一张牌', async () => {
    const shan = mkCard('s1', '闪', '♥', '5');
    await harness.setup(build({ p1Hand: [shan.id], extraCards: { s1: shan } }));
    const P0 = harness.player('姜维');
    const P1 = harness.player('P1');

    await P0.triggerAction('挑衅', 'use', { target: 1 });
    // P1 被请求出杀,但无杀 → pass(超时)
    P1.expectPending('请求回应');
    await P1.pass();
    // 姜维选弃 P1 的牌(手牌盲选 handIndex 0)
    P0.expectPending('请求回应');
    await P0.respond('挑衅', { zone: 'hand', handIndex: 0 });

    // P1 的闪被弃置
    expect(harness.state.players[1].hand).not.toContain('s1');
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.discardPile).toContain('s1');
    // 姜维未受伤
    expect(harness.state.players[0].health).toBe(4);
  });

  it('目标有杀但选择不出 → 姜维弃其一张牌', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    const shan = mkCard('s1', '闪', '♥', '5');
    await harness.setup(build({ p1Hand: [kill.id, shan.id], extraCards: { k1: kill, s1: shan } }));
    const P0 = harness.player('姜维');
    const P1 = harness.player('P1');

    await P0.triggerAction('挑衅', 'use', { target: 1 });
    P1.expectPending('请求回应');
    await P1.pass(); // 有杀但不出
    P0.expectPending('请求回应');
    await P0.respond('挑衅', { zone: 'hand', handIndex: 0 });

    // P1 手牌减少 1(被弃一张);未受伤
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[0].health).toBe(4);
  });

  it('每回合限一次:第二次发动被拒绝', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    await harness.setup(build({ p1Hand: [kill.id], extraCards: { k1: kill } }));
    const P0 = harness.player('姜维');
    const P1 = harness.player('P1');

    await P0.triggerAction('挑衅', 'use', { target: 1 });
    await P1.respond('杀', { cardId: 'k1' });
    await P0.pass(); // 不出闪

    // 再次发动 → 被拒绝
    await P0.expectRejected({
      skillId: '挑衅',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  it('validate:不能选择自己为目标', async () => {
    await harness.setup(build());
    const P0 = harness.player('姜维');
    await P0.expectRejected({
      skillId: '挑衅',
      actionType: 'use',
      params: { target: 0 },
    });
  });
});
