// 看破(卧龙诸葛·转化技)测试:
//   transform:把一张黑色手牌当【无懈可击】(影子卡),配合 preceding + 无懈可击.respond。
//
// 验证:
//   1. 正面:P1 出无中生有 → 无懈窗口 → P2 看破(黑牌当无懈)→ 抵消,P1 不摸牌
//   2. 正面:验证影子卡 cardMap['c1#看破'].name==='无懈可击'
//   3. 负面:红牌 transform 被拒(不是黑色)
//   4. 负面:无无懈窗口时 transform 被拒
//   5. rollback:transform + 无懈可击.respond 失败(无窗口)→ 原卡还原
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
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '卧龙诸葛',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['看破'],
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
        skills: opts?.p1Skills ?? ['无中生有', '无懈可击'],
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        hand: opts?.p2Hand ?? [],
        skills: opts?.p2Skills ?? ['看破', '无懈可击'],
      }),
    ],
    cardMap: { ...(opts?.extraCards ?? {}) },
    currentPlayerIndex: opts?.current ?? 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('看破', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:P2 看破抵消 P1 的无中生有 ──────────────────────────
  it('P1 出无中生有 → 无懈窗口 → P2 看破(黑牌当无懈)→ 抵消,P1 不摸牌', async () => {
    const wzsy = makeCard('wz', '无中生有', '♥', '2', '锦囊牌');
    const black = makeCard('c1', '杀', '♠', '5'); // P2 转化为无懈的黑牌
    const state = buildState({
      p1Hand: ['wz'],
      p2Hand: ['c1'],
      extraCards: { wz: wzsy, c1: black },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p1HandBefore = harness.state.players[0].hand.length;

    // P1 出无中生有 → 移到处理区 → 开无懈窗口
    await P1.useCard('无中生有', 'wz');
    // 无懈可击广播窗口
    P1.expectPending('请求回应');

    // P2 用看破:黑牌 c1 → 影子无懈 → 无懈可击.respond
    await P2.transformThenRespond('看破', { cardId: 'c1' }, '无懈可击', {
      cardId: 'c1#看破',
    });

    // 影子无懈可击已建立
    expect(harness.state.cardMap['c1#看破']).toBeDefined();
    expect(harness.state.cardMap['c1#看破'].name).toBe('无懈可击');
    expect(harness.state.cardMap['c1#看破'].shadowOf).toBe('c1');

    // 无抵消后 开第二个无懈窗口(反无懈)→ pass(无人反无懈)
    P1.expectPending('请求回应');
    await P1.pass();

    // 无中生有被抵消 → P1 不摸牌(手牌数不变,无中生有牌已进弃牌堆)
    // 无懈窗口结束后无中生有结算跳过摸牌。等待稳定。
    await harness.waitForStable();
    expect(harness.state.players[0].hand.length).toBe(p1HandBefore - 1); // 用掉无中生有
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['wz', 'c1']));
    // 关键:未发生摸牌(被抵消)。检查 atom 历史无 摸牌 atom。
    const drawEvents = harness.state.atomHistory.filter(
      (e) => e.kind === 'atom' && (e.atom as { type?: string }).type === '摸牌',
    );
    expect(drawEvents.length).toBe(0);
  });

  // ─── 2. 正面:♦红牌外的♣黑牌也可转化 ────────────────────────────
  it('transformThenRespond:♣黑牌当无懈 → 影子卡 name=无懈可击', async () => {
    const wzsy = makeCard('wz', '无中生有', '♥', '3', '锦囊牌');
    const club = makeCard('c2', '杀', '♣', '8');
    const state = buildState({
      p1Hand: ['wz'],
      p2Hand: ['c2'],
      extraCards: { wz: wzsy, c2: club },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCard('无中生有', 'wz');
    P1.expectPending('请求回应');
    await P2.transformThenRespond('看破', { cardId: 'c2' }, '无懈可击', { cardId: 'c2#看破' });

    expect(harness.state.cardMap['c2#看破'].name).toBe('无懈可击');
    // pass 反无懈窗口 → 无中生有被抵消
    await P1.pass();
    await harness.waitForStable();
    const drawEvents = harness.state.atomHistory.filter(
      (e) => e.kind === 'atom' && (e.atom as { type?: string }).type === '摸牌',
    );
    expect(drawEvents.length).toBe(0);
  });

  // ─── 3. 负面:红牌 transform 被拒 ────────────────────────────────
  it('transform:红♥牌 → 拒绝(不是黑色)', async () => {
    const wzsy = makeCard('wz', '无中生有', '♥', '2', '锦囊牌');
    const red = makeCard('r1', '桃', '♥', '5');
    const state = buildState({
      p1Hand: ['wz'],
      p2Hand: ['r1'],
      extraCards: { wz: wzsy, r1: red },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCard('无中生有', 'wz');
    P1.expectPending('请求回应');
    // 看破 transform 红牌 → 拒绝
    await P2.expectRejected({
      skillId: '看破',
      actionType: 'transform',
      params: { cardId: 'r1' },
    });
  });

  // ─── 4. 负面:无无懈窗口时 transform 被拒 ────────────────────────
  it('transform:无无懈窗口(出牌阶段空闲)→ 拒绝', async () => {
    const black = makeCard('c1', '杀', '♠', '5');
    const state = buildState({
      p2Hand: ['c1'],
      extraCards: { c1: black },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');
    // 出牌阶段空闲,无无懈窗口 → 看破 transform 拒绝
    await P2.expectRejected({
      skillId: '看破',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });
  });

  // ─── 5. rollback:transform + 无懈可击.respond 失败 → 原卡还原 ────
  it('transform rollback:无无懈窗口时 transform+respond → 主 respond 失败 → 原卡还原', async () => {
    const black = makeCard('c1', '杀', '♠', '5');
    const state = buildState({
      p2Hand: ['c1'],
      extraCards: { c1: black },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    // 无无懈窗口:无懈可击.respond validate 失败 → rollback 看破 transform
    await P2.expectRejected({
      skillId: '无懈可击',
      actionType: 'respond',
      params: {
        cardId: 'c1#看破',
        preceding: [{ skillId: '看破', actionType: 'transform', params: { cardId: 'c1' } }],
      },
    });

    // 原卡还原,无影子
    expect(harness.state.cardMap['c1'].name).toBe('杀');
    expect(harness.state.cardMap['c1#看破']).toBeUndefined();
    expect(harness.state.players[1].hand).toEqual(['c1']);
  });
});
