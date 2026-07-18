// 反间(周瑜·主动技)测试
//   出牌阶段，令一名其他角色猜一种花色，获得你的一张手牌并展示，
//   若此牌与所选花色不同，该角色受到1点伤害。
//
// 验证:
//   1. 猜错 → 目标获得周瑜手牌 + 受1点伤害
//   2. 猜对 → 目标获得周瑜手牌,不受伤害
//   3. 每回合限一次:第二次使用被拒
//   4. 不能对自己使用
//   5. 无手牌不能发动
//   6. 目标选非法花色被拒
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '周瑜',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
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

function buildState(opts: { p1Hand: string[]; p2Hand?: string[]; cards: Record<string, Card> }) {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        hand: opts.p1Hand,
        skills: ['反间', '杀'],
      }),
      makePlayer({ index: 1, name: 'P2', hand: opts.p2Hand ?? [], skills: ['闪'] }),
    ],
    cardMap: opts.cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('反间', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 猜错 → 目标获得周瑜手牌 + 受1点伤害 ─────────────
  it('P1 反间 P2 → P2 猜错花色 → P2 获得周瑜手牌 + 受1点伤害', async () => {
    // 周瑜仅一张手牌(♥),随机必选它
    const heart = makeCard('h1', '桃', '♥', '5');
    const state = buildState({ p1Hand: ['h1'], cards: { h1: heart } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.triggerAction('反间', 'use', { targets: [1] });

    // P2 被询问选花色(反间/选花色)
    P2.expectPending('请求回应');
    // P2 猜 ♠(与周瑜的 ♥ 不同)
    await P2.respond('反间', { suit: '♠' });

    // P2 受 1 点伤害
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 周瑜的 ♥ 桃 转移到 P2 手牌
    expect(harness.state.players[0].hand).not.toContain('h1');
    expect(harness.state.players[1].hand).toContain('h1');
    // 限一次标记已设
    expect(harness.state.players[0].vars['反间/usedThisTurn']).toBe(true);
  });

  // ─── 2. 猜对 → 目标获得周瑜手牌,不受伤害 ──────────────
  it('P1 反间 P2 → P2 猜对花色 → P2 获得周瑜手牌,不受伤害', async () => {
    const heart = makeCard('h1', '桃', '♥', '5');
    const state = buildState({ p1Hand: ['h1'], cards: { h1: heart } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.triggerAction('反间', 'use', { targets: [1] });
    P2.expectPending('请求回应');
    // P2 猜 ♥(与周瑜的 ♥ 相同)
    await P2.respond('反间', { suit: '♥' });

    // P2 不受伤害
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
    // 牌仍转移(获得并展示,无论猜对猜错)
    expect(harness.state.players[0].hand).not.toContain('h1');
    expect(harness.state.players[1].hand).toContain('h1');
  });

  // ─── 3. 每回合限一次:第二次被拒 ───────────────────────
  it('每回合限一次:第二次反间被拒', async () => {
    const heart = makeCard('h1', '桃', '♥', '5');
    const spade = makeCard('s1', '杀', '♠', '7');
    // 两张手牌以便第二次也能选目标
    const state = buildState({ p1Hand: ['h1', 's1'], cards: { h1: heart, s1: spade } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.triggerAction('反间', 'use', { targets: [1] });
    P2.expectPending('请求回应');
    await P2.respond('反间', { suit: '♥' });

    // 第二次反间应被 validate 拒绝(本回合已使用)
    await P1.triggerAction('反间', 'use', { targets: [1] });
    // 不会产生选花色 pending(被拒)
    P2.expectNoPending();
  });

  // ─── 4. 不能对自己使用 ───────────────────────────────
  it('不能对自己使用反间', async () => {
    const heart = makeCard('h1', '桃', '♥', '5');
    const state = buildState({ p1Hand: ['h1'], cards: { h1: heart } });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('反间', 'use', { targets: [0] });
    // 对自己使用被拒,无 pending
    P1.expectNoPending();
    // 限一次标记不应设置(未真正发动)
    expect(harness.state.players[0].vars['反间/usedThisTurn']).toBeUndefined();
  });

  // ─── 5. 无手牌不能发动 ───────────────────────────────
  it('无手牌不能发动反间', async () => {
    const state = buildState({ p1Hand: [], cards: {} });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.triggerAction('反间', 'use', { targets: [1] });
    // 无手牌被拒,无 pending
    P2.expectNoPending();
  });

  // ─── 6. 目标选非法花色被拒 ───────────────────────────
  it('目标选非法花色被拒', async () => {
    const heart = makeCard('h1', '桃', '♥', '5');
    const state = buildState({ p1Hand: ['h1'], cards: { h1: heart } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.triggerAction('反间', 'use', { targets: [1] });
    P2.expectPending('请求回应');
    // 非法花色应被 respond validate 拒绝(pending 仍在)
    await P2.respond('反间', { suit: 'X' });
    P2.expectPending('请求回应');

    // 用合法花色继续
    await P2.respond('反间', { suit: '♠' });
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
  });

  // ─── 7. 多张手牌:随机转移一张,目标手牌+1,来源-1 ──────
  it('多张手牌:随机转移一张牌(来源-1,目标+1)', async () => {
    const heart = makeCard('h1', '桃', '♥', '5');
    const spade = makeCard('s1', '杀', '♠', '7');
    const club = makeCard('c1', '酒', '♣', '3');
    const state = buildState({
      p1Hand: ['h1', 's1', 'c1'],
      cards: { h1: heart, s1: spade, c1: club },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p1Before = harness.state.players[0].hand.length;
    const p2Before = harness.state.players[1].hand.length;

    await P1.triggerAction('反间', 'use', { targets: [1] });
    P2.expectPending('请求回应');
    await P2.respond('反间', { suit: '♦' }); // ♦ 肯定猜错(无♦牌)

    // 转移一张
    expect(harness.state.players[0].hand.length).toBe(p1Before - 1);
    expect(harness.state.players[1].hand.length).toBe(p2Before + 1);
    // P2 受伤
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 8. 伤害来源是周瑜(官方:"你对其造成1点伤害") ─────────
  it('猜错造成的伤害来源是周瑜(用于反馈/狂骨等受到伤害时技能)', async () => {
    const heart = makeCard('h1', '桃', '♥', '5');
    const state = buildState({ p1Hand: ['h1'], cards: { h1: heart } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.triggerAction('反间', 'use', { targets: [1] });
    P2.expectPending('请求回应');
    await P2.respond('反间', { suit: '♠' }); // 猜错

    // 从 atomHistory 找出造成伤害 atom,验证 source = 周瑜(0)
    const damageEntries = harness.state.atomHistory.filter(
      (e) => e.kind === 'atom' && (e.atom as { type: string }).type === '造成伤害',
    );
    expect(damageEntries.length).toBe(1);
    const damageAtom = (damageEntries[0] as {
      atom: { type: string; target: number; source: number; amount: number };
    }).atom;
    expect(damageAtom.source).toBe(0); // 周瑜(座次 0)是伤害来源
    expect(damageAtom.target).toBe(1);
    expect(damageAtom.amount).toBe(1);
  });

  // ─── 9. 顺序:目标先选花色,后获得牌(官方:"...选择花色,令其获得...") ──
  it('执行顺序:目标选花色 → 周瑜随机一张手牌转移 → 比对伤害', async () => {
    const heart = makeCard('h1', '桃', '♥', '5');
    const state = buildState({ p1Hand: ['h1'], cards: { h1: heart } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.triggerAction('反间', 'use', { targets: [1] });
    P2.expectPending('请求回应');

    // 选花色之前,周瑜的牌未转移
    expect(harness.state.players[0].hand).toContain('h1');
    expect(harness.state.players[1].hand).not.toContain('h1');

    await P2.respond('反间', { suit: '♠' });

    // 选花色后,牌才转移
    expect(harness.state.players[0].hand).not.toContain('h1');
    expect(harness.state.players[1].hand).toContain('h1');
    expect(harness.state.players[1].health).toBe(2);
  });
});
