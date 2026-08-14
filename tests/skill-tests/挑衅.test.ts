// 挑衅(姜维)行为测试:
//   1. 目标出杀 → 姜维不出闪 → 受 1 点伤害
//   2. 目标不出杀 → 姜维弃其一张牌
//   3. 目标有杀但不出 → 姜维弃其一张牌(同 2)
//   4. 每回合限一次:第二次发动被拒绝
//   5. validate:不能选自己
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
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
    const jwShan = mkCard('s0', '闪', '♥', '4');
    await harness.setup(
      build({ p0Hand: [jwShan.id], p1Hand: [kill.id], extraCards: { k1: kill, s0: jwShan } }),
    );
    const P0 = harness.player('姜维');
    const P1 = harness.player('P1');

    // 姜维发动挑衅,指定 P1(两人局距离 1,P1 能用杀攻击到姜维)
    await P0.triggerAction('挑衅', 'use', { target: 1 });
    // P1 被请求对姜维出杀
    P1.expectPending('请求回应');
    await P1.respond('挑衅', { cardId: 'k1', target: 0 });
    // 杀结算:姜维被询问闪 → 不出闪
    P0.expectPending('询问闪');
    await P0.pass();

    expect(harness.state.players[0].health).toBe(3);
    // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── 火杀响应挑衅 → 姜维(藤甲)受 2 点火焰伤害(damageType 不丢失) ────
  //    回归:修复前 use execute 手写杀结算(runDamageFlow 未传 damageType),
  //    火杀属性丢失,藤甲按普通伤害 -1 → 0 伤害。修复后走 useCard(none)
  //    → runUseFlow → 杀.resolveSlash 读 cardMap.damageType 传导。
  it('目标用火杀响应挑衅 → 姜维(藤甲)受 2 点火焰伤害', async () => {
    const fireSlash = { ...mkCard('k1', '杀', '♥', '5'), damageType: '火焰' as const };
    // 姜维非闪填充牌(使询问闪可观察,空手会 skip)
    const jwFiller = mkCard('jf', '杀', '♠', '2');
    const armor = mkCard('ar1', '藤甲', '♠', '2', '装备牌');
    const state = build({
      p0Hand: [jwFiller.id],
      p1Hand: [fireSlash.id],
      extraCards: { k1: fireSlash, jf: jwFiller, ar1: armor },
    });
    // 姜维装备藤甲 + 注册藤甲技能(火焰伤害 +1,普通伤害 -1)
    state.players[0].skills = ['挑衅', '藤甲'];
    state.players[0].equipment = { 防具: 'ar1' };
    await harness.setup(state);
    const P0 = harness.player('姜维');
    const P1 = harness.player('P1');

    const before = harness.state.players[0].health;

    await P0.triggerAction('挑衅', 'use', { target: 1 });
    // P1 用火杀响应(目标固定=姜维=0),经 挑衅/出杀 respond
    P1.expectPending('请求回应');
    await P1.respond('挑衅', { cardId: 'k1', target: 0 });
    // 姜维被询问闪 → 不闪
    P0.expectPending('询问闪');
    await P0.pass();

    // 藤甲对火焰伤害 +1 → 姜维受 2 点火焰伤害(修复前 damageType 丢失 → 藤甲按普通伤害 -1 → 0 伤害)
    expect(harness.state.players[0].health).toBe(before - 2);
    // 火杀进弃牌堆
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
    await P1.respond('挑衅', { cardId: 'k1', target: 0 });
    await P0.pass(); // 不出闪

    // 再次发动 → 被拒绝
    await P0.expectRejected({
      skillId: '挑衅',
      actionType: 'use',
      params: { target: 1 },
    });
  });

  it('validate:非出牌阶段不能发动', async () => {
    const state = build();
    state.phase = '弃牌';
    await harness.setup(state);
    const P0 = harness.player('姜维');
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
