// tests/skill-tests/过河拆桥.test.ts
// 过河拆桥(普通锦囊):出牌阶段对 1 名其他角色使用(无距离限制),
// 弃置该角色区域内(手牌/装备区/判定区)的 1 张牌。
//
// 覆盖:
//   1. 拆目标手牌:目标失去第一张手牌,过河拆桥进弃牌堆
//   2. 拆目标装备:目标无手牌时拆除装备
//   3. 距离无限制:与目标距离很大时仍可使用
//   4. validate 拒绝(negative):非自己回合 / pending 期间 / 牌不在手 / 目标是自己 / 目标无牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState, TurnPhase } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  alive?: boolean;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['过河拆桥', '杀'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function buildState(opts?: {
  p1Hand?: string[];
  p2Hand?: string[];
  p2Equipment?: Record<string, string>;
  p1Skills?: string[];
  p2Skills?: string[];
  extraCards?: Record<string, Card>;
  phase?: TurnPhase;
  currentPlayer?: number;
}): GameState {
  const gq = makeCard('gq1', '过河拆桥', '♠', '3');
  const cards: Record<string, Card> = { gq1: gq, ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        hand: opts?.p1Hand ?? ['gq1'],
        skills: opts?.p1Skills ?? ['过河拆桥', '杀'],
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        hand: opts?.p2Hand ?? [],
        equipment: opts?.p2Equipment ?? {},
        skills: opts?.p2Skills ?? ['杀'],
      }),
    ],
    cardMap: cards,
    currentPlayerIndex: opts?.currentPlayer ?? 0,
    phase: opts?.phase ?? '出牌',
    turn: { round: 1, phase: opts?.phase ?? '出牌', vars: {} },
  });
}

describe('过河拆桥', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 正面效果:拆目标手牌(盲选第 0 张)
  // ────────────────────────────────────────────────────────────
  it('P1 对 P2 出过河拆桥 → P2 失去被盲选的手牌,锦囊进弃牌堆', async () => {
    const victimCard = makeCard('v1', '杀', '♥', '5', '基本牌');
    const state = buildState({
      p2Hand: ['v1', 'v2'],
      extraCards: { v1: victimCard, v2: makeCard('v2', '闪', '♦', '6', '基本牌') },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    // 无懈窗口 → 无人打无懈 → 继续
    await P1.pass();
    // 盲选窗口:P1 选择第 0 张(对应 P2 hand[0]=v1)
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 0 });

    // P2 被盲选的手牌(v1)被弃
    expect(harness.state.players[1].hand).not.toContain('v1');
    expect(harness.state.zones.discardPile).toContain('v1');
    // 过河拆桥本身进弃牌堆
    expect(harness.state.zones.discardPile).toContain('gq1');
    expect(harness.state.zones.processing).not.toContain('gq1');
    // view 级断言:P1 视角 P2 失去手牌 + 无 pending
    P1.processEvents();
    P1.expectView((v) => {
      expect(v.players[1].handCount).toBe(1);
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 正面效果:拆目标装备(目标无手牌时)
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P2 出过河拆桥 → P2 无手牌时拆除装备区武器', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♠', '1', '装备牌');
    const state = buildState({
      p2Hand: [],
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    // 选牌面板:P1 选装备(zone=equipment)
    await P1.respond('过河拆桥', { zone: 'equipment', cardId: 'wp1' });

    // 武器被卸下(不再装备)
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    // 武器进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wp1');
    expect(harness.state.zones.discardPile).toContain('gq1');
    // view 级断言:P1 视角 P2 装备区空 + 无 pending
    P1.processEvents();
    P1.expectView((v) => {
      expect(v.zones!.discardPileCount).toBeGreaterThan(0);
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 距离无限制:隔座使用仍可生效
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P3(隔一存活角色)出过河拆桥 → 距离无限制,正常生效', async () => {
    // 加 P3 让距离 = 2(顺时针跳过存活的 P2 到 P3);P2 仅需存活充当隔座,无需手牌
    const base = buildState({ p2Hand: [] });
    base.players.push(makePlayer({ index: 2, name: 'P3', hand: ['v1'], skills: [] }));
    base.cardMap['v1'] = makeCard('v1', '杀', '♥', '5', '基本牌');
    await harness.setup(base);
    const P1 = harness.player('P1');

    // 距离 > 1 但过河拆桥无距离限制
    await P1.useCardAndTarget('过河拆桥', 'gq1', [2]);
    await P1.pass();
    // 盲选窗口:P1 选择第 0 张
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 0 });

    // P3 失去 v1
    expect(harness.state.players[2].hand).not.toContain('v1');
    expect(harness.state.zones.discardPile).toContain('v1');
    // view 级断言:P1 视角 P3 失去手牌
    P1.processEvents();
    P1.expectView((v) => {
      expect(v.players[2].handCount).toBe(0);
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:非自己回合
  // ─────────────────────────────────────────────────────────────
  it('非自己回合出过河拆桥 → 被 validate 拒绝(state.seq 不变)', async () => {
    await harness.setup(buildState({ p2Hand: ['v1'] }));
    const P2 = harness.player('P2'); // P2 不是当前玩家
    await P2.expectRejected({
      skillId: '过河拆桥',
      actionType: 'use',
      params: { cardId: 'gq1', targets: [0] },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:pending 期间
  // ─────────────────────────────────────────────────────────────
  it('pending 期间出过河拆桥 → 被拒绝(防死锁)', async () => {
    // 用出杀建 pending:P1 出杀 P2 询问闪
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p1Hand: ['gq1', 's1'],
      p2Hand: [],
      p2Skills: ['闪'],
      extraCards: { s1: slash },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.useCardAndTarget('杀', 's1', [1]);
    // 此时有 pending(P2 询问闪),P1 再出过河拆桥应被拒
    await P1.expectRejected({
      skillId: '过河拆桥',
      actionType: 'use',
      params: { cardId: 'gq1', targets: [1] },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. validate 拒绝:牌不在手牌
  // ─────────────────────────────────────────────────────────────
  it('出不在手牌的过河拆桥 → 被拒绝', async () => {
    // 给 P1 一张杀(不是过河拆桥),试图用过河拆桥的 cardId 出
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p1Hand: ['s1'],
      p2Hand: ['v1'],
      extraCards: { s1: slash, v1: makeCard('v1', '杀', '♥', '5', '基本牌') },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    // gq1 不在 P1 手牌中
    await P1.expectRejected({
      skillId: '过河拆桥',
      actionType: 'use',
      params: { cardId: 'gq1', targets: [1] },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. validate 拒绝:目标是自己
  // ─────────────────────────────────────────────────────────────
  it('对自己出过河拆桥 → 被拒绝(notSelf)', async () => {
    await harness.setup(buildState({ p2Hand: ['v1'] }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '过河拆桥',
      actionType: 'use',
      params: { cardId: 'gq1', targets: [0] },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 8. validate 拒绝:目标无手牌无装备
  // ─────────────────────────────────────────────────────────────
  it('目标无手牌无装备 → 被拒绝(targetHasCards=false)', async () => {
    await harness.setup(buildState({ p2Hand: [] }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '过河拆桥',
      actionType: 'use',
      params: { cardId: 'gq1', targets: [1] },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 10. Bug6 回归:选牌窗口必须"等待玩家",不能在玩家选之前自动弃牌
  //    根因排查(timeout/defaultChoice/前端 三方向)结论见下方各断言。
  //    ① timeout 不过短——选牌窗口 timeout=20s(与五谷丰登一致,正常询问,非 silent)
  //    ② defaultChoice 仅为超时兜底——不设 responseMode='silent',不 preResolve 跳过
  //    ③ 前端会渲染——使用者视角 view.pending 是 pickTargetCard 且含装备/手牌数据
  // ─────────────────────────────────────────────────────────────
  it('Bug6:出过河拆桥+过无懈后,引擎进入"选牌等待",不自动弃牌(使用者视角可见选牌面板)', async () => {
    // P2 同时有手牌 + 装备(触发"明牌优先"的默认兜底分支,验证它不会提前生效)
    const state = buildState({
      p2Hand: ['v1', 'v2'],
      p2Equipment: { 武器: 'wp1' },
      extraCards: {
        v1: makeCard('v1', '杀', '♥', '5', '基本牌'),
        v2: makeCard('v2', '闪', '♦', '6', '基本牌'),
        wp1: makeCard('wp1', '诸葛连弩', '♠', '1', '装备牌'),
      },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass(); // 无懈窗口(无人打无懈)

    // ① 引擎必须"等待玩家":有 请求回应 过河拆桥_选牌 pending(目标=使用者 P1),
    //    且此时**没有任何牌被弃置**(未自动选牌)
    const slots = [...harness.state.pendingSlots.values()];
    expect(slots.length).toBe(1);
    const pickAtom = slots[0].atom as { type: string; requestType?: string; target?: number };
    expect(pickAtom.type).toBe('请求回应');
    expect(pickAtom.requestType).toBe('过河拆桥_选牌');
    expect(pickAtom.target).toBe(0); // 选牌窗口目标是使用者 P1(座次 0)
    expect(harness.state.zones.discardPile).not.toContain('v1');
    expect(harness.state.zones.discardPile).not.toContain('v2');
    expect(harness.state.zones.discardPile).not.toContain('wp1');

    // ②③ 使用者视角 view.pending 是 pickTargetCard:含装备明牌 + 手牌盲选,且非 silent
    //    → 前端 AwaitingPrompt 会渲染选牌面板(不会"无面板 → 超时自动弃牌")
    P1.processEvents();
    P1.expectView((v) => {
      expect(v.pending).not.toBeNull();
      expect(v.pending!.target).toBe(0);
      const prompt = v.pending!.prompt as {
        type: string;
        equipment?: Array<{ cardId: string }>;
        handCount?: number;
      };
      expect(prompt.type).toBe('pickTargetCard');
      expect(prompt.equipment).toHaveLength(1);
      expect(prompt.equipment![0].cardId).toBe('wp1');
      expect(prompt.handCount).toBe(2);
      expect(v.pending!.responseMode).not.toBe('silent');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 11. Bug6 回归:玩家选"非默认"牌(手牌盲选)时,弃置的是玩家所选牌,而非兜底的装备
  // ─────────────────────────────────────────────────────────────
  it('Bug6:目标有手牌+装备时,玩家盲选第 2 张手牌 → 弃置该手牌(而非兜底装备 wp1)', async () => {
    const state = buildState({
      p2Hand: ['v1', 'v2'],
      p2Equipment: { 武器: 'wp1' },
      extraCards: {
        v1: makeCard('v1', '杀', '♥', '5', '基本牌'),
        v2: makeCard('v2', '闪', '♦', '6', '基本牌'),
        wp1: makeCard('wp1', '诸葛连弩', '♠', '1', '装备牌'),
      },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    // 玩家主动盲选第 2 张手牌(v2)——默认兜底是装备 wp1,验证玩家选择优先
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 1 });

    // 弃置的是玩家所选的 v2,而非兜底的 wp1
    expect(harness.state.zones.discardPile).toContain('v2');
    expect(harness.state.zones.discardPile).not.toContain('wp1');
    expect(harness.state.players[1].hand).not.toContain('v2');
    expect(harness.state.players[1].equipment['武器']).toBe('wp1');
  });

  // ─────────────────────────────────────────────────────────────
  // 12. Bug6 回归:超时兜底(玩家真不选)保留——明牌优先(装备→判定→手牌[0])
  //     这是"玩家真不选时自动选"的预期兜底,与"不等玩家就自动选"的 bug 区分
  // ─────────────────────────────────────────────────────────────
  it('Bug6:玩家真不选(超时)→ 兜底弃置装备 wp1(明牌优先),过河拆桥进弃牌堆', async () => {
    const state = buildState({
      p2Hand: ['v1', 'v2'],
      p2Equipment: { 武器: 'wp1' },
      extraCards: {
        v1: makeCard('v1', '杀', '♥', '5', '基本牌'),
        v2: makeCard('v2', '闪', '♦', '6', '基本牌'),
        wp1: makeCard('wp1', '诸葛连弩', '♠', '1', '装备牌'),
      },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass(); // 无邪
    await P1.pass(); // 选牌窗口:玩家不选 → 超时兜底

    // 兜底弃置装备 wp1(明牌优先),手牌保留
    expect(harness.state.zones.discardPile).toContain('wp1');
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('gq1');
  });

  // ─────────────────────────────────────────────────────────────
  // 9. Bug2:拆判定区(延时锦囊)
  // ─────────────────────────────────────────────────────────────
  it('Bug2:P2 仅判定区有乐不思蜀 → validate 放行,选牌面板选判定区后 pendingTricks 清空', async () => {
    // 乐不思蜀 卡牌(判定区卡)
    const lb = makeCard('lb1', '乐不思蜀', '♠', '7');
    // 手动构造 state:P2 判定区有乐不思蜀(PendingTrick 结构)
    const state = buildState({ p2Hand: [], extraCards: { lb1: lb } });
    state.players[1].pendingTricks = [{ name: '乐不思蜀', source: 0, card: lb }];
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 出牌(不指定具体卡)→ 无懈 → 选牌面板选判定区
    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    await P1.respond('过河拆桥', { zone: 'judge', cardId: 'lb1' });

    // 判定区被拆空
    expect(harness.state.players[1].pendingTricks).toEqual([]);
    // 过河拆桥进弃牌堆
    expect(harness.state.zones.discardPile).toContain('gq1');
  });

  // ─────────────────────────────────────────────────────────────
  // Bug2 续:目标判定区+手牌+装备三区都有 → 使用者选判定区后仅判定区清空,手牌/装备保留
  // ─────────────────────────────────────────────────────────────
  it('Bug2:目标三区(判定区+手牌+装备)都有 → 选判定区后判定区清空,手牌/装备保留', async () => {
    const lb = makeCard('lb1', '乐不思蜀', '♠', '7');
    const victim = makeCard('v1', '杀', '♥', '5', '基本牌');
    const weapon = makeCard('wp1', '诸葛连弩', '♣', 'A', '装备牌');
    const state = buildState({
      p2Hand: ['v1'],
      p2Equipment: { 武器: 'wp1' },
      extraCards: { lb1: lb, v1: victim, wp1: weapon },
    });
    state.players[1].pendingTricks = [{ name: '乐不思蜀', source: 0, card: lb }];
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    // 选牌面板选判定区
    await P1.respond('过河拆桥', { zone: 'judge', cardId: 'lb1' });

    // 判定区清空,手牌与装备保留
    expect(harness.state.players[1].pendingTricks).toEqual([]);
    expect(harness.state.players[1].hand).toContain('v1');
    expect(harness.state.players[1].equipment['武器']).toBe('wp1');
  });

  // ─────────────────────────────────────────────────────────────
  // Bug2 续:同一目标先用过河拆桥拆判定区,再用一张拆手牌(可重拆同一目标)
  // ─────────────────────────────────────────────────────────────
  it('Bug2:同一目标先用过河拆桥拆判定区,再用一张拆手牌', async () => {
    const gq2 = makeCard('gq2', '过河拆桥', '♠', '4');
    const lb = makeCard('lb1', '乐不思蜀', '♠', '7');
    const victim = makeCard('v1', '杀', '♥', '5', '基本牌');
    const state = buildState({
      p1Hand: ['gq1', 'gq2'],
      p2Hand: ['v1'],
      extraCards: { gq2, lb1: lb, v1: victim },
    });
    state.players[1].pendingTricks = [{ name: '乐不思蜀', source: 0, card: lb }];
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次拆判定区
    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    await P1.respond('过河拆桥', { zone: 'judge', cardId: 'lb1' });
    expect(harness.state.players[1].pendingTricks).toEqual([]);
    expect(harness.state.players[1].hand).toContain('v1');

    // 第二次拆手牌(盲选第 0 张)
    await P1.useCardAndTarget('过河拆桥', 'gq2', [1]);
    await P1.pass();
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 0 });
    expect(harness.state.players[1].hand).not.toContain('v1');
    expect(harness.state.zones.discardPile).toContain('v1');
  });

  // ─────────────────────────────────────────────────────────────
  // Bug2 续:判定区有多个延时锦囊 → 一次过河拆桥只拆使用者选的那一张
  // ─────────────────────────────────────────────────────────────
  it('Bug2:判定区有多个延时锦囊 → 一次过河拆桥只拆使用者选的那一张', async () => {
    const lb = makeCard('lb1', '乐不思蜀', '♠', '7');
    const sd = makeCard('sd1', '闪电', '♥', 'A');
    const state = buildState({ p2Hand: [], extraCards: { lb1: lb, sd1: sd } });
    state.players[1].pendingTricks = [
      { name: '乐不思蜀', source: 0, card: lb },
      { name: '闪电', source: 0, card: sd },
    ];
    await harness.setup(state);
    const P1 = harness.player('P1');

    expect(harness.state.players[1].pendingTricks).toHaveLength(2);

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    // 使用者选第一张(乐不思蜀)
    await P1.respond('过河拆桥', { zone: 'judge', cardId: 'lb1' });

    // 只拆一张,剩下闪电
    expect(harness.state.players[1].pendingTricks).toHaveLength(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('闪电');
  });
});
