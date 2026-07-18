// 界火计(界卧龙诸葛·转化技)测试:
//   transform:把一张红色牌(手牌或装备区)当【火攻】使用。
//   use(覆盖火攻.use):界版火攻结算(目标随机展示 + 弃同颜色牌造伤)。
//
// 验证:
//   1. 正面:红♥牌 transformThenUse 界火攻 → 随机展示目标♥ → P1 弃♦(同颜色不同花色)→ 火焰伤害
//      (界版核心:同颜色而非同花色;♥与♦在标版火攻会被拒,界版接受)
//   2. 正面:装备区红牌 transformThenUse → 卸下装备 → 创建影子火攻
//   3. 正面:目标只有1张手牌 → 随机展示即为该牌(确定性)
//   4. 正面:无懈可击抵消 → 无随机展示/无伤害
//   5. rollback:transform + 火攻.use 失败(目标自己)→ 原卡还原,无影子
//   6. 负面:黑牌 transform 被拒(不是红色)
//   7. 负面:非自己回合 transform 被拒
//   8. availableActions:界火计 transform 声明,prompt 卡过滤是红牌(手牌+装备)
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
    skills: opts.skills ?? ['火攻', '界火计'],
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
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        hand: opts?.p2Hand ?? [],
        skills: ['火攻', '闪'],
      }),
    ],
    cardMap: { ...(opts?.extraCards ?? {}) },
    currentPlayerIndex: opts?.current ?? 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界火计', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:♥牌当火攻 → 随机展示♥ → P1 弃♦(同颜色不同花色)→ 火焰伤害 ─
  // 界版核心差异:同颜色(♥♦皆红)而非同花色(标版♥≠♦会拒绝)。
  it('transformThenUse:♥牌当火攻 → 随机展示目标♥ → P1 弃♦(同色不同花色)→ 火焰伤害', async () => {
    const red = makeCard('c1', '桃', '♥', 'A'); // 转化为火攻的红牌
    const diamond = makeCard('m1', '杀', '♦', '5'); // P1 弃的♦(同颜色不同花色)
    const reveal = makeCard('r1', '闪', '♥', '3'); // P2 唯一红♥手牌(随机即为此牌)
    const state = buildState({
      p1Hand: ['c1', 'm1'],
      p2Hand: ['r1'],
      extraCards: { c1: red, m1: diamond, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.transformThenUse('界火计', { cardId: 'c1' }, '火攻', {
      cardId: 'c1#界火计',
      targets: [1],
    });

    // 影子火攻已建立
    expect(harness.state.cardMap['c1#界火计']).toBeDefined();
    expect(harness.state.cardMap['c1#界火计'].name).toBe('火攻');
    expect(harness.state.cardMap['c1#界火计'].shadowOf).toBe('c1');

    // 界版火攻流程:无懈(自动超时跳过)→ 随机展示(无需 P2 操作)→ P1 弃牌
    await P1.pass(); // 无懈
    // 界版无 目标展示 的 请求回应;随机展示由本技能自动完成
    // 现在应进入 P1 弃牌询问
    P1.expectPending('请求回应');
    await P1.respond('界火计', { cardId: 'm1' }); // P1 弃♦

    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 火焰伤害
    const damageEvents = harness.state.atomHistory.filter(
      (e): e is typeof e & { kind: 'atom'; atom: Record<string, unknown> } =>
        e.kind === 'atom' && (e.atom as Record<string, unknown>).type === '造成伤害',
    );
    expect(damageEvents[damageEvents.length - 1].atom.damageType).toBe('火焰');
    // 原卡 c1(转化源)最终进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  // ─── 2. 正面:装备区红牌当火攻 → 卸下装备 → 影子火攻 ──────────────
  it('transformThenUse:装备区♥装备 → 卸下 → 影子火攻 → 流程完成', async () => {
    const redEquip = makeCard('e1', '赤兔', '♥', 'A', '装备牌', '进攻马'); // 红装备
    const match = makeCard('m1', '杀', '♥', '5'); // P1 弃的♥
    const reveal = makeCard('r1', '闪', '♥', '3'); // P2 唯一手牌
    const state = buildState({
      p1Hand: ['m1'],
      p1Equipment: { 进攻马: 'e1' },
      p2Hand: ['r1'],
      extraCards: { e1: redEquip, m1: match, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 装备区红牌也能转化(界版:含装备区)
    await P1.transformThenUse('界火计', { cardId: 'e1' }, '火攻', {
      cardId: 'e1#界火计',
      targets: [1],
    });
    expect(harness.state.cardMap['e1#界火计']).toBeDefined();
    expect(harness.state.cardMap['e1#界火计'].name).toBe('火攻');
    // 装备被卸下(转化后)
    expect(harness.state.players[0].equipment['进攻马']).toBeUndefined();

    await P1.pass(); // 无懈
    P1.expectPending('请求回应');
    await P1.respond('界火计', { cardId: 'm1' }); // P1 弃♥
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 3. 正面:目标只有1张手牌 → 随机展示即为该牌 ──────────────────
  it('随机展示:目标1张手牌 → 展示即为该牌 → 同色弃 → 伤害', async () => {
    const red = makeCard('c1', '桃', '♦', '2');
    const match = makeCard('m1', '杀', '♦', '7');
    const reveal = makeCard('r1', '闪', '♦', '3'); // P2 唯一♦手牌
    const state = buildState({
      p1Hand: ['c1', 'm1'],
      p2Hand: ['r1'],
      extraCards: { c1: red, m1: match, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.transformThenUse('界火计', { cardId: 'c1' }, '火攻', {
      cardId: 'c1#界火计',
      targets: [1],
    });
    await P1.pass(); // 无懈
    P1.expectPending('请求回应');
    await P1.respond('界火计', { cardId: 'm1' });
    expect(harness.state.players[1].health).toBe(2);
    // 验证展示 atom 被发出(界版随机展示机制)
    const displayEvents = harness.state.atomHistory.filter(
      (e) => e.kind === 'atom' && (e.atom as { type?: string }).type === '展示',
    );
    expect(displayEvents.length).toBeGreaterThanOrEqual(1);
  });

  // ─── 4. 正面:无懈可击抵消 → 无随机展示/无伤害 ─────────────────────
  it('无懈抵消:无懈可击 → 无随机展示/无伤害', async () => {
    const red = makeCard('c1', '桃', '♥', 'A');
    const match = makeCard('m1', '杀', '♥', '5');
    const reveal = makeCard('r1', '闪', '♥', '3');
    const wz = makeCard('wz', '无懈可击', '♠', 'J', '锦囊牌');
    const state = buildState({
      p1Hand: ['c1', 'm1'],
      p2Hand: ['r1', 'wz'],
      extraCards: { c1: red, m1: match, r1: reveal, wz },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.transformThenUse('界火计', { cardId: 'c1' }, '火攻', {
      cardId: 'c1#界火计',
      targets: [1],
    });

    // 无懈窗口:P2 出实际无懈可击抵消
    P1.expectPending('请求回应');
    await P2.useCard('无懈可击', 'wz');
    // P1 的反无懈窗口:pass
    P1.expectPending('请求回应');
    await P1.pass();

    // 火攻被抵消,P2 无伤害
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
    // 未发生伤害
    const damageEvents = harness.state.atomHistory.filter(
      (e) => e.kind === 'atom' && (e.atom as { type?: string }).type === '造成伤害',
    );
    expect(damageEvents.length).toBe(0);
  });

  // ─── 5. rollback:transform + 火攻.use 失败 → 原卡还原 ────────────
  it('transform rollback:火攻.use 失败(目标自己)→ 原卡还原,无影子', async () => {
    const red = makeCard('c1', '桃', '♥', 'A');
    const state = buildState({
      p1Hand: ['c1'],
      extraCards: { c1: red },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 火攻.use 目标自己 → validate 拒绝 → rollback 界火计 transform
    await P1.expectRejected({
      skillId: '火攻',
      actionType: 'use',
      params: {
        cardId: 'c1#界火计',
        targets: [0],
        preceding: [{ skillId: '界火计', actionType: 'transform', params: { cardId: 'c1' } }],
      },
    });

    expect(harness.state.cardMap['c1'].name).toBe('桃');
    expect(harness.state.cardMap['c1#界火计']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['c1']);
  });

  // ─── 6. 负面:黑牌 transform 被拒 ────────────────────────────────
  it('transform:黑桃♠ → 拒绝(不是红色)', async () => {
    const black = makeCard('s1', '桃', '♠', 'A');
    const state = buildState({ p1Hand: ['s1'], extraCards: { s1: black } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '界火计',
      actionType: 'transform',
      params: { cardId: 's1' },
    });
  });

  // ─── 7. 负面:非自己回合 transform 被拒 ──────────────────────────
  it('transform:非自己回合 → 拒绝', async () => {
    const red = makeCard('c1', '桃', '♥', 'A');
    const state = buildState({
      p1Hand: ['c1'],
      extraCards: { c1: red },
      current: 1, // P2 回合
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '界火计',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });
  });

  // ─── 8. availableActions:界火计 transform 声明,过滤红牌 ─────────
  it('availableActions:界火计 transform 声明,prompt 卡过滤是红牌(手牌+装备)', async () => {
    const redHeart = makeCard('c1', '桃', '♥', 'A');
    const redDiamond = makeCard('c2', '桃', '♦', '2');
    const blackSpade = makeCard('c3', '杀', '♠', 'A');
    const redEquip = makeCard('e1', '赤兔', '♥', '5', '装备牌', '进攻马');
    const state = buildState({
      p1Hand: ['c1', 'c2', 'c3'],
      p1Equipment: { 进攻马: 'e1' },
      extraCards: { c1: redHeart, c2: redDiamond, c3: blackSpade, e1: redEquip },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const actions = P1.availableActions();
    const jieHuoji = actions.find((a) => a.skillId === '界火计' && a.actionType === 'transform');
    expect(jieHuoji).toBeDefined();
    expect(jieHuoji!.label).toBe('界火计');
    expect(jieHuoji!.prompt.type).toBe('useCardAndTarget');

    const cardFilter =
      jieHuoji!.prompt.type === 'useCardAndTarget' ? jieHuoji!.prompt.cardFilter.filter : null;
    expect(cardFilter).toBeDefined();
    // 手牌过滤:红♥/红♦通过,黑♠拒绝
    expect(cardFilter!(redHeart)).toBe(true);
    expect(cardFilter!(redDiamond)).toBe(true);
    expect(cardFilter!(blackSpade)).toBe(false);
    // 装备区红牌也通过(界版:含装备区)
    expect(cardFilter!(redEquip)).toBe(true);
  });
});
