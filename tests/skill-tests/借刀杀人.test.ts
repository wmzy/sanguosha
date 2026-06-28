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
//     - A 无武器 / killTarget=A / killTarget=发起者 / killTarget 不存在 / 自己当 A
//     - 非自己回合 / 牌不在手 / 牌名错
//
// 每步用 expectPending + respondInfo 验证 pending + cardFilter。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
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
    skills: opts.skills ?? ['借刀杀人', '杀'],
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
    makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? ['jd1'], skills: opts?.p1Skills ?? ['借刀杀人', '杀'] }),
    makePlayer({
      index: 1,
      name: 'P2',
      hand: opts?.p2Hand ?? [],
      equipment: opts?.p2Equipment ?? {},
      skills: opts?.p2Skills ?? ['杀'],
    }),
  ];
  for (let i = 2; i < n; i++) {
    players.push(makePlayer({ index: i, name: `P${i + 1}`, hand: opts?.p3Hand, skills: opts?.p3Skills }));
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
  it('P1 对 P2(有武器)借刀杀人,killTarget=P3 → expectPending(请求回应)无懈 → pass → expectPending(请求回应)杀/forceKill → P2 pass → P1 获得武器', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const state = buildState({
      p2Equipment: { 武器: 'wp1' },
      p2Skills: ['杀', '无懈可击'], // 加 无懈可击 让 P2 respondInfo 推导 cardFilter
      extraCards: { wp1: weapon },
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

    // 窗口 2:杀/forceKill(target=P2)
    // 注:此窗口委托 杀 skill 响应(杀.respond 处理 forceKill requestType),
    //    respondInfo 推导 skillId='借刀杀人'(strip /forceKill),但其 onMount
    //    只声明 'use' action 无 'respond' → cardFilter 查不到。
    //    验证委托链路:从 slot.atom.prompt 提取实际的 cardFilter(来自 借刀杀人.ts inline)。
    P2.expectPending('请求回应');
    const info2 = P2.respondInfo();
    expect(info2?.skillId).toBe('杀');
    // 直接从 slot.atom 拿 prompt.cardFilter 验证“仅接受 杀”委托关系
    const slot2 = harness.state.pendingSlots.get(1)!;
    const prompt2 = (slot2.atom as { prompt: { cardFilter?: { filter?: (c: Card) => boolean } } }).prompt;
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
    P1.expectView(v => {
      expect(v.players[0].hand!.map(c => c.id)).toContain('wp1');
      expect(v.players[0].handCount).toBe(1);
      expect(v.players[1].equipment['武器']).toBeUndefined();
      expect(v.pending).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 1b. 正面:cardFilter 过滤正确 — P2 手中只有杀时,委托 filter 接受杀
  //    (杀/forceKill 委托 杀 skill 响应;从 slot.atom.prompt 取 cardFilter 验证)
  // ────────────────────────────────────────────────────────────
  it('P2 有杀时,杀/forceKill 窗口的 slot.atom.prompt.cardFilter 接受 P2 手里的杀', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const s2 = makeCard('p2s', '杀', '♥', '5', '基本牌');
    const state = buildState({
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p2Skills: ['杀', '无懈可击'],
      extraCards: { wp1: weapon, p2s: s2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口

    P2.expectPending('请求回应');
    const slot = harness.state.pendingSlots.get(1)!;
    const prompt = (slot.atom as { prompt: { cardFilter?: { filter?: (c: Card) => boolean } } }).prompt;
    const filter = prompt.cardFilter?.filter;
    expect(filter).toBeDefined();
    // 杀牌过,p2s 应通过
    expect(filter!(s2)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 正面:A 出杀 → 对 killTarget 询问闪 → killTarget 不闪 → killTarget 扣 1 血
  // ─────────────────────────────────────────────────────────────
  it('P2 出杀 → expectPending(询问闪)P3 → pass → P3 扣 1 血,P2 武器保留', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const s2 = makeCard('p2s', '杀', '♥', '5', '基本牌');
    const state = buildState({
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p3Skills: ['闪'], // P3 有 闪 技能,respondInfo 能推导 cardFilter
      extraCards: { wp1: weapon, p2s: s2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    const p3HealthBefore = harness.state.players[2].health;

    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口

    // P2 选一张杀打出
    P2.expectPending('请求回应');
    await P2.respond('杀', { cardId: 'p2s' });

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
    P3.expectView(v => {
      expect(v.players[2].health).toBe(p3HealthBefore - 1);
      expect(v.players[1].equipment['武器']).toBe('wp1');
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. validate 拒绝:A 无武器
  // ─────────────────────────────────────────────────────────────
  it('A(P2)无武器 → 被拒绝(targetHasWeapon=false)', async () => {
    await harness.setup(buildState({
      p2Equipment: {},
    }));
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
    await harness.setup(buildState({
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:killTarget = 发起者
  // ─────────────────────────────────────────────────────────────
  it('killTarget = 发起者(P1) → 被拒绝(killTargetNotOwner)', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    await harness.setup(buildState({
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1, killTarget: 0 },
    });
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
    await harness.setup(buildState({
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    }));
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
    await harness.setup(buildState({
      p1Hand: [],
      p2Equipment: { 武器: 'wp1' },
      extraCards: { wp1: weapon },
    }));
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
    await harness.setup(buildState({
      p1Hand: ['s1'],
      p2Equipment: { 武器: 'wp1' },
      extraCards: { s1: slash, wp1: weapon },
    }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '借刀杀人',
      actionType: 'use',
      params: { cardId: 's1', target: 1, killTarget: 2 },
    });
  });
});