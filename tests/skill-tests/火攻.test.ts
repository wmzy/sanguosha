// 火攻(普通锦囊)技能测试:
//   use:出牌阶段对一名有手牌的角色使用(可对自己使用火攻)。
//   流程:目标展示一张手牌 → 使用者弃一张同花色手牌 → 造成1点火焰伤害。
//
// 验证:
//   1. 正面:目标展示♥ → 使用者弃♥ → 目标扣1血(火焰伤害 damageType='火焰')
//   2. 正面:目标展示♥ → 使用者 pass(不弃)→ 无伤害
//   3. 正面:使用者无同花色手牌 → 不询问弃牌 → 无伤害
//   4. 正面:弃牌窗口试图弃不同花色(♦)→ 被拒
//   5. 负面:目标无手牌 → 拒绝
//   6. 正面:对自己使用火攻 → 自扣1血(火焰伤害)
//   (无懈可击抵消为 runSettlementPhase 通用机制,非火攻特有,不在此单测)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import { buildView } from '../../src/engine/index';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
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
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['火攻'],
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
}): GameState {
  const cards: Record<string, Card> = { ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? [] }),
      makePlayer({ index: 1, name: 'P2', hand: opts?.p2Hand ?? [] }),
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('火攻', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:展示♥ → 弃♥ → 火焰伤害 ─────────────────────────────
  it('P1 火攻 P2 → pass 无懈 → P2 展示♥ → P1 弃♥ → P2 扣1血(火焰伤害)', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const match = makeCard('m1', '桃', '♥', '5'); // P1 用来弃的♥
    const reveal = makeCard('r1', '杀', '♥', '3'); // P2 展示的♥
    const state = buildState({
      p1Hand: ['hg', 'm1'],
      p2Hand: ['r1'],
      extraCards: { hg, m1: match, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('火攻', 'hg', [1]);
    // 无懈可击窗口 → pass
    P1.expectPending('请求回应');
    await P1.pass();

    // P2 被询问展示一张手牌(火攻/展示)
    P2.expectPending('请求回应');
    const info2 = P2.respondInfo();
    expect(info2?.skillId).toBe('火攻');
    await P2.respond('火攻', { cardId: 'r1' });

    // P1 被询问弃一张同花色(♥)手牌(火攻/弃牌)
    P1.expectPending('请求回应');
    const info1 = P1.respondInfo();
    expect(info1?.skillId).toBe('火攻');
    // 仅♥牌可弃
    expect(P1.respondableCards().map((c) => c.id)).toEqual(['m1']);
    await P1.respond('火攻', { cardId: 'm1' });

    // P2 扣 1 血
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 火攻牌 + 弃牌进弃牌堆;展示牌仍在 P2 手牌
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['hg', 'm1']));
    expect(harness.state.players[1].hand).toContain('r1');
    expect(harness.state.zones.processing).toEqual([]);

    // 验证造成的是火焰伤害
    const damageEvents = harness.state.atomHistory.filter(
      (e): e is typeof e & { kind: 'atom'; atom: Record<string, unknown> } =>
        e.kind === 'atom' && (e.atom as Record<string, unknown>).type === '受到伤害时',
    );
    const lastDamage = damageEvents[damageEvents.length - 1].atom;
    expect(lastDamage.damageType).toBe('火焰');

    // view 级断言
    P2.processEvents();
    P2.expectView((v) => expect(v.players[1].health).toBe(p2HealthBefore - 1));
  });

  // ─── 2. 正面:使用者不弃(pass)→ 无伤害 ───────────────────────────
  it('P1 火攻 P2 → P2 展示♥ → P1 pass(不弃)→ 无伤害', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const match = makeCard('m1', '桃', '♥', '5');
    const reveal = makeCard('r1', '杀', '♥', '3');
    const state = buildState({
      p1Hand: ['hg', 'm1'],
      p2Hand: ['r1'],
      extraCards: { hg, m1: match, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('火攻', 'hg', [1]);
    await P1.pass(); // 无懈
    P2.expectPending('请求回应');
    await P2.respond('火攻', { cardId: 'r1' }); // 展示♥
    P1.expectPending('请求回应'); // 火攻/弃牌
    await P1.pass(); // 不弃

    // 无伤害
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
    // 火攻牌进弃牌堆;m1 仍在 P1 手牌
    expect(harness.state.zones.discardPile).toContain('hg');
    expect(harness.state.players[0].hand).toContain('m1');
  });

  // ─── 3. 正面:使用者无同花色手牌 → 不询问弃牌 → 无伤害 ─────────────
  it('P1 火攻 P2 → P2 展示♥ → P1 无♥手牌 → 无弃牌窗口 → 无伤害', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const other = makeCard('o1', '杀', '♠', '5'); // P1 只有黑牌
    const reveal = makeCard('r1', '杀', '♥', '3');
    const state = buildState({
      p1Hand: ['hg', 'o1'],
      p2Hand: ['r1'],
      extraCards: { hg, o1: other, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('火攻', 'hg', [1]);
    await P1.pass(); // 无懈
    P2.expectPending('请求回应');
    await P2.respond('火攻', { cardId: 'r1' }); // 展示♥

    // P1 无♥ → 不询问弃牌,直接结束(无 pending)
    P1.expectNoPending();
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
    expect(harness.state.zones.discardPile).toContain('hg');
  });

  // ─── 4. 正面:弃牌窗口拒绝不同花色 ────────────────────────────────
  it('P1 火攻 P2 → P2 展示♥ → P1 试图弃♦(不同花色)被拒', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const heart = makeCard('h1', '桃', '♥', '5');
    const diamond = makeCard('d1', '桃', '♦', '7'); // ♦ 不同花色
    const reveal = makeCard('r1', '杀', '♥', '3');
    const state = buildState({
      p1Hand: ['hg', 'h1', 'd1'],
      p2Hand: ['r1'],
      extraCards: { hg, h1: heart, d1: diamond, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('火攻', 'hg', [1]);
    await P1.pass(); // 无懈
    P2.expectPending('请求回应');
    await P2.respond('火攻', { cardId: 'r1' }); // 展示♥

    P1.expectPending('请求回应'); // 火攻/弃牌,仅♥可弃
    // 试图弃♦被拒
    await P1.expectRejected({ skillId: '火攻', actionType: 'respond', params: { cardId: 'd1' } });
    // 正确弃♥
    await P1.respond('火攻', { cardId: 'h1' });
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 5. 负面:目标无手牌 → 拒绝 ────────────────────────────────────
  it('目标无手牌 → 火攻被拒', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const state = buildState({
      p1Hand: ['hg'],
      p2Hand: [],
      extraCards: { hg },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '火攻',
      actionType: 'use',
      params: { cardId: 'hg', targets: [1] },
    });
  });

  // ─── 6. 正面:对自己使用火攻 → 自扣1血(火焰伤害) ───────────────────
  it('P1 对自己使用火攻 → 自己展示♥ → 自己弃♥ → 自扣1血', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const other = makeCard('o1', '杀', '♥', '5'); // P1 弃的♥
    const reveal = makeCard('r1', '桃', '♥', '3'); // P1 展示的♥
    const state = buildState({
      p1Hand: ['hg', 'o1', 'r1'],
      p2Hand: ['x1'],
      extraCards: { hg, o1: other, r1: reveal, x1: makeCard('x1', '闪', '♠', '4') },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const p1HealthBefore = harness.state.players[0].health;

    // 火攻目标自己(P1)
    await P1.useCardAndTarget('火攻', 'hg', [0]);
    // 无懈窗口 → pass
    P1.expectPending('请求回应');
    await P1.pass();

    // P1 自己被询问展示一张手牌(火攻/展示, target=P1)
    P1.expectPending('请求回应');
    await P1.respond('火攻', { cardId: 'r1' });

    // P1 自己被询问弃一张同花色♥手牌(火攻/弃牌, source=P1)
    P1.expectPending('请求回应');
    await P1.respond('火攻', { cardId: 'o1' });

    // P1 自扣 1 血(火焰伤害)
    expect(harness.state.players[0].health).toBe(p1HealthBefore - 1);
    // 火攻牌 + 弃牌进弃牌堆;展示牌仍在 P1 手牌
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['hg', 'o1']));
    expect(harness.state.players[0].hand).toContain('r1');
  });

  // ─── 7. 投影层 candidates 下发(Bug7)─────────────────────────────
  // 火攻/弃牌 的请求回应 cardFilter.filter 是函数(c.suit===revealedSuit),
  // 跨 WebSocket 序列化会丢失。前端依赖引擎投影层(buildView / 请求回应.toViewEvents)
  // 下发的 cardFilter.candidates(合法手牌 id 列表)才能渲染可弃牌。
  // 断言:在火攻/弃牌窗口,buildView(P1) 的 pending.prompt.cardFilter.candidates
  //      必须包含 P1 的同花色(♥)手牌 id,且不包含不同花色(♦)手牌 id。
  it('投影层下发火攻/弃牌 candidates:P1 弃牌窗口 candidates 含♥牌、不含♦牌', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const heart = makeCard('h1', '桃', '♥', '5'); // P1 可弃的♥
    const diamond = makeCard('d1', '杀', '♦', '7'); // P1 不同花色♦(不可弃)
    const reveal = makeCard('r1', '杀', '♥', '3'); // P2 展示的♥
    const state = buildState({
      p1Hand: ['hg', 'h1', 'd1'],
      p2Hand: ['r1'],
      extraCards: { hg, h1: heart, d1: diamond, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('火攻', 'hg', [1]);
    await P1.pass(); // 无懈
    P2.expectPending('请求回应');
    await P2.respond('火攻', { cardId: 'r1' }); // P2 展示♥

    // 现在轮到 P1 弃牌(火攻/弃牌窗口)。P1 的 hg 已用出,h1(♥)/d1(♦)在手。
    P1.expectPending('请求回应');

    // 全量投影(buildView / 重连路径)
    const fullView = buildView(harness.state, 0);
    expect(fullView.pending).not.toBeNull();
    const fullCands = (
      fullView.pending?.prompt as { cardFilter?: { candidates?: string[] } } | undefined
    )?.cardFilter?.candidates;
    expect(Array.isArray(fullCands)).toBe(true);
    expect(fullCands).toContain('h1'); // ♥可弃
    expect(fullCands).not.toContain('d1'); // ♦不可弃

    // 增量投影(processedView / 事件流 applyView 路径)
    P1.processEvents();
    P1.expectView((v) => {
      const incrCands = (
        v.pending?.prompt as { cardFilter?: { candidates?: string[] } } | undefined
      )?.cardFilter?.candidates;
      expect(Array.isArray(incrCands)).toBe(true);
      expect(incrCands).toContain('h1');
      expect(incrCands).not.toContain('d1');
    });

    // 使用者实际弃该♥牌 → 造成火焰伤害
    await P1.respond('火攻', { cardId: 'h1' });
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 8. 投影层 candidates 下发:展示窗口(任意手牌)────────────────
  // 火攻/展示 的 filter=()=>true,candidates 应为目标全部手牌。
  it('投影层下发火攻/展示 candidates:目标展示窗口 candidates 为全部手牌', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const heart = makeCard('h1', '桃', '♥', '5');
    const state = buildState({
      p1Hand: ['hg', 'h1'],
      p2Hand: ['r1', 'r2'],
      extraCards: {
        hg,
        h1: heart,
        r1: makeCard('r1', '杀', '♥', '3'),
        r2: makeCard('r2', '闪', '♠', '4'),
      },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('火攻', 'hg', [1]);
    await P1.pass(); // 无懈

    // P2 被询问展示一张手牌(火攻/展示, filter=()=>true)
    P2.expectPending('请求回应');

    // 全量投影:candidates 应为 P2 全部手牌
    const fullView = buildView(harness.state, 1);
    expect(fullView.pending).not.toBeNull();
    const fullCands = (
      fullView.pending?.prompt as { cardFilter?: { candidates?: string[] } } | undefined
    )?.cardFilter?.candidates;
    expect(fullCands).toEqual(['r1', 'r2']);
  });
});
