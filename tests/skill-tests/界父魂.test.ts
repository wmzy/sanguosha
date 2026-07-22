// tests/skill-tests/界父魂.test.ts
// 界父魂(界关兴张苞·转化技):
//   你可将两张牌当【杀】使用或打出。
//   你使用的转化【杀】目标角色只能使用颜色相同的手牌响应;
//   你于出牌阶段使用【杀】造成伤害后,你本回合获得"武圣""咆哮"。
//
// 测试覆盖:
//   1. 转化 happy path:2 手牌当杀 → P2 扣血
//   2. 装备区牌转化:1 手牌 + 1 装备 → 杀
//   3. 双装备区牌转化:2 装备 → 杀
//   4. 颜色限制-红杀:P2 红闪可出,黑闪被拒
//   5. 颜色限制-黑杀:P2 黑闪可出,红闪被拒
//   6. 颜色限制-无色杀(异色):P2 任意闪可出
//   7. 颜色限制不污染后续询问:转化杀结算后,普通 杀 无限制
//   8. 触发 granted:出牌阶段杀造成伤害 → 获得武圣+咆哮
//   9. granted 武圣:1 红手牌 → 杀
//   10. granted 咆哮:可连续出第二张 杀
//   11. 不触发 granted:杀被闪抵消
//   12. 转化 rollback:杀.use validate 失败 → 两张原卡还原
//   13. 转化负向:1 张牌/同张牌/敌方牌 → 拒绝
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
  character?: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界关兴张苞',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界父魂', '杀'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeState(opts: {
  p1Hand?: string[];
  p1Equip?: Record<string, string>;
  p1Skills?: string[];
  p2Hand?: string[];
  p2Equip?: Record<string, string>;
  cardMap?: Record<string, Card>;
  currentPlayerIndex?: number;
}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        hand: opts.p1Hand ?? [],
        equipment: opts.p1Equip,
        skills: opts.p1Skills ?? ['界父魂', '杀'],
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        character: '曹操',
        hand: opts.p2Hand ?? [],
        equipment: opts.p2Equip,
        skills: ['闪'],
      }),
    ],
    cardMap: opts.cardMap ?? {},
    currentPlayerIndex: opts.currentPlayerIndex ?? 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界父魂', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 转化 happy path ─────────────────────────────

  it('2 张手牌当杀 → P2 不闪扣血', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2'); // 黑
    const c2 = makeCard('c2', '桃', '♣', '3'); // 黑
    const state = makeState({
      p1Hand: ['c1', 'c2'],
      cardMap: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse('界父魂', { cardIds: ['c1', 'c2'] }, '杀', {
      cardId: 'c1#c2#父魂',
      targets: [1],
    });

    // 两张原卡已合为影子(离开手牌)
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c2');
    expect(harness.state.cardMap['c1#c2#父魂']).toBeDefined();
    expect(harness.state.cardMap['c1#c2#父魂'].name).toBe('杀');

    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 2. 1 手牌 + 1 装备 → 杀 ─────────────────────────────

  it('1 手牌 + 1 装备区牌 → 转化杀,装备卸下', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2'); // 手牌
    const e1 = makeCard('e1', '闪', '♣', '3', '装备牌'); // 装备(占武器槽)
    const state = makeState({
      p1Hand: ['c1'],
      p1Equip: { 武器: 'e1' },
      cardMap: { c1, e1 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse('界父魂', { cardIds: ['c1', 'e1'] }, '杀', {
      cardId: 'c1#e1#父魂',
      targets: [1],
    });

    expect(harness.state.cardMap['c1#e1#父魂']).toBeDefined();
    // 装备槽已空(被卸下作为转化素材)
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();

    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 3. 双装备区牌 → 杀 ─────────────────────────────

  it('2 张装备区牌 → 转化杀(全装备转化)', async () => {
    const e1 = makeCard('e1', '闪', '♠', '2', '装备牌');
    const e2 = makeCard('e2', '闪', '♣', '3', '装备牌');
    const state = makeState({
      p1Equip: { 武器: 'e1', 防具: 'e2' },
      cardMap: { e1, e2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse('界父魂', { cardIds: ['e1', 'e2'] }, '杀', {
      cardId: 'e1#e2#父魂',
      targets: [1],
    });

    expect(harness.state.cardMap['e1#e2#父魂']).toBeDefined();
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.players[0].equipment['防具']).toBeUndefined();

    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 4. 颜色限制-红杀:红闪可,黑闪拒 ─────────────────────────────

  it('红杀(2 张红牌)→ P2 红闪 OK,黑闪被拒', async () => {
    const c1 = makeCard('c1', '桃', '♥', '2'); // 红
    const c2 = makeCard('c2', '桃', '♦', '3'); // 红
    const red = makeCard('r1', '闪', '♥', '4'); // 红闪
    const black = makeCard('b1', '闪', '♠', '5'); // 黑闪
    const state = makeState({
      p1Hand: ['c1', 'c2'],
      p2Hand: [red.id, black.id],
      cardMap: { c1, c2, r1: red, b1: black },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse('界父魂', { cardIds: ['c1', 'c2'] }, '杀', {
      cardId: 'c1#c2#父魂',
      targets: [1],
    });

    // 黑闪应被拒
    await P2.expectRejected({
      skillId: '闪',
      actionType: 'respond',
      params: { cardId: 'b1' },
    });

    // 红闪可通过
    await P2.respond('闪', { cardId: 'r1' });
    // 杀被抵消 → P2 不扣血
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 5. 颜色限制-黑杀:黑闪可,红闪拒 ─────────────────────────────

  it('黑杀(2 张黑牌)→ P2 黑闪 OK,红闪被拒', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    const c2 = makeCard('c2', '桃', '♣', '3');
    const red = makeCard('r1', '闪', '♥', '4');
    const black = makeCard('b1', '闪', '♣', '5');
    const state = makeState({
      p1Hand: ['c1', 'c2'],
      p2Hand: ['r1', 'b1'],
      cardMap: { c1, c2, r1: red, b1: black },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse('界父魂', { cardIds: ['c1', 'c2'] }, '杀', {
      cardId: 'c1#c2#父魂',
      targets: [1],
    });

    // 红闪应被拒
    await P2.expectRejected({
      skillId: '闪',
      actionType: 'respond',
      params: { cardId: 'r1' },
    });
    // 黑闪可通过
    await P2.respond('闪', { cardId: 'b1' });
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 6. 颜色限制-无色杀(异色):任意闪可 ─────────────────────────────

  it('无色杀(1 红 + 1 黑)→ 任意色闪可出', async () => {
    const c1 = makeCard('c1', '桃', '♥', '2'); // 红
    const c2 = makeCard('c2', '闪', '♠', '3'); // 黑
    const red = makeCard('r1', '闪', '♥', '4');
    const state = makeState({
      p1Hand: ['c1', 'c2'],
      p2Hand: ['r1'],
      cardMap: { c1, c2, r1: red },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse('界父魂', { cardIds: ['c1', 'c2'] }, '杀', {
      cardId: 'c1#c2#父魂',
      targets: [1],
    });

    // 异色 → 无色 → 无限制,红闪可出
    await P2.respond('闪', { cardId: 'r1' });
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 7. 颜色限制不污染后续询问 ───────────────────────

  it('转化杀询问闪结算后,颜色限制被清除(localVars 不残留)', async () => {
    const c1 = makeCard('c1', '桃', '♥', '2'); // 红
    const c2 = makeCard('c2', '桃', '♦', '3'); // 红 → 转化红杀
    const redDodge = makeCard('r1', '闪', '♥', '5'); // 红闪
    const state = makeState({
      p1Hand: ['c1', 'c2'],
      p2Hand: ['r1'],
      cardMap: { c1, c2, r1: redDodge },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse('界父魂', { cardIds: ['c1', 'c2'] }, '杀', {
      cardId: 'c1#c2#父魂',
      targets: [1],
    });

    // 询问闪期间:颜色限制应生效(localVars 被设置)
    expect(harness.state.localVars['闪/色限制']).toBe('红');

    // 红闪可通过
    await P2.respond('闪', { cardId: 'r1' });
    // 杀被抵消,P2 不扣血,转化杀未造成伤害 → 不触发 granted
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.turn.vars['父魂/granted']).toBeUndefined();
    // 询问闪 after-hook 应已清颜色限制(不残留到后续询问)
    expect(harness.state.localVars['闪/色限制']).toBeUndefined();
  });

  // ─── 8. 触发 granted:出牌阶段 杀造成伤害 → 获得武圣+咆哮 ─────────

  it('杀造成伤害 → turn.vars granted 标记 + view turnUsage 同步', async () => {
    const slash = makeCard('s1', '杀', '♠', '4'); // 物理杀
    const state = makeState({
      p1Hand: ['s1'],
      cardMap: { s1: slash },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.turn.vars['父魂/granted']).toBe(0);
    // view 侧同步
    P1.processEvents();
    P1.expectView((v) => {
      expect(v.players[0].turnUsage?.['父魂/granted']).toBe(true);
    });
  });

  // ─── 9. granted 武圣:1 红手牌 → 杀 ────────────────────────

  it('granted 后可用武圣转化:1 张红色手牌 → 杀', async () => {
    const slash = makeCard('s1', '杀', '♠', '4'); // 先造成伤害
    const red = makeCard('r1', '桃', '♥', '2'); // 红手牌
    const state = makeState({
      p1Hand: ['s1', 'r1'],
      cardMap: { s1: slash, r1: red },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 第一步:用物理杀造成伤害,触发 granted
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.turn.vars['父魂/granted']).toBe(0);

    // 第二步:用 granted 武圣转化红牌当杀
    // granted 武圣 的 actionType='武圣transform'(不同于父魂主转化 'transform')
    // 直接用 tryDispatch 携带 preceding(actionType 需自定义)
    await P1.tryDispatch({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 'r1#父魂武圣', targets: [1] },
      preceding: [
        { skillId: '界父魂', actionType: '武圣transform', params: { cardId: 'r1' } },
      ],
    });
    // 需手动推进事件迭代(processAllEvents 被 dispatch 包装,但 tryDispatch 不包)
    await harness.waitForStable();
    harness.processAllEvents();

    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 10. granted 咆哮:连续出第二张杀 ─────────────────────────────

  it('granted 后可连续出杀(咆哮无限次数)', async () => {
    const s1 = makeCard('s1', '杀', '♠', '4');
    const s2 = makeCard('s2', '杀', '♣', '5');
    const state = makeState({
      p1Hand: ['s1', 's2'],
      cardMap: { s1, s2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 第一张杀:造成伤害,触发 granted
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.turn.vars['父魂/granted']).toBe(0);

    // 第二张杀:granted 咆哮后,无视基础 1 次上限
    await P1.useCardAndTarget('杀', 's2', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 11. 不触发 granted:杀被闪抵消 ─────────────────────────────

  it('杀被闪抵消 → 不触发 granted', async () => {
    const slash = makeCard('s1', '杀', '♠', '4');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state = makeState({
      p1Hand: ['s1'],
      p2Hand: ['d1'],
      cardMap: { s1: slash, d1: dodge },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.respond('闪', { cardId: 'd1' });

    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.turn.vars['父魂/granted']).toBeUndefined();
  });

  // ─── 12. 转化 rollback:杀.use 失败 → 两张原卡还原 ─────────

  it('rollback:杀.use validate 失败 → 两张原卡还原,影子卡删除', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    const c2 = makeCard('c2', '桃', '♣', '3');
    const state = makeState({
      p1Hand: ['c1', 'c2'],
      cardMap: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 无 targets → 杀.use validate 拒绝 → rollback 父魂 transform
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 'c1#c2#父魂' },
      preceding: [{ skillId: '界父魂', actionType: 'transform', params: { cardIds: ['c1', 'c2'] } }],
    });

    expect(harness.state.cardMap['c1#c2#父魂']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(harness.state.players[0].hand).toHaveLength(2);
  });

  // ─── 13. 转化负向:1 张牌/同张牌/敌方牌 → 拒绝 ─────────────────────────────

  it('转化校验:1 张牌 → 拒绝', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    const state = makeState({
      p1Hand: ['c1'],
      cardMap: { c1 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界父魂',
      actionType: 'transform',
      params: { cardIds: ['c1'] },
    });
  });

  it('转化校验:同张牌 → 拒绝', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    const state = makeState({
      p1Hand: ['c1'],
      cardMap: { c1 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界父魂',
      actionType: 'transform',
      params: { cardIds: ['c1', 'c1'] },
    });
  });

  it('转化校验:对方手牌 → 拒绝', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    const c2 = makeCard('c2', '闪', '♥', '3'); // 在 P2 手牌
    const state = makeState({
      p1Hand: ['c1'],
      p2Hand: ['c2'],
      cardMap: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界父魂',
      actionType: 'transform',
      params: { cardIds: ['c1', 'c2'] },
    });
  });
});
