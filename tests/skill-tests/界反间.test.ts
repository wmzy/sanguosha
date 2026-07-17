// 界反间(界周瑜·吴·主动技)测试
//   出牌阶段限一次,你可以展示并交给一名其他角色一张手牌,
//   其选择一项:1.展示所有手牌,弃置与此牌相同花色的牌;2.失去1点体力。
//
// 官方来源:三国杀 OL 界限突破 hero/308。
//
// 界版变化(相对旧错误实现):
//   - 周瑜自选一张手牌明给(非随机暗给)。
//   - 目标二选一(弃同色 / 失体力),非猜花色。
//   - 选项2 是「失去1点体力」(体力流失,无伤害来源),非「造成伤害」。
//
// 验证:
//   1. 选项2(失体力):周瑜明给♥牌 → P2选失体力 → P2得牌 + 失1点体力(无伤害来源)
//   2. 选项1(弃同色):周瑜明给♥牌 → P2选弃同色 → P2弃置所有♥手牌(含刚收到的牌)
//   3. 明给特定牌(非随机):周瑜多张手牌中选♠,验证转移的就是♠
//   4. 每回合限一次:第二次被拒
//   5. 不能对自己使用
//   6. 无手牌不能发动
//   7. 目标选非法 choice(非布尔)被拒
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

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
    character: '界周瑜',
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
        skills: ['界反间', '杀'],
      }),
      makePlayer({ index: 1, name: 'P2', hand: opts.p2Hand ?? [], skills: ['闪'] }),
    ],
    cardMap: opts.cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界反间', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 选项2(失体力):明给牌 → 目标失1点体力(无伤害来源)─────────
  it('P1 界反间 P2 → P2 选失去体力 → P2 获得周瑜手牌 + 失1点体力', async () => {
    // 周瑜仅一张手牌(♥),明选它交给 P2
    const heart = makeCard('h1', '桃', '♥', '5');
    const state = buildState({ p1Hand: ['h1'], cards: { h1: heart } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('界反间', 'h1', [1]);

    // P2 被询问二选一(反间/choice)
    P2.expectPending('请求回应');
    // P2 选「失去1点体力」(choice=false)
    await P2.respond('界反间', { choice: false });

    // P2 失去 1 点体力(体力流失,非伤害)
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 周瑜的 ♥ 桃 转移到 P2 手牌(明给,无论选哪项牌都转移)
    expect(harness.state.players[0].hand).not.toContain('h1');
    expect(harness.state.players[1].hand).toContain('h1');
    // 限一次标记已设
    expect(harness.state.players[0].vars['反间/usedThisTurn']).toBe(true);
  });

  // ─── 2. 选项1(弃同色):明给牌 → 目标弃置所有同色手牌(含刚收到的)─────
  it('P1 界反间 P2 → P2 选弃同色 → P2 弃置所有♥手牌(含刚收到的♥牌)', async () => {
    // 周瑜一张♥,P2 原有 ♥+♠ 各一张
    const heart = makeCard('h1', '桃', '♥', '5');
    const p2Heart = makeCard('h2', '闪', '♥', '7');
    const p2Spade = makeCard('s1', '杀', '♠', '3');
    const state = buildState({
      p1Hand: ['h1'],
      p2Hand: ['h2', 's1'],
      cards: { h1: heart, h2: p2Heart, s1: p2Spade },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('界反间', 'h1', [1]);
    P2.expectPending('请求回应');
    // P2 选「展示并弃置同色牌」(choice=true)
    await P2.respond('界反间', { choice: true });

    // P2 不失体力(选了弃牌项)
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
    // P2 弃置所有♥牌:刚收到的 h1 + 原有的 h2;♠ 的 s1 保留
    expect(harness.state.players[1].hand).toEqual(['s1']);
    expect(harness.state.players[1].hand).not.toContain('h1');
    expect(harness.state.players[1].hand).not.toContain('h2');
    // 弃牌堆含两张♥
    expect(harness.state.zones.discardPile).toContain('h1');
    expect(harness.state.zones.discardPile).toContain('h2');
  });

  // ─── 3. 明给特定牌(非随机):多张手牌中选♠,转移的就是♠ ─────────
  it('明给特定牌:周瑜多张手牌中选♠,转移的就是♠(非随机)', async () => {
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

    // 周瑜明选 ♠(s1)交给 P2
    await P1.useCardAndTarget('界反间', 's1', [1]);
    P2.expectPending('请求回应');
    // P2 选失体力
    await P2.respond('界反间', { choice: false });

    // 转移的就是 s1(♠),不是随机
    expect(harness.state.players[1].hand).toContain('s1');
    expect(harness.state.players[1].hand).not.toContain('h1');
    expect(harness.state.players[1].hand).not.toContain('c1');
    // 周瑜剩余 h1,c1
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['h1', 'c1']));
    expect(harness.state.players[0].hand).not.toContain('s1');
  });

  // ─── 4. 每回合限一次:第二次被拒 ───────────────────────
  it('每回合限一次:第二次界反间被拒', async () => {
    const heart = makeCard('h1', '桃', '♥', '5');
    const spade = makeCard('s1', '杀', '♠', '7');
    const state = buildState({ p1Hand: ['h1', 's1'], cards: { h1: heart, s1: spade } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('界反间', 'h1', [1]);
    P2.expectPending('请求回应');
    await P2.respond('界反间', { choice: false });

    // 第二次界反间应被 validate 拒绝(本回合已使用)
    await P1.expectRejected({
      skillId: '界反间',
      actionType: 'use',
      params: { cardId: 's1', targets: [1] },
    });
  });

  // ─── 5. 不能对自己使用 ───────────────────────────────
  it('不能对自己使用界反间', async () => {
    const heart = makeCard('h1', '桃', '♥', '5');
    const state = buildState({ p1Hand: ['h1'], cards: { h1: heart } });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界反间',
      actionType: 'use',
      params: { cardId: 'h1', targets: [0] },
    });
    // 限一次标记不应设置(未真正发动)
    expect(harness.state.players[0].vars['反间/usedThisTurn']).toBeUndefined();
  });

  // ─── 6. 无手牌不能发动 ───────────────────────────────
  it('无手牌不能发动界反间', async () => {
    const state = buildState({ p1Hand: [], cards: {} });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界反间',
      actionType: 'use',
      params: { cardId: 'nope', targets: [1] },
    });
  });

  // ─── 7. 目标选非法 choice(非布尔)被拒 ─────────────────
  it('目标选非法 choice(非布尔)被拒,pending 仍在', async () => {
    const heart = makeCard('h1', '桃', '♥', '5');
    const state = buildState({ p1Hand: ['h1'], cards: { h1: heart } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('界反间', 'h1', [1]);
    P2.expectPending('请求回应');
    // 非法 choice(字符串,非布尔)应被 respond validate 拒绝(pending 仍在)
    await P2.expectRejected({
      skillId: '界反间',
      actionType: 'respond',
      params: { choice: 'yes' },
    });
    P2.expectPending('请求回应');

    // 用合法 choice 继续(选失体力)
    await P2.respond('界反间', { choice: false });
    expect(harness.state.players[1].health).toBe(2);
  });
});
