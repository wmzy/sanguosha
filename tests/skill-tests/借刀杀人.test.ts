// tests/skill-tests/借刀杀人.test.ts
// 借刀杀人(普通锦囊):
//   出牌阶段对装备区有武器的 1 名其他角色(A)使用。
//   A 须选择:对使用者指定的另一名角色 B 使用 1 张杀,或交出武器。
//
// 完整行为测试覆盖:
//   正面:
//     A. 不出杀(pass)→ 发起者获得 A 的武器
//     B. A 出杀 → 对 B 询问闪 → B 不出 → B 扣 1 血
//   负面(expectRejected):
//     - A 无武器 / killTarget=A / killTarget 不存在 / 自己当 A
//     - 非自己回合 / 牌不在手 / 牌名错
// (注:killTarget=发起者自己 是合法的——借别人的刀杀自己)
//
// 每步用 expectPending + respondInfo 验证 pending + cardFilter。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { ActionPrompt, Card, GameState, GameView } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';
import { DEFAULT_SKILLS } from '../../src/engine/atoms/选将';
import { findActionEntry } from '../../src/engine/skill';
import { getCardEffect } from '../../src/engine/card-effect/registry';

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
    skills: opts.skills ?? ['借刀杀人', '杀'],
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
  p1Skills?: string[];
  p2Hand?: string[];
  p2Skills?: string[];
  p2Equipment?: Record<string, string>;
  p3Hand?: string[];
  p3Skills?: string[];
  extraCards?: Record<string, Card>;
  playerCount?: number;
}): GameState {
  const jd = makeCard('jd1', '借刀杀人', '♠', 'A');
  const cards: Record<string, Card> = { jd1: jd, ...(opts?.extraCards ?? {}) };
  const n = opts?.playerCount ?? 3;
  const players = [
    makePlayer({
      index: 0,
      name: 'P1',
      hand: opts?.p1Hand ?? ['jd1'],
      skills: opts?.p1Skills ?? ['借刀杀人', '杀'],
    }),
    makePlayer({
      index: 1,
      name: 'P2',
      hand: opts?.p2Hand ?? [],
      equipment: opts?.p2Equipment ?? {},
      skills: opts?.p2Skills ?? ['杀'],
    }),
  ];
  for (let i = 2; i < n; i++) {
    players.push(
      makePlayer({ index: i, name: `P${i + 1}`, hand: opts?.p3Hand, skills: opts?.p3Skills }),
    );
  }
  return createGameState({
    players,
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('借刀杀人', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ────────────────────────────────────────────────────────────
  // 1. 正面:A 不出杀(pass)→ 发起者获得 A 的武器
  //    全程 expectPending + respondInfo 验证 pending + cardFilter
  // ────────────────────────────────────────────────────────────
  it('P1 对 P2(有武器)借刀杀人,killTarget=P3 → expectPending(请求回应)无懈 → pass → expectPending(请求回应)借刀杀人/出杀 → P2 pass → P1 获得武器', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const p2shan = makeCard('p2s', '闪', '♥', '4', '基本牌');
    const state = buildState({
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p2Skills: ['杀', '无懈可击'], // 加 无懈可击 让 P2 respondInfo 推导 cardFilter
      extraCards: { wp1: weapon, p2s: p2shan },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });

    // 窗口 1:无懈可击(broadcast)
    P1.expectPending('请求回应');
    const info1 = P2.respondInfo();
    expect(info1?.skillId).toBe('无懈可击');
    expect(info1?.cardFilter).toBeDefined();
    await P1.pass(); // 消耗无懈窗口

    // 窗口 2:借刀杀人/出杀(target=P2)
    // 注:此窗口的 respond action 由 play-card(使用牌) 按卡名 skillId='借刀杀人' 注册到每个座次
    //    (CardEffect.respond 字段),respondInfo 推导 skillId='借刀杀人'(strip /出杀)。
    //    验证委托链路:从 slot.atom.prompt 提取实际的 cardFilter(仅接受杀)。
    P2.expectPending('请求回应');
    const info2 = P2.respondInfo();
    expect(info2?.skillId).toBe('借刀杀人');
    // 直接从 slot.atom 拿 prompt.cardFilter 验证“仅接受 杀”委托关系
    const slot2 = harness.state.pendingSlots.get(1)!;
    const prompt2 = (slot2.atom as { prompt: { cardFilter?: { filter?: (c: Card) => boolean } } })
      .prompt;
    expect(prompt2.cardFilter?.filter?.(makeCard('x', '杀', '♠', 'A', '基本牌'))).toBe(true);
    expect(prompt2.cardFilter?.filter?.(makeCard('y', '闪', '♥', '5', '基本牌'))).toBe(false);

    await P2.pass(); // 不出杀

    // P2 的武器被卸下,P1 拿到
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('wp1');
    expect(harness.state.players[0].hand.length).toBe(1);
    // 借刀杀人进弃牌堆
    expect(harness.state.zones.discardPile).toContain('jd1');
    expect(harness.state.zones.processing).toEqual([]);
    // view 级断言:P1 视角武器到手 + 无 pending
    P1.processEvents();
    P1.expectView((v) => {
      expect(v.players[0].hand!.map((c) => c.id)).toContain('wp1');
      expect(v.players[0].handCount).toBe(1);
      expect(v.players[1].equipment['武器']).toBeUndefined();
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 正面:A 出杀 → 对 killTarget 询问闪 → killTarget 不闪 → killTarget 扣 1 血
  // ─────────────────────────────────────────────────────────────
  it('P2 出杀 → expectPending(询问闪)P3 → pass → P3 扣 1 血,P2 武器保留', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const s2 = makeCard('p2s', '杀', '♥', '5', '基本牌');
    const p3kill = makeCard('p3k', '杀', '♠', '9', '基本牌');
    const state = buildState({
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p3Hand: ['p3k'],
      p3Skills: ['闪'], // P3 有 闪 技能,respondInfo 能推导 cardFilter
      extraCards: { wp1: weapon, p2s: s2, p3k: p3kill },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    const p3HealthBefore = harness.state.players[2].health;

    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口

    // P2 选一张杀打出(经 借刀杀人/出杀 respond,targets 必含 killTarget=P3)
    P2.expectPending('请求回应');
    await P2.respond('借刀杀人', { cardId: 'p2s', targets: [2] });

    // 现在 P3 被询问闪
    P3.expectPending('询问闪');
    const info = P3.respondInfo();
    expect(info?.skillId).toBe('闪'); // '询问闪' → skillId='闪'
    expect(info?.cardFilter).toBeDefined();
    // P3 手中无闪 → respondableCards 空
    expect(P3.respondableCards()).toEqual([]);
    await P3.pass();

    // P3 扣 1 血
    expect(harness.state.players[2].health).toBe(p3HealthBefore - 1);
    // P2 的杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p2s');
    // P2 的武器未丢失
    expect(harness.state.players[1].equipment['武器']).toBe('wp1');
    // 借刀杀人进弃牌堆
    expect(harness.state.zones.discardPile).toContain('jd1');
    expect(harness.state.zones.processing).toEqual([]);
    // view 级断言:P3 视角自己扣血 + P2 武器保留
    P3.processEvents();
    P3.expectView((v) => {
      expect(v.players[2].health).toBe(p3HealthBefore - 1);
      expect(v.players[1].equipment['武器']).toBe('wp1');
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2b. A 出杀 → B 出闪 → B 不扣血(来源: jiedao-full 用例3)
  // ─────────────────────────────────────────────────────────────
  it('P2 出杀 → P3 出闪 → P3 不扣血,P2 武器保留', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const s2 = makeCard('p2s', '杀', '♥', '5', '基本牌');
    const d3 = makeCard('p3d', '闪', '♥', '2', '基本牌');
    const state = buildState({
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p3Hand: ['p3d'],
      p3Skills: ['闪'],
      extraCards: { wp1: weapon, p2s: s2, p3d: d3 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    const p3HealthBefore = harness.state.players[2].health;

    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口

    // P2 选一张杀打出(经 借刀杀人/出杀 respond,targets 必含 killTarget=P3)
    P2.expectPending('请求回应');
    await P2.respond('借刀杀人', { cardId: 'p2s', targets: [2] });

    // P3 被询问闪 → 出闪
    P3.expectPending('询问闪');
    await P3.respond('闪', { cardId: 'p3d' });

    // P3 不扣血
    expect(harness.state.players[2].health).toBe(p3HealthBefore);
    // P3 的闪进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p3d');
    // P2 武器保留(出杀分支不交武器)
    expect(harness.state.players[1].equipment['武器']).toBe('wp1');
  });

  // ─────────────────────────────────────────────────────────────
  // 3. validate 拒绝:A 无武器
  // ─────────────────────────────────────────────────────────────
  it('A(P2)无武器 → 被拒绝(targetHasWeapon=false)', async () => {
    await harness.setup(
      buildState({
        p2Equipment: {},
      }),
    );
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 2 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:killTarget = A
  // ─────────────────────────────────────────────────────────────
  it('killTarget = A(P2) → 被拒绝(killTargetNotTarget)', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    await harness.setup(
      buildState({
        p2Equipment: { 武器: 'wp1' },
        extraCards: { wp1: weapon },
      }),
    );
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. 正面:killTarget = 发起者(P1 自己) —— 借别人的刀杀自己
  //    规则:借刀杀人可指定发起者自己为杀的目标 B;A 出杀 → 杀使用者自己
  // ─────────────────────────────────────────────────────────────
  it('killTarget = 发起者(P1 自己) → P2 出杀杀 P1 → P1 被询问闪 → 不闪扣血', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const p2Kill = makeCard('p2s', '杀', '♥', '5', '基本牌');
    // P1 额外一张手牌:触发借刀杀人后仍有手牌,询问闪才走 silent 创建 pending
    // (无手牌时 cardResponsePreResolveForTarget 会 skip 询问闪,不创建 pending)
    const p1Extra = makeCard('p1k', '杀', '♠', '9', '基本牌');
    await harness.setup(
      buildState({
        p1Hand: ['jd1', 'p1k'],
        p2Hand: ['p2s'],
        p2Equipment: { 武器: 'wp1' },
        p2Skills: ['杀', '无懈可击'],
        extraCards: { wp1: weapon, p2s: p2Kill, p1k: p1Extra },
      }),
    );
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const p1HealthBefore = harness.state.players[0].health;

    // killTarget=0(P1 自己) —— 借刀杀人允许借别人的刀杀自己
    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 0 });
    await P1.pass(); // 无懈窗口

    // P2 被问询出杀 → 出杀(杀 P1 自己)
    P2.expectPending('请求回应');
    await P2.respond('借刀杀人', { cardId: 'p2s', targets: [0] });

    // 杀对 P1 结算 → P1 被询问闪
    P1.expectPending('询问闪');
    await P1.pass(); // 不闪

    // P1 被借刀杀自己成功 → 扣 1 血
    expect(harness.state.players[0].health).toBe(p1HealthBefore - 1);
    // P2 出了杀(进弃牌堆),不交武器
    expect(harness.state.zones.discardPile).toContain('p2s');
    expect(harness.state.players[1].equipment['武器']).toBe('wp1');
    // 借刀杀人进弃牌堆
    expect(harness.state.zones.discardPile).toContain('jd1');
  });

  // ─────────────────────────────────────────────────────────────
  // 6. validate 拒绝:target = 自己
  // ─────────────────────────────────────────────────────────────
  it('target = 自己 → 被拒绝(notSelf)', async () => {
    await harness.setup(buildState({ p2Equipment: {} }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 0, killTarget: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. validate 拒绝:非自己回合
  // ─────────────────────────────────────────────────────────────
  it('非自己回合 → 被拒绝', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const state = buildState({
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');
    await P2.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 2 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 8. validate 拒绝:killTarget 不存在
  // ─────────────────────────────────────────────────────────────
  it('killTarget 不存在(idx 99)→ 被拒绝(killTargetAlive=false)', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    await harness.setup(
      buildState({
        p2Equipment: { 武器: 'wp1' },
        extraCards: { wp1: weapon },
      }),
    );
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 99 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 9. validate 拒绝:牌不在手
  // ─────────────────────────────────────────────────────────────
  it('出不在手牌的借刀杀人 → 被拒绝', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    await harness.setup(
      buildState({
        p1Hand: [],
        p2Equipment: { 武器: 'wp1' },
        extraCards: { wp1: weapon },
      }),
    );
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 2 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 10. validate 拒绝:牌名错(用杀当借刀杀人)
  // ─────────────────────────────────────────────────────────────
  it('用杀当借刀杀人出 → 被拒绝(cardNameOk=false)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    await harness.setup(
      buildState({
        p1Hand: ['s1'],
        p2Equipment: { 武器: 'wp1' },
        extraCards: { s1: slash, wp1: weapon },
      }),
    );
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 's1', target: 1, killTarget: 2 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. 火杀经借刀杀人对藤甲目标造成火焰伤害（damageType 不丢失）
  //    回归：修复前 resolve 手写 runDamageFlow 未传 damageType，藤甲 +1 失效。
  //    修复后走 useCard → runUseFlow → 杀.resolveSlash 读 cardMap.damageType 传导。
  // ─────────────────────────────────────────────────────────────
  it('P2 用火杀响应借刀杀人 → P3(藤甲) 受 2 点火焰伤害', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const armor = makeCard('ar1', '藤甲', '♠', '2', '装备牌');
    // 火杀：name='杀' + damageType='火焰'(DamageType = 普通|火焰|雷电)
    const fireSlash = { ...makeCard('p2s', '杀', '♥', '5', '基本牌'), damageType: '火焰' as const };
    // P3 手中给一张非闪牌（避免空手 skip 模式跳过询问闪），使询问闪可观察
    const p3filler = makeCard('p3k', '杀', '♠', '9', '基本牌');
    const state = buildState({
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p3Hand: ['p3k'],
      p3Skills: ['闪', '藤甲'],
      extraCards: { wp1: weapon, ar1: armor, p2s: fireSlash, p3k: p3filler },
    });
    // P3 装备藤甲
    state.players[2].equipment = { 防具: 'ar1' };
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    const before = harness.state.players[2].health;

    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口

    // P2 用火杀响应（targets 必含 P3=2）
    P2.expectPending('请求回应');
    await P2.respond('借刀杀人', { cardId: 'p2s', targets: [2] });

    // P3 被询问闪 → 不闪
    P3.expectPending('询问闪');
    await P3.pass();

    // 藤甲对火焰伤害 +1 → 扣 2 血（修复前 damageType 丢失，藤甲按普通伤害 -1 → 仅 0 伤害）
    expect(harness.state.players[2].health).toBe(before - 2);
    // 火杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p2s');
    // P2 武器保留（出杀分支不交武器）
    expect(harness.state.players[1].equipment['武器']).toBe('wp1');
  });

  // ─────────────────────────────────────────────────────────────
  // 5. 方天画戟多目标：A 装方天画戟且手牌仅剩此杀 → 借刀杀人逼杀可追加目标
  //    方天画戟的「最后一张手牌为杀可指定最多 3 目标」由杀 CardEffect target.max=3
  //    自然支持（见 skills/方天画戟.ts 注释），useCard(none) 走 runUseFlow 对每目标结算。
  //    断言三目标均实际扣 1 血（而非仅“不报错”）：每个目标发一张非闪填充牌，
  //    使「询问闪」真正创建 pending 可观察，全部不闪 → 各扣 1 血。
  // ─────────────────────────────────────────────────────────────
  it('P2(方天画戟, 仅 1 张杀) 被借刀 → 可对 B+C+D 多目标出杀,三目标均扣 1 血', async () => {
    const weapon = makeCard('wp1', '方天画戟', '♣', '5', '装备牌');
    const s2 = makeCard('p2s', '杀', '♥', '5', '基本牌');
    // 每个被杀目标各发一张非闪填充牌,使「询问闪」真正可观察(空手会触发 skip,不创建 pending)
    const f1 = makeCard('f1', '杀', '♠', '2', '基本牌'); // P1 填充
    const f3 = makeCard('f3', '杀', '♠', '3', '基本牌'); // P3 填充
    const f4 = makeCard('f4', '杀', '♠', '4', '基本牌'); // P4 填充
    const state = buildState({
      playerCount: 4,
      p1Hand: ['jd1', 'f1'], // 借刀杀人 + P1 自己的填充牌(使被杀时有手牌可观察询问闪)
      p2Hand: ['p2s'], // 仅 1 张杀（方天画戟多目标条件）
      p2Equipment: { 武器: 'wp1' },
      p3Hand: [],
      p3Skills: ['闪'],
      extraCards: { wp1: weapon, p2s: s2, f1, f3, f4 },
    });
    // buildState 用同一 p3Hand 给 index≥2 的玩家,这里单独给 P3/P4 不同手牌
    state.players[2].hand = ['f3'];
    state.players[3].hand = ['f4'];
    // 方天画戟攻击范围 4：初始装备不走 装备 atom，手动补齐 vars（与现有装备测试一致）
    state.players[1].vars['距离/出杀范围'] = 4;
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p1HealthBefore = harness.state.players[0].health;
    const p3HealthBefore = harness.state.players[2].health;
    const p4HealthBefore = harness.state.players[3].health;

    // P1 借 P2 的刀，killTarget=P3(=2)。P2 响应对 P3/P4/P1 三目标出杀。
    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口

    P2.expectPending('请求回应');
    // targets 必含 killTarget=2；方天画戟追加 P4(3) 与 P1(0)
    await P2.respond('借刀杀人', { cardId: 'p2s', targets: [2, 3, 0] });

    // 三目标依次被询问闪（P3/P4/P1，按目标座次顺序）。各有手牌 → 询问闪 pending 真实创建。
    // 全部选择不闪 → 各扣 1 血(证明三目标均真正进入杀结算,而非只“不报错”)。
    for (let i = 0; i < 3; i++) {
      const slots = harness.state.pendingSlots;
      if (slots.size === 0) break;
      const seat = [...slots.keys()][0];
      await harness.player(seat).pass();
    }

    // 关键:三个被杀目标都实际扣了 1 血(走完伤害结算)
    expect(harness.state.players[2].health).toBe(p3HealthBefore - 1); // P3
    expect(harness.state.players[3].health).toBe(p4HealthBefore - 1); // P4
    expect(harness.state.players[0].health).toBe(p1HealthBefore - 1); // P1
    // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('p2s');
    // P2 手牌已空（唯一的杀已用）
    expect(harness.state.players[1].hand).toEqual([]);
    // P2 武器保留（出杀分支不交武器）
    expect(harness.state.players[1].equipment['武器']).toBe('wp1');
    // 借刀杀人进弃牌堆
    expect(harness.state.zones.discardPile).toContain('jd1');
    expect(harness.state.zones.processing).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────
  // 5b. respond 阶段拒绝超距目标(defect 修复证明):
  //     A 装诸葛连弩(攻击范围 1)被借刀,选 [P3(2), P4(3)] 出杀,但 P4 距 P2 为 2 > 1,
  //     超出攻击范围。修复前:respond 不校验距离 → 进 resolve 后 useCard(canUseSlash)
  //     拒绝 → 整张借刀杀人静默白费(既不杀也不交武器)。
  //     修复后:respond validate 校验 inAttackRange → A 的非法选择被拒(pending 仍留在 A),
  //     A 重选或 pass → pass 后正常交武器,不再静默白费。
  // ─────────────────────────────────────────────────────────────
  it('A 选超距目标出杀 → respond 被拒(pending 仍在 A),A pass 后正常交武器', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const s2 = makeCard('p2s', '杀', '♥', '5', '基本牌');
    const state = buildState({
      playerCount: 4,
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p3Hand: [],
      p3Skills: ['闪'],
      extraCards: { wp1: weapon, p2s: s2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口

    P2.expectPending('请求回应');
    // P4(3) 距 P2(1) 为 2,超出诸葛连弩攻击范围(1)→ respond 被拒,pending 不消费
    await P2.expectRejected({
      skillId: '借刀杀人',
      actionType: 'respond',
      params: { cardId: 'p2s', targets: [2, 3] },
    });

    // pending 仍在 P2(未被消费):仍是 借刀杀人/出杀 询问
    P2.expectPending('请求回应');
    expect(P2.respondInfo()?.skillId).toBe('借刀杀人');

    // A 放弃出杀 → 交武器
    await P2.pass();

    // P2 武器被卸下,P1 拿到——证明借刀杀人正常结算,未静默白费
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('wp1');
    // P2 的杀未被使用(仍在手)
    expect(harness.state.players[1].hand).toContain('p2s');
    // 借刀杀人进弃牌堆
    expect(harness.state.zones.discardPile).toContain('jd1');
    expect(harness.state.zones.processing).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────
  // 5c. respond 阶段拒绝:A 出杀的目标不含发起者指定的 killTarget
  //     借刀杀人核心规则:A 必须对发起者指定的 B 出杀(可追加,但必含 B),不可借机偏移目标。
  //     respond.validate:killTarget ∈ targets 权威校验 → 非法选择被拒,pending 仍留在 A。
  //     此 respond 阶段负面路径此前无覆盖(所有正面用例 killTarget 都在 targets 内)。
  // ─────────────────────────────────────────────────────────────
  it('A 选不含 killTarget 的目标出杀 → respond 被拒(pending 仍在 A),A pass 后正常交武器', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const s2 = makeCard('p2s', '杀', '♥', '5', '基本牌');
    const state = buildState({
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p3Hand: [],
      p3Skills: ['闪'],
      extraCards: { wp1: weapon, p2s: s2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // killTarget=P3(2);P2 试图改杀 P1(0),targets 不含 2 → 必含校验失败
    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口

    P2.expectPending('请求回应');
    await P2.expectRejected({
      skillId: '借刀杀人',
      actionType: 'respond',
      params: { cardId: 'p2s', targets: [0] },
    });

    // pending 仍在 P2(未被消费):仍是 借刀杀人/出杀 询问
    P2.expectPending('请求回应');
    expect(P2.respondInfo()?.skillId).toBe('借刀杀人');

    // A 放弃出杀 → 交武器(借刀杀人正常结算,未静默白费)
    await P2.pass();
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('wp1');
    // P2 的杀未被使用(仍在手)
    expect(harness.state.players[1].hand).toContain('p2s');
    // 借刀杀人进弃牌堆
    expect(harness.state.zones.discardPile).toContain('jd1');
    expect(harness.state.zones.processing).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────
  // 回归(Phase 2):P1 先出自己的杀(用满本回合出杀次数)再借刀杀人逼 P2 出杀——
  // 逼杀不应被「回合内出杀次数」误挡。
  //
  // 背景:Phase 2 借刀杀人逼杀走 useCard(quotaPolicy='none')→ validateCardUse
  // (mode='forced')。forced 模式正确跳过 checkUsageLimit,但 effect.canUse(=杀.canUse
  // → canUseSlash)仍会执行,而 canUseSlash 内调用 canSlash 读取 turn 级
  // quotaUsed(=P1 已用次数)→ 误拒 P2 的逼杀。
  // 修复:移除 canUseSlash 中冗余的 canSlash(quota 唯一由 checkUsageLimit 负责)。
  //
  // 注:buildState 初始装备不走 装备 atom,诸葛连弩的无限 provider 未注册,
  // 故 slashMax(P2)=1(基础);P1 已用 1 次 → 修复前 canSlash(P2)=false → 逼杀被挡。
  // P3 须有手牌:空手会触发「询问闪」skip 模式(不创建 pending),无法观察逼杀成功。
  // ─────────────────────────────────────────────────────────────
  it('P1 先出杀(用满次数)再借刀杀人 → P2 的逼杀仍能成功', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const s1 = makeCard('s1', '杀', '♠', '7', '基本牌');
    const p2s = makeCard('p2s', '杀', '♥', '5', '基本牌');
    // P3 填充牌(非闪):避免空手 skip 模式跳过询问闪,使逼杀成功可观察
    const p3filler = makeCard('p3x', '杀', '♠', '9', '基本牌');
    const state = buildState({
      p1Hand: ['jd1', 's1'], // 借刀杀人 + P1 自己的杀
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p3Hand: ['p3x'],
      p3Skills: ['闪'],
      extraCards: { wp1: weapon, s1, p2s, p3x: p3filler },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    const p2HealthBefore = harness.state.players[1].health;
    const p3HealthBefore = harness.state.players[2].health;

    // P1 先用自己的杀打 P2(消耗本回合唯一的出杀次数)
    await P1.triggerAction('杀', 'use', { cardId: 's1', targets: [1] });
    await P2.pass(); // P2 不闪 → 受 1 点伤害
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 关键前提:P1 的出杀次数已达上限
    expect(harness.state.turn.vars['杀/quotaUsed']).toBe(1);

    // P1 发动借刀杀人逼 P2 对 P3 出杀
    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口

    // P2 被问询出杀 → 出杀。关键:不应被 P1 的出杀次数挡
    P2.expectPending('请求回应');
    await P2.respond('借刀杀人', { cardId: 'p2s', targets: [2] });

    // P3 被询问闪 → 证明 P2 的杀未被挡(逼杀成功)
    P3.expectPending('询问闪');
    await P3.pass();

    // P2 的杀已用(进弃牌堆)。修复前:逼杀被静默拒绝,p2s 仍在 P2 手中
    expect(harness.state.zones.discardPile).toContain('p2s');
    expect(harness.state.players[1].hand).not.toContain('p2s');
    // P3 受 1 点伤害(杀生效)→ 进一步证明逼杀成功且走完结算
    expect(harness.state.players[2].health).toBe(p3HealthBefore - 1);
    // P2 出杀分支不交武器
    expect(harness.state.players[1].equipment['武器']).toBe('wp1');
    // 借刀杀人进弃牌堆
    expect(harness.state.zones.discardPile).toContain('jd1');
    expect(harness.state.zones.processing).toEqual([]);
  });

  // ─── 回归:f7536790 把借刀杀人从 DEFAULT_SKILLS 移除后,真实选将路径
  //     (skills=DEFAULT_SKILLS,不手动注入 '借刀杀人') 不再实例化借刀杀人技能 →
  //     「借刀杀人/出杀」respond action 未注册 → 被借刀者无法回应。
  //     此用例不手动注入,仅靠 DEFAULT_SKILLS。
  it('经 DEFAULT_SKILLS 实例化(真实选将路径)后 借刀杀人/出杀 respond action 已注册', async () => {
    const state = buildState({
      p1Skills: [...DEFAULT_SKILLS],
      p2Skills: [...DEFAULT_SKILLS],
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌') },
    });
    await harness.setup(state);

    // 借刀杀人 skill 为每个座次注册 respond action(借刀杀人/出杀);P2 座次应已注册。
    expect(findActionEntry(harness.state, '借刀杀人', 1, 'respond')).toBeDefined();
    // 同理铁索连环 recast 也应随 DEFAULT_SKILLS 实例化
    expect(findActionEntry(harness.state, '铁索连环', 0, 'recast')).toBeDefined();
  });

  // ─── 回归:借刀杀人 use action 的 prompt 必须声明双目标 slots(A 持武器 + B 杀目标)。
  //     缺 slots 时前端 derivePlayRules 判 hasSlots=false，把借刀杀人当单目标牌:
  //     选 A 即可点出牌,但 buildPlayParams 产出 {targets:[A]} 缺 killTarget →
  //     后端 canUseBorrowedSword 返回 'killTarget required' 静默拒绝 →
  //     表现为「无法选杀的目标、出牌无响应」。
  it('use action prompt 声明双目标 slots(A 须持武器 + B 任意其他角色)', () => {
    const eff = getCardEffect('借刀杀人');
    expect(eff).toBeDefined();
    const prompt = eff!.prompt as Extract<ActionPrompt, { type: 'useCardAndTarget' }>;
    expect(prompt.type).toBe('useCardAndTarget');
    const slots = prompt.targetFilter?.slots;
    expect(slots, '借刀杀人 prompt 必须声明双目标 slots').toBeDefined();
    expect(slots!.length).toBe(2);

    // P0=自己, P1=持武器, P2=徒手
    const view = {
      currentPlayerIndex: 0,
      players: [
        { alive: true, equipment: {} },
        { alive: true, equipment: { 武器: 'wp1' } },
        { alive: true, equipment: {} },
      ],
    } as unknown as GameView;

    // A 槽位:须持有武器的其他角色
    expect(slots![0].filter!(view, 1, { selected: [] })).toBe(true);  // P1 持武器
    expect(slots![0].filter!(view, 2, { selected: [] })).toBe(false); // P2 徒手
    expect(slots![0].filter!(view, 0, { selected: [] })).toBe(false); // 自己

    // B 槽位:任意存活角色,排除自己与已选 A
    expect(slots![1].filter!(view, 2, { selected: [1] })).toBe(true);  // P2 可(≠A=P1)
    expect(slots![1].filter!(view, 1, { selected: [1] })).toBe(false); // =A 不可
    expect(slots![1].filter!(view, 0, { selected: [1] })).toBe(true);  // 发起者自己可(借刀杀自己)
  });
});
