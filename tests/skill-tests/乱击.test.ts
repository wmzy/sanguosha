// 乱击(袁绍·群雄·转化技)测试:
//   transform:把两张同花色手牌当【万箭齐发】(影子卡),配合 preceding + 万箭齐发.use。
//
// 模型:preceding=[乱击.transform cardIds=[id1,id2]] + 主 action=万箭齐发.use
//   (万箭齐发 cardId = `${id1}#${id2}#乱击`,影子卡)
//
// 验证:
//   1. 正面:两张同花色(♥♥)手牌 transformThenUse 万箭齐发 → 创建影子万箭齐发 → P2 扣血
//   2. 正面:两张同花色(♠♠)→ 同样成功(不限花色)
//   3. 多张转化花色/颜色规则:同色对(♥♥)→ 影子 color=红, suit=空
//   4. 负面:两张异花色(♠+♥)→ 拒绝(不同花色)
//   5. 负面:1 张牌 → 拒绝
//   6. 负面:同一张牌 → 拒绝
//   7. 负面:非自己回合 → 拒绝
//   8. rollback:万箭齐发.use 失败(非法 cardId)→ 两张原卡还原,影子卡删除
//   9. availableActions:乱击 transform 声明,prompt 卡过滤 min/max=2
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['杀', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function buildState(opts?: {
  p1Hand?: string[];
  p2Hand?: string[];
  extraCards?: Record<string, Card>;
  current?: number;
}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        hand: opts?.p1Hand ?? [],
        skills: ['乱击', '万箭齐发', '闪'],
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        hand: opts?.p2Hand ?? [],
        skills: ['闪'],
      }),
    ],
    cardMap: { ...(opts?.extraCards ?? {}) },
    currentPlayerIndex: opts?.current ?? 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('乱击', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:两张♥同花色当万箭齐发 → P2 扣血 ──────────────────

  it('transformThenUse:两张♥当万箭齐发 → 创建影子万箭齐发 → P2 不闪扣血', async () => {
    const c1 = makeCard('c1', '闪', '♥', '2');
    const c2 = makeCard('c2', '桃', '♥', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 转化:两张♥当万箭齐发。影子 id = c1#c2#乱击
    await P1.transformThenUse('乱击', { cardIds: ['c1', 'c2'] }, '万箭齐发', {
      cardId: 'c1#c2#乱击',
    });

    // 影子卡已建立
    expect(harness.state.cardMap['c1#c2#乱击']).toBeDefined();
    expect(harness.state.cardMap['c1#c2#乱击'].name).toBe('万箭齐发');
    // 两张原卡从手牌移除(已被 transform 合并成影子卡)
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c2');

    // 无懈可击广播窗口:P2 pass(不抵消)
    const slot0 = [...harness.state.pendingSlots.values()][0];
    if (slot0 && (slot0.atom as { type: string }).type === '请求回应') {
      await P2.pass();
    }
    // P2 被询问闪
    P2.expectPending('询问闪');
    await P2.pass(); // P2 不闪 → 扣血

    expect(harness.state.players[1].health).toBe(3);
    // 影子万箭齐发最终进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1#c2#乱击');
    // view 级断言
    P2.processEvents();
    P2.expectView((v) => {
      expect(v.players[1].health).toBe(3);
      expect(v.pending).toBeNull();
    });
  });

  // ─── 2. 正面:两张♠同花色当万箭齐发(不限花色)──────────────────

  it('transformThenUse:两张♠当万箭齐发 → P2 扣血', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '闪', '♠', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse('乱击', { cardIds: ['c1', 'c2'] }, '万箭齐发', {
      cardId: 'c1#c2#乱击',
    });

    const slot0 = [...harness.state.pendingSlots.values()][0];
    if (slot0 && (slot0.atom as { type: string }).type === '请求回应') {
      await P2.pass();
    }
    P2.expectPending('询问闪');
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 3. 多张转化花色/颜色规则 ───────────────────────────────

  it('transformThenUse:两张同色(♥♥)→ 影子卡 color=红, suit=空, shadowOf=空', async () => {
    const c1 = makeCard('c1', '闪', '♥', '2');
    const c2 = makeCard('c2', '桃', '♥', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.transformThenUse('乱击', { cardIds: ['c1', 'c2'] }, '万箭齐发', {
      cardId: 'c1#c2#乱击',
    });

    const shadow = harness.state.cardMap['c1#c2#乱击'];
    // 多张转化:花色清空,颜色取同色(红),shadowOf 空(无一一对应原卡)
    expect(shadow.suit).toBe('');
    expect(shadow.color).toBe('红');
    expect(shadow.shadowOf).toBeUndefined();
  });

  // ─── 4. 负面:两张异花色 → 拒绝 ─────────────────────────────

  it('transform:两张异花色(♠+♥)→ 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '桃', '♥', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '乱击',
      actionType: 'transform',
      params: { cardIds: ['c1', 'c2'] },
    });
  });

  // ─── 5. 负面:1 张牌 → 拒绝 ────────────────────────────────

  it('transform:1 张牌 → 拒绝(需要 2 张)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const state = buildState({
      p1Hand: ['c1'],
      extraCards: { c1 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '乱击',
      actionType: 'transform',
      params: { cardIds: ['c1'] },
    });
  });

  // ─── 6. 负面:同一张牌 → 拒绝 ──────────────────────────────

  it('transform:同一张牌 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const state = buildState({
      p1Hand: ['c1'],
      extraCards: { c1 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '乱击',
      actionType: 'transform',
      params: { cardIds: ['c1', 'c1'] },
    });
  });

  // ─── 7. 负面:非自己回合 → 拒绝 ────────────────────────────

  it('transform:非自己回合 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '闪', '♠', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
      current: 1, // P2 回合
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '乱击',
      actionType: 'transform',
      params: { cardIds: ['c1', 'c2'] },
    });
  });

  // ─── 8. rollback:万箭齐发.use 失败 → 两张原卡还原,影子卡删除 ──

  it('transform rollback:万箭齐发.use 失败(非法 cardId)→ 两张原卡还原,影子删除', async () => {
    const c1 = makeCard('c1', '闪', '♥', '2');
    const c2 = makeCard('c2', '桃', '♥', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // preceding transform 执行成功(创建影子),但主 action 万箭齐发.use 用了非法 cardId →
    // validateUseCard 拒绝 → rollback 乱击 transform
    await P1.expectRejected({
      skillId: '万箭齐发',
      actionType: 'use',
      params: { cardId: 'wrong-id' },
      preceding: [{ skillId: '乱击', actionType: 'transform', params: { cardIds: ['c1', 'c2'] } }],
    });

    // 状态应当完全还原:c1/c2 在手牌,影子卡不应存在
    expect(harness.state.cardMap['c1#c2#乱击']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(harness.state.players[0].hand).toHaveLength(2);
  });

  // ─── 9. availableActions:乱击 transform 声明,卡过滤 min/max=2 ──

  it('availableActions:乱击 transform 声明,prompt 卡过滤 min=2 max=2', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '闪', '♠', '3');
    const c3 = makeCard('c3', '桃', '♥', 'A');
    const state = buildState({
      p1Hand: ['c1', 'c2', 'c3'],
      extraCards: { c1, c2, c3 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const actions = P1.availableActions();
    const luange = actions.find((a) => a.skillId === '乱击' && a.actionType === 'transform');
    expect(luange).toBeDefined();
    expect(luange!.label).toBe('乱击');
    expect(luange!.prompt.type).toBe('useCard');

    const cardFilter =
      luange!.prompt.type === 'useCard' ? luange!.prompt.cardFilter : null;
    expect(cardFilter).toBeDefined();
    expect(cardFilter!.min).toBe(2);
    expect(cardFilter!.max).toBe(2);
  });
});
