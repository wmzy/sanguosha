// 界看破(界卧龙诸葛·转化技)测试:
//   transform:把一张黑色牌(手牌或装备区)当【无懈可击】使用。
//   respond override(覆盖无懈可击.respond):转化出的无懈不可被响应(无反无懈窗口)。
//
// 验证:
//   1. 正面:P2 出无中生有 → 无懈窗口 → P1 界看破(黑牌当无懈)→ 抵消 + 不开第二窗口(不可被响应)
//   2. 正面:♣黑牌(非黑桃)也可转化
//   3. 正面:装备区黑牌也可转化
//   4. 正面:实际无懈牌(非界看破转化)仍走标版(开第二窗口,允许反无懈)
//   5. rollback:transform + 无懈.respond 失败 → 原卡还原
//   6. 负面:红牌 transform 被拒
//   7. 负面:无无懈窗口时 transform 被拒
//   8. availableActions:界看破 transform 声明,过滤黑牌(手牌+装备)
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
  subtype?: string,
): Card {
  const c: Card = { id, name, suit, color: suitColor(suit), rank, type };
  if (subtype) c.subtype = subtype;
  return c;
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '界卧龙诸葛',
    health: 3,
    maxHealth: 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['无懈可击', '界看破'],
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
  p1Equipment?: Record<string, string>;
  p1Skills?: string[];
  p2Skills?: string[];
  extraCards?: Record<string, Card>;
  current?: number;
}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        hand: opts?.p1Hand ?? [],
        equipment: opts?.p1Equipment,
        skills: opts?.p1Skills ?? ['无懈可击', '界看破'],
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        hand: opts?.p2Hand ?? [],
        skills: opts?.p2Skills ?? ['无中生有', '无懈可击'],
      }),
    ],
    cardMap: { ...(opts?.extraCards ?? {}) },
    currentPlayerIndex: opts?.current ?? 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界看破', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:界看破抵消无中生有 + 不开反无懈窗口 ──────────────────
  it('P2 出无中生有 → 无懈窗口 → P1 界看破(黑牌当无懈)→ 抵消 + 不开第二窗口', async () => {
    const wzsy = makeCard('wz', '无中生有', '♥', '2', '锦囊牌');
    const black = makeCard('c1', '杀', '♠', '5'); // P1 转化为无懈的黑牌
    const state = buildState({
      // P2 回合出无中生有 → P1 界看破
      p1Hand: ['c1'],
      p2Hand: ['wz'],
      extraCards: { wz: wzsy, c1: black },
      current: 1, // P2 回合
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HandBefore = harness.state.players[1].hand.length;

    // P2 出无中生有 → 移到处理区 → 开无懈窗口
    await P2.useCard('无中生有', 'wz');
    // 无懈可击广播窗口
    P2.expectPending('请求回应');

    // P1 用界看破:黑牌 c1 → 影子无懈 → 无懈可击.respond
    await P1.transformThenRespond('界看破', { cardId: 'c1' }, '无懈可击', {
      cardId: 'c1#界看破',
    });

    // 影子无懈可击已建立
    expect(harness.state.cardMap['c1#界看破']).toBeDefined();
    expect(harness.state.cardMap['c1#界看破'].name).toBe('无懈可击');
    expect(harness.state.cardMap['c1#界看破'].shadowOf).toBe('c1');

    // 界看破关键特性:不设 已回应=true → 询问无懈可击 循环 break,不开反无懈窗口。
    // 直接进入无中生有被抵消结算(不摸牌)。
    await harness.waitForStable();

    // 无中生有被抵消 → P2 不摸牌
    const drawEvents = harness.state.atomHistory.filter(
      (e) => e.kind === 'atom' && (e.atom as { type?: string }).type === '摸牌',
    );
    expect(drawEvents.length).toBe(0);
    // P2 手牌减少(用了无中生有),无中生有牌进弃牌堆
    expect(harness.state.players[1].hand.length).toBe(p2HandBefore - 1);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['wz', 'c1']));
  });

  // ─── 2. 正面:♣黑牌也可转化 ──────────────────────────────────────
  it('transformThenRespond:♣黑牌当无懈 → 影子卡 name=无懈可击', async () => {
    const wzsy = makeCard('wz', '无中生有', '♥', '3', '锦囊牌');
    const club = makeCard('c2', '杀', '♣', '8');
    const state = buildState({
      p1Hand: ['c2'],
      p2Hand: ['wz'],
      extraCards: { wz: wzsy, c2: club },
      current: 1,
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCard('无中生有', 'wz');
    P2.expectPending('请求回应');
    await P1.transformThenRespond('界看破', { cardId: 'c2' }, '无懈可击', { cardId: 'c2#界看破' });

    expect(harness.state.cardMap['c2#界看破'].name).toBe('无懈可击');
    // 界看破不可响应 → 无第二窗口 → 无中生有被抵消
    await harness.waitForStable();
    const drawEvents = harness.state.atomHistory.filter(
      (e) => e.kind === 'atom' && (e.atom as { type?: string }).type === '摸牌',
    );
    expect(drawEvents.length).toBe(0);
  });

  // ─── 3. 正面:装备区黑牌也可转化 ──────────────────────────────────
  it('transformThenRespond:装备区黑装备 → 卸下 → 影子无懈', async () => {
    const wzsy = makeCard('wz', '无中生有', '♥', '4', '锦囊牌');
    const blackEquip = makeCard('e1', '绝影', '♠', '5', '装备牌', '防御马');
    const state = buildState({
      p1Equipment: { 防御马: 'e1' },
      p2Hand: ['wz'],
      extraCards: { wz: wzsy, e1: blackEquip },
      current: 1,
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCard('无中生有', 'wz');
    P2.expectPending('请求回应');
    await P1.transformThenRespond('界看破', { cardId: 'e1' }, '无懈可击', {
      cardId: 'e1#界看破',
    });

    expect(harness.state.cardMap['e1#界看破']).toBeDefined();
    expect(harness.state.cardMap['e1#界看破'].name).toBe('无懈可击');
    // 装备被卸下
    expect(harness.state.players[0].equipment['防御马']).toBeUndefined();
    await harness.waitForStable();
    const drawEvents = harness.state.atomHistory.filter(
      (e) => e.kind === 'atom' && (e.atom as { type?: string }).type === '摸牌',
    );
    expect(drawEvents.length).toBe(0);
  });

  // ─── 4. 正面:实际无懈牌仍走标版(开反无懈窗口) ──────────────────
  // 验证 respond override 不影响真实无懈牌(非界看破转化)的反无懈流程。
  it('实际无懈(非界看破转化)→ 仍开反无懈窗口(标版行为)', async () => {
    const wzsy = makeCard('wz', '无中生有', '♥', '2', '锦囊牌');
    const realWuxie = makeCard('rw', '无懈可击', '♠', 'J', '锦囊牌'); // 实际无懈牌
    const state = buildState({
      p1Hand: ['rw'],
      p2Hand: ['wz'],
      extraCards: { wz: wzsy, rw: realWuxie },
      current: 1,
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCard('无中生有', 'wz');
    P2.expectPending('请求回应');

    // P1 用实际无懈牌(非界看破转化):应走标版,设 已回应=true → 开反无懈窗口
    // 注意:回应无懈广播用 respond(不是 use)
    await P1.respond('无懈可击', { cardId: 'rw' });

    // 标版行为:开反无懈窗口
    P2.expectPending('请求回应');
    // P2 pass 反无懈 → 无中生有被抵消
    await P2.pass();
    await harness.waitForStable();
    const drawEvents = harness.state.atomHistory.filter(
      (e) => e.kind === 'atom' && (e.atom as { type?: string }).type === '摸牌',
    );
    expect(drawEvents.length).toBe(0);
  });

  // ─── 5. rollback:transform + 无懈.respond 失败 → 原卡还原 ────────
  it('transform rollback:无无懈窗口时 transform+respond → 主 respond 失败 → 原卡还原', async () => {
    const black = makeCard('c1', '杀', '♠', '5');
    const state = buildState({
      p1Hand: ['c1'],
      extraCards: { c1: black },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 无无懈窗口:无懈可击.respond validate 失败 → rollback 界看破 transform
    await P1.expectRejected({
      skillId: '无懈可击',
      actionType: 'respond',
      params: {
        cardId: 'c1#界看破',
        preceding: [{ skillId: '界看破', actionType: 'transform', params: { cardId: 'c1' } }],
      },
    });

    // 原卡还原,无影子
    expect(harness.state.cardMap['c1'].name).toBe('杀');
    expect(harness.state.cardMap['c1#界看破']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['c1']);
  });

  // ─── 6. 负面:红牌 transform 被拒 ────────────────────────────────
  it('transform:红♥牌 → 拒绝(不是黑色)', async () => {
    const wzsy = makeCard('wz', '无中生有', '♥', '2', '锦囊牌');
    const red = makeCard('r1', '桃', '♥', '5');
    const state = buildState({
      p1Hand: ['r1'],
      p2Hand: ['wz'],
      extraCards: { wz: wzsy, r1: red },
      current: 1,
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCard('无中生有', 'wz');
    P2.expectPending('请求回应');
    // 界看破 transform 红牌 → 拒绝
    await P1.expectRejected({
      skillId: '界看破',
      actionType: 'transform',
      params: { cardId: 'r1' },
    });
  });

  // ─── 7. 负面:无无懈窗口时 transform 被拒 ────────────────────────
  it('transform:无无懈窗口(出牌阶段空闲)→ 拒绝', async () => {
    const black = makeCard('c1', '杀', '♠', '5');
    const state = buildState({
      p1Hand: ['c1'],
      extraCards: { c1: black },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    // 出牌阶段空闲,无无懈窗口 → 界看破 transform 拒绝
    await P1.expectRejected({
      skillId: '界看破',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });
  });

  // ─── 8. availableActions:界看破 transform 声明,过滤黑牌 ─────────
  it('availableActions:界看破 transform 声明,prompt 卡过滤是黑牌(手牌+装备)', async () => {
    const blackSpade = makeCard('c1', '杀', '♠', 'A');
    const blackClub = makeCard('c2', '杀', '♣', '2');
    const redHeart = makeCard('c3', '桃', '♥', 'A');
    const blackEquip = makeCard('e1', '绝影', '♠', '5', '装备牌', '防御马');
    const wzsy = makeCard('wz', '无中生有', '♥', '2', '锦囊牌');
    const state = buildState({
      p1Hand: ['c1', 'c2', 'c3'],
      p1Equipment: { 防御马: 'e1' },
      p2Hand: ['wz'],
      extraCards: { c1: blackSpade, c2: blackClub, c3: redHeart, e1: blackEquip, wz: wzsy },
      current: 1, // P2 回合
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    // P2 出无中生有开无懈窗口,使界看破 transform 激活
    await P2.useCard('无中生有', 'wz');
    P2.expectPending('请求回应');

    const P1 = harness.player('P1');
    await P1.loadFrontend();
    const actions = P1.availableActions();
    const jieKanpo = actions.find((a) => a.skillId === '界看破' && a.actionType === 'transform');
    expect(jieKanpo).toBeDefined();
    expect(jieKanpo!.label).toBe('界看破');
    expect(jieKanpo!.prompt.type).toBe('useCard');

    const cardFilter =
      jieKanpo!.prompt.type === 'useCard' ? jieKanpo!.prompt.cardFilter.filter : null;
    expect(cardFilter).toBeDefined();
    // 手牌过滤:黑♠/黑♣通过,红♥拒绝
    expect(cardFilter!(blackSpade)).toBe(true);
    expect(cardFilter!(blackClub)).toBe(true);
    expect(cardFilter!(redHeart)).toBe(false);
    // 装备区黑牌也通过(界版:含装备区)
    expect(cardFilter!(blackEquip)).toBe(true);
  });
});
