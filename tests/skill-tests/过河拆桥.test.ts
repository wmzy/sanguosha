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
    judgeZone: [],
  };
}

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌'): Card {
  return { id, name, suit, rank, type };
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
      makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? ['gq1'], skills: opts?.p1Skills ?? ['过河拆桥', '杀'] }),
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
  // 1. 正面效果:拆目标手牌
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P2 出过河拆桥 → P2 失去第一张手牌,锦囊进弃牌堆', async () => {
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

    // P2 的第一张手牌(v1)被弃
    expect(harness.state.players[1].hand).not.toContain('v1');
    expect(harness.state.zones.discardPile).toContain('v1');
    // 过河拆桥本身进弃牌堆
    expect(harness.state.zones.discardPile).toContain('gq1');
    expect(harness.state.zones.processing).not.toContain('gq1');
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

    // 武器被卸下(不再装备)
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    // 武器进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wp1');
    expect(harness.state.zones.discardPile).toContain('gq1');
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 距离无限制:隔座使用仍可生效
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P3(隔一存活角色)出过河拆桥 → 距离无限制,正常生效', async () => {
    // 加 P3 让距离 = 2(顺时针跳过 P2 到 P3)
    const base = buildState({ p2Hand: ['v1'] });
    base.players.push(
      makePlayer({ index: 2, name: 'P3', hand: ['v1'], skills: [] }),
    );
    base.cardMap['v1'] = makeCard('v1', '杀', '♥', '5', '基本牌');
    await harness.setup(base);
    const P1 = harness.player('P1');

    // 距离 > 1 但过河拆桥无距离限制
    await P1.useCardAndTarget('过河拆桥', 'gq1', [2]);
    await P1.pass();

    // P3 失去 v1
    expect(harness.state.players[2].hand).not.toContain('v1');
    expect(harness.state.zones.discardPile).toContain('v1');
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
  // 9. Bug2:拆判定区(延时锦囊)
  // ─────────────────────────────────────────────────────────────
  it('Bug2:P2 判定区有乐不思蜀 → 过河拆桥可拆判定区,pendingTricks 清空', async () => {
    // 乐不思蜀 卡牌(判定区卡)
    const lb = makeCard('lb1', '乐不思蜀', '♠', '7');
    // 手动构造 state:P2 判定区有乐不思蜀(PendingTrick 结构)
    const state = buildState({ p2Hand: [], extraCards: { lb1: lb } });
    state.players[1].pendingTricks = [
      { name: '乐不思蜀', source: 0, card: lb },
    ];
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();

    // 判定区被拆空
    expect(harness.state.players[1].pendingTricks).toEqual([]);
    // 过河拆桥进弃牌堆
    expect(harness.state.zones.discardPile).toContain('gq1');
  });

  // ─────────────────────────────────────────────────────────────
  // 10. Bug2:validate 接受纯判定区目标(手牌装备均无)
  // ─────────────────────────────────────────────────────────────
  it('Bug2:P2 只有判定区无手牌无装备 → 过河拆桥 validate 放行', async () => {
    const lb = makeCard('lb1', '乐不思蜀', '♠', '7');
    const state = buildState({ p2Hand: [], extraCards: { lb1: lb } });
    state.players[1].pendingTricks = [
      { name: '乐不思蜀', source: 0, card: lb },
    ];
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 以前会被拒(只有判定区),现在放行
    await P1.useCardAndTarget('过河拆桥', 'gq1', [1]);
    await P1.pass();
    expect(harness.state.zones.discardPile).toContain('gq1');
  });
});
