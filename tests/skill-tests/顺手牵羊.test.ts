// tests/skill-tests/顺手牵羊.test.ts
// 顺手牵羊(普通锦囊):出牌阶段对距离 1 内其他角色使用,获得其一张手牌。
// (本测试覆盖手牌;装备获得路径同源,未单独测。)
//
// 覆盖:
//   1. 拿目标手牌:目标失去第一张手牌,发起者手牌 +1,锦囊进弃牌堆
//   2. 距离 <= 1 校验:距离 > 1 时被 validate 拒绝
//   3. validate 拒绝(negative):非自己回合 / pending 期间 / 目标无手牌 / 牌不在手 / 目标是自己
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  alive?: boolean;
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['顺手牵羊', '杀'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makeBasicCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function buildState(opts?: {
  p1Hand?: string[];
  p2Hand?: string[];
  playerCount?: number;
  p1Skills?: string[];
  p2Skills?: string[];
  extraCards?: Record<string, Card>;
}): GameState {
  const sq = makeCard('sq1', '顺手牵羊', '♠', '4');
  const cards: Record<string, Card> = { sq1: sq, ...(opts?.extraCards ?? {}) };
  const n = opts?.playerCount ?? 2;
  const players = [
    makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? ['sq1'], skills: opts?.p1Skills ?? ['顺手牵羊', '杀'] }),
    makePlayer({ index: 1, name: 'P2', hand: opts?.p2Hand ?? [], skills: opts?.p2Skills ?? ['杀'] }),
  ];
  for (let i = 2; i < n; i++) {
    players.push(makePlayer({ index: i, name: `P${i + 1}`, skills: [] }));
  }
  return createGameState({
    players,
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('顺手牵羊', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 正面效果:拿目标手牌
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P2(距离 1)出顺手牵羊 → 拿到 P2 第一张手牌', async () => {
    const victimCard = makeCard('v1', '杀', '♥', '5', '基本牌');
    const state = buildState({
      p2Hand: ['v1', 'v2'],
      extraCards: { v1: victimCard, v2: makeCard('v2', '闪', '♦', '6', '基本牌') },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    // P1 起手手牌 = 1 (sq1),用出后从 P2 拿到 v1,手牌数仍为 1

    // 顺手牵羊 的 validate 使用 params.target(单数),不是 targets
    await P1.triggerAction('顺手牵羊', 'use', { cardId: 'sq1', target: 1 });
    await P1.pass(); // 消耗无懈窗口
    // 盲选窗口:P1 选择第 0 张(对应 P2 hand[0]=v1)
    await P1.respond('顺手牵羊', { zone: 'hand', handIndex: 0 });

    // P2 失去 v1
    expect(harness.state.players[1].hand).not.toContain('v1');
    // P1 拿到 v1
    expect(harness.state.players[0].hand).toContain('v1');
    expect(harness.state.players[0].hand.length).toBe(1);
    // 锦囊进弃牌堆
    expect(harness.state.zones.discardPile).toContain('sq1');
    expect(harness.state.zones.processing).not.toContain('sq1');
    // view 级断言:P1 视角手牌 + 无 pending
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].hand!.map(c => c.id)).toContain('v1');
      expect(v.players[0].handCount).toBe(1);
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. validate 拒绝:距离 > 1
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P3(距离 2)出顺手牵羊 → 被拒绝(距离 > 1)', async () => {
    // 3 个存活玩家,P1 (idx 0) → P3 (idx 2):座位距离 = 2
    await harness.setup(buildState({ playerCount: 4 }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 2 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. validate 拒绝:非自己回合
  // ─────────────────────────────────────────────────────────────
  it('非自己回合出顺手牵羊 → 被拒绝', async () => {
    await harness.setup(buildState({ p2Hand: ['v1'] }));
    const P2 = harness.player('P2');
    await P2.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 0 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:pending 期间
  // ─────────────────────────────────────────────────────────────
  it('pending 期间出顺手牵羊 → 被拒绝(防死锁)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p1Hand: ['sq1', 's1'],
      p2Hand: [],
      p2Skills: ['闪'],
      extraCards: { s1: slash },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.useCardAndTarget('杀', 's1', [1]);
    // pending 期间再出顺手牵羊应被拒
    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:目标无手牌
  // ─────────────────────────────────────────────────────────────
  it('目标无手牌 → 被拒绝(targetHasHand=false)', async () => {
    await harness.setup(buildState({ p2Hand: [] }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. validate 拒绝:牌名不是顺手牵羊
  // ─────────────────────────────────────────────────────────────
  it('用错的牌名(杀)出顺手牵羊 → 被拒绝(cardNameOk=false)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p1Hand: ['s1'],
      p2Hand: ['v1'],
      extraCards: { s1: slash, v1: makeCard('v1', '杀', '♥', '5', '基本牌') },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 's1', target: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. validate 拒绝:目标是自己
  // ─────────────────────────────────────────────────────────────
  it('对自己出顺手牵羊 → 被拒绝(notSelf)', async () => {
    await harness.setup(buildState({ p2Hand: ['v1'] }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 0 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 8. Bug3:顺手牵羊可拿装备区
  // ─────────────────────────────────────────────────────────────
  it('Bug3:P2 无手牌只有装备(诸葛连弩) → 顺手牵羊拿到装备,装备区被卸载', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♠', '1', '装备牌');
    const state = buildState({
      p2Hand: [],
      extraCards: { wp1: weapon },
    });
    // P2 装备区有武器(诸葛连弩)
    state.players[1].equipment = { 武器: 'wp1' };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('顺手牵羊', 'use', { cardId: 'sq1', target: 1 });
    await P1.pass(); // 跳过无懈窗口
    // 选牌面板选装备
    await P1.respond('顺手牵羊', { zone: 'equipment', cardId: 'wp1' });

    // P1 拿到诸葛连弩
    expect(harness.state.players[0].hand).toContain('wp1');
    // P2 装备区被卸载
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    // 锦囊进弃牌堆
    expect(harness.state.zones.discardPile).toContain('sq1');
    // view 级断言:P1 视角装备到手
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].hand!.map(c => c.id)).toContain('wp1');
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 9. Bug3:validate 接受纯装备区目标(无手牌)
  // ─────────────────────────────────────────────────────────────
  it('Bug3:P2 无手牌只有装备 → 顺手牵羊 validate 放行(以前会被拒)', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♠', '1', '装备牌');
    const state = buildState({
      p2Hand: [],
      extraCards: { wp1: weapon },
    });
    state.players[1].equipment = { 武器: 'wp1' };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('顺手牵羊', 'use', { cardId: 'sq1', target: 1 });
    await P1.pass();
    // 选牌面板选装备
    await P1.respond('顺手牵羊', { zone: 'equipment', cardId: 'wp1' });
    expect(harness.state.players[0].hand).toContain('wp1');
  });

  // ─────────────────────────────────────────────────────────────
  // 10. 顺手牵羊 端到端(获得 atom 验证)
  // ─────────────────────────────────────────────────────────────
  // 来源: tests/integration/obtain-atom.test.ts test 5
  it('顺手牵羊 端到端:P0 出锦囊 → P0 拿 P1 一张手牌 → P1.hand -1,P0 拿到该牌', async () => {
    const sq: Card = makeCard('sq1', '顺手牵羊', '♠', '4', '锦囊牌');
    const stolen: Card = makeBasicCard('st1', '桃', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [sq.id], skills: ['顺手牵羊', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [stolen.id], skills: [] }),
      ],
      cardMap: { [sq.id]: sq, [stolen.id]: stolen },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p0Before = [...harness.state.players[0].hand];
    const p1Before = [...harness.state.players[1].hand];

    // P0 对 P1 出 顺手牵羊
    await P0.triggerAction('顺手牵羊', 'use', { cardId: sq.id, target: 1 });
    // 消耗无懈窗口
    await P0.pass();
    // 盲选窗口:P0 选第 0 张
    await P0.respond('顺手牵羊', { zone: 'hand', handIndex: 0 });

    // P1 失去第一张手牌
    expect(harness.state.players[1].hand).not.toContain(p1Before[0]);
    // P1.hand -1
    expect(harness.state.players[1].hand.length).toBe(p1Before.length - 1);
    // P0 拿到 P1 那张
    expect(harness.state.players[0].hand).toEqual([p1Before[0]]);
    // 总牌数守恒(顺手牵羊 进弃牌堆)
    const totalAfter = harness.state.players[0].hand.length + harness.state.players[1].hand.length;
    expect(totalAfter).toBe(p0Before.length + p1Before.length - 1);
  });
});

// ─── 获得 atom 单元测试 ─────────────────────────────────────
// 来源: tests/integration/obtain-atom.test.ts tests 1-3
// 验证 获得 atom 从来源手牌/装备区移除并加到目标。之前 bug:atom apply 只加没移导致牌被复制。
describe('获得 atom 单元', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 单元:从手牌拿牌 ─────────────────────
  it('单元:从 P0 手牌拿一张 → P0.hand 减少,P1.hand 增加', async () => {
    const slash: Card = makeBasicCard('k1', '杀', '♠', '7');
    const dodge: Card = makeBasicCard('d1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id, dodge.id], skills: [] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
      ],
      cardMap: { [slash.id]: slash, [dodge.id]: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P1 拿 P0 的杀
    await applyAtom(harness.state, { type: '获得', player: 1, cardId: slash.id, from: 0 });

    expect(harness.state.players[0].hand).toEqual([dodge.id]); // P0 剩闪
    expect(harness.state.players[1].hand).toEqual([slash.id]); // P1 拿到杀
    expect(harness.state.players[0].hand).not.toContain(slash.id);
    expect(harness.state.players[1].hand).not.toContain(dodge.id);
  });

  // ─── 2. 单元:从装备区拿牌 ────────────────────
  it('单元:从 P0 装备区拿一张 → P0.equipment 该槽清空,P1.hand 增加', async () => {
    const weapon: Card = makeBasicCard('w1', '诸葛连弩', '♣', '1', '装备牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', equipment: { 武器: weapon.id }, skills: [] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
      ],
      cardMap: { [weapon.id]: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await applyAtom(harness.state, { type: '获得', player: 1, cardId: weapon.id, from: 0 });

    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.players[1].hand).toEqual([weapon.id]);
  });

  // ─── 3. 单元:from 缺省(只加不移) ─────────────
  it('单元:from 缺省 → 目标 +1,无来源变化(摸牌/给予类场景)', async () => {
    const slash: Card = makeBasicCard('k1', '杀', '♠', '7');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id], skills: [] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: [] }),
      ],
      cardMap: { [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 模拟 摸牌:不传 from
    await applyAtom(harness.state, { type: '获得', player: 1, cardId: slash.id });

    expect(harness.state.players[1].hand).toContain(slash.id);
  });
});
