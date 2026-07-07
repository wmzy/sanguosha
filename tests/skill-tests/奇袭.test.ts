// tests/skill-tests/奇袭.test.ts
// 奇袭(甘宁·转化技)测试:
//   transform:把一张黑色牌(手牌或装备区)当【过河拆桥】(影子卡)。
//   配合 preceding + 过河拆桥.use 完整流程:transformThenUse API。
//
// 验证:
//   1. 正面:黑色手牌(♠) transformThenUse 过河拆桥 → 创建影子,P2 被弃 1 张,原牌进弃牌堆
//   2. 正面:梅花(♣)黑色牌同样可转化
//   3. 正面:装备区的黑色装备牌 → 卸下后转化,装备槽清空,原牌进弃牌堆
//   4. 影子卡 shadowOf 指向原卡
//   5. 负面:红牌(♥/♦) transform 被拒(不是黑色)
//   6. 负面:非自己回合 transform 被拒
//   7. 负面:不在手牌也不在装备区的卡 transform 被拒
//   8. rollback:transform + 过河拆桥.use 失败(目标无牌)→ 原卡还原,影子删除
//   9. availableActions:奇袭 声明 transform action,cardFilter 仅黑色牌
//   10. 无懈可击抵消:奇袭转化的过河拆桥可被无懈可击抵消(不弃目标牌)
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
  character?: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '甘宁',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['奇袭', '过河拆桥'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

describe('奇袭', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:黑色手牌 transform + 过河拆桥 ─────────────────────

  it('transformThenUse:黑桃牌当过河拆桥 → 创建影子 + P2 被弃牌 + 原牌进弃牌堆', async () => {
    const black = makeCard('c1', '杀', '♠', 'A'); // 黑桃黑牌
    const victim = makeCard('v1', '闪', '♥', '5', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['奇袭', '过河拆桥'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['v1'], skills: [] }),
      ],
      cardMap: { c1: black, v1: victim },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.transformThenUse('奇袭', { cardId: 'c1' }, '过河拆桥', {
      cardId: 'c1#奇袭',
      targets: [1],
    });

    // 影子过河拆桥已建立
    expect(harness.state.cardMap['c1#奇袭']).toBeDefined();
    expect(harness.state.cardMap['c1#奇袭'].name).toBe('过河拆桥');
    expect(harness.state.cardMap['c1#奇袭'].shadowOf).toBe('c1');

    // 无懈窗口 → 无人打无懈 → 继续
    await P1.pass();
    // 选牌窗口:P1 盲选 P2 hand[0] = v1
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 0 });

    // P2 的 v1 被弃
    expect(harness.state.players[1].hand).not.toContain('v1');
    expect(harness.state.zones.discardPile).toContain('v1');
    // 原黑牌(影子入弃牌堆时按 shadowOf 还原)进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    // view 级:P2 失去 1 张手牌,无残留 pending
    P1.processEvents();
    P1.expectView((v) => {
      expect(v.players[1].handCount).toBe(0);
      expect(v.pending).toBeNull();
    });
  });

  it('transformThenUse:梅花(♣)黑色牌当过河拆桥 → 同样成功', async () => {
    const club = makeCard('c2', '杀', '♣', '8'); // 梅花黑牌
    const victim = makeCard('v1', '闪', '♥', '5', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c2'], skills: ['奇袭', '过河拆桥'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['v1'], skills: [] }),
      ],
      cardMap: { c2: club, v1: victim },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.transformThenUse('奇袭', { cardId: 'c2' }, '过河拆桥', {
      cardId: 'c2#奇袭',
      targets: [1],
    });

    // 影子建立(transform 后、流程结束前)
    expect(harness.state.cardMap['c2#奇袭'].name).toBe('过河拆桥');

    await P1.pass();
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 0 });

    expect(harness.state.players[1].hand).not.toContain('v1');
    expect(harness.state.zones.discardPile).toContain('c2');
  });

  // ─── 正面:装备区的黑色装备牌 ─────────────────────────────

  it('transformThenUse:装备区黑色武器当过河拆桥 → 装备卸下转化,槽位清空,原牌进弃牌堆', async () => {
    // 黑色武器(装备区),subtype=武器,range 仅占位
    const weapon: Card = {
      id: 'e1',
      name: '寒冰剑',
      suit: '♠',
      color: '黑',
      rank: 'A',
      type: '装备牌',
      subtype: '武器',
      range: 2,
    };
    const victim = makeCard('v1', '闪', '♥', '5', '基本牌');
    const state: GameState = createGameState({
      players: [
        // P1 起手无手牌,仅装备区一张黑色武器
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [],
          equipment: { 武器: 'e1' },
          skills: ['奇袭', '过河拆桥'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['v1'], skills: [] }),
      ],
      cardMap: { e1: weapon, v1: victim },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.transformThenUse('奇袭', { cardId: 'e1' }, '过河拆桥', {
      cardId: 'e1#奇袭',
      targets: [1],
    });

    // 装备已被卸下(用于转化)
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.cardMap['e1#奇袭']).toBeDefined();
    expect(harness.state.cardMap['e1#奇袭'].name).toBe('过河拆桥');

    await P1.pass();
    await P1.respond('过河拆桥', { zone: 'hand', handIndex: 0 });

    // P2 被弃 1 张
    expect(harness.state.players[1].hand).not.toContain('v1');
    expect(harness.state.zones.discardPile).toContain('v1');
    // 原装备牌进弃牌堆(影子按 shadowOf 还原)
    expect(harness.state.zones.discardPile).toContain('e1');
  });

  // ─── 影子卡 shadowOf ─────────────────────────────

  it('影子卡 shadowOf 指向原卡,转化后 name=过河拆桥', async () => {
    const black = makeCard('c1', '杀', '♠', 'A');
    const victim = makeCard('v1', '闪', '♥', '5', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['奇袭', '过河拆桥'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['v1'], skills: [] }),
      ],
      cardMap: { c1: black, v1: victim },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.transformThenUse('奇袭', { cardId: 'c1' }, '过河拆桥', {
      cardId: 'c1#奇袭',
      targets: [1],
    });

    const shadow = harness.state.cardMap['c1#奇袭'];
    expect(shadow).toBeDefined();
    expect(shadow.name).toBe('过河拆桥');
    expect(shadow.shadowOf).toBe('c1');
    // 单张转化保留原花色与黑颜色
    expect(shadow.suit).toBe('♠');
    expect(shadow.color).toBe('黑');
  });

  // ─── 负面:transform ─────────────────────────────

  it('transform:红桃(♥) → 拒绝(不是黑色)', async () => {
    const red = makeCard('h1', '桃', '♥', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1'], skills: ['奇袭'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', skills: [] }),
      ],
      cardMap: { h1: red },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '奇袭',
      actionType: 'transform',
      params: { cardId: 'h1' },
    });
  });

  it('transform:方块(♦) → 拒绝(不是黑色)', async () => {
    const red = makeCard('d1', '桃', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['奇袭'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', skills: [] }),
      ],
      cardMap: { d1: red },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '奇袭',
      actionType: 'transform',
      params: { cardId: 'd1' },
    });
  });

  it('transform:非自己回合 → 拒绝', async () => {
    const black = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['奇袭'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', skills: [] }),
      ],
      cardMap: { c1: black },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '奇袭',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });
  });

  it('transform:不在手牌也不在装备区的卡 → 拒绝', async () => {
    const black = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['奇袭'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', skills: [] }),
      ],
      cardMap: { c1: black },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '奇袭',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });
  });

  // ─── rollback:preceding transform 失败回滚 ──────────────────

  it('rollback:transform 后 过河拆桥.use 失败(目标无牌)→ 原卡还原,影子删除', async () => {
    const black = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['奇袭', '过河拆桥'] }),
        // P2 无手牌无装备 → 过河拆桥.use validate 拒绝
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: [], skills: [] }),
      ],
      cardMap: { c1: black },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // preceding=[奇袭.transform] 先执行(创建影子),主 action=过河拆桥.use validate 失败
    // (目标无牌)→ rollback 奇袭.transform → 撤销影子,原卡还原
    await P1.expectRejected({
      skillId: '过河拆桥',
      actionType: 'use',
      params: { cardId: 'c1#奇袭', targets: [1] },
      preceding: [{ skillId: '奇袭', actionType: 'transform', params: { cardId: 'c1' } }],
    });

    // 状态完全还原:c1 仍是杀,影子不存在,手牌仍是 c1
    expect(harness.state.cardMap['c1'].name).toBe('杀');
    expect(harness.state.cardMap['c1#奇袭']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['c1']);
  });

  // ─── defineAction 声明验证 ─────────────────────────

  it('availableActions:奇袭 声明 transform action,prompt 卡过滤是黑色牌', async () => {
    const blackSpade = makeCard('c1', '杀', '♠', 'A');
    const blackClub = makeCard('c2', '杀', '♣', '3');
    const redHeart = makeCard('c3', '桃', '♥', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1', 'c2', 'c3'],
          skills: ['奇袭', '过河拆桥'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: ['v1'], skills: [] }),
      ],
      cardMap: {
        c1: blackSpade,
        c2: blackClub,
        c3: redHeart,
        v1: makeCard('v1', '闪', '♥', '5', '基本牌'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const actions = P1.availableActions();
    const qixi = actions.find((a) => a.skillId === '奇袭' && a.actionType === 'transform');
    expect(qixi).toBeDefined();
    expect(qixi!.label).toBe('奇袭');
    expect(qixi!.prompt.type).toBe('useCardAndTarget');

    // cardFilter 仅匹配黑色牌(c1 ♠, c2 ♣),排除红牌(c3 ♥)
    const cardFilter =
      qixi!.prompt.type === 'useCardAndTarget' ? qixi!.prompt.cardFilter.filter : null;
    expect(cardFilter).toBeDefined();
    const allowed: string[] = [];
    for (const cardId of harness.state.players[0].hand) {
      const card = harness.state.cardMap[cardId];
      if (cardFilter!(card)) allowed.push(cardId);
    }
    expect(allowed).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(allowed).not.toContain('c3');
  });

  // ─── 无懈可击抵消(描述:可以被无懈可击抵消)─────────────

  it('无懈可击:奇袭转化的过河拆桥被无懈可击抵消 → 不弃目标牌', async () => {
    const black = makeCard('c1', '杀', '♠', 'A');
    const victim = makeCard('v1', '闪', '♥', '5', '基本牌');
    const wuxie = makeCard('wx1', '无懈可击', '♠', 'J', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['奇袭', '过河拆桥'] }),
        // P2 持有无懈可击:在无懈窗口打出抵消过河拆桥
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: ['v1', 'wx1'],
          skills: ['无懈可击'],
        }),
      ],
      cardMap: { c1: black, v1: victim, wx1: wuxie },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse('奇袭', { cardId: 'c1' }, '过河拆桥', {
      cardId: 'c1#奇袭',
      targets: [1],
    });

    // 无懈可击广播窗口 → P2 打出无懈抵消
    P1.expectPending('请求回应');
    await P2.respond('无懈可击', { cardId: 'wx1' });
    // close-reopen:respond 后开启反无懈窗口 → 无人反无懈(pass 超时)
    await P1.pass();

    // 过河拆桥被抵消 → 不弃目标牌(v1 仍在 P2 手中)
    expect(harness.state.players[1].hand).toContain('v1');
    expect(harness.state.zones.discardPile).not.toContain('v1');
    // 无懈牌本身进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wx1');
    // 原黑牌(影子入弃牌堆按 shadowOf 还原)进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
