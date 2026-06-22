// tests/skill-tests/无中生有.test.ts
// 无中生有(普通锦囊):出牌阶段对自己使用,摸两张牌。
//
// 完整行为测试覆盖:
//   正面:
//     1. useCard 后 → expectPending('请求回应') 无懈可击窗口
//        → respondInfo() 推导 skillId='无懈可击' + cardFilter 仅接受无懈可击
//        → P2 有无懈可击时,respondableCards() 包含
//        → pass() 后,摸 2 张,锦囊进弃牌堆
//   负面(expectRejected):
//     - 非出牌阶段(准备/判定/摸牌/弃牌/回合结束)
//     - pending 期间出
//     - 牌不在手
//     - 非自己回合
//     - 牌名不是无中生有
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
    equipment: {},
    skills: opts.skills ?? ['无中生有'],
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
  p1Skills?: string[];
  p2Skills?: string[];
  phase?: TurnPhase;
  extraCards?: Record<string, Card>;
}): GameState {
  const wz = makeCard('wz1', '无中生有', '♥', '7');
  const cards: Record<string, Card> = { wz1: wz, ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? ['wz1'], skills: opts?.p1Skills ?? ['无中生有'] }),
      makePlayer({ index: 1, name: 'P2', hand: opts?.p2Hand, skills: opts?.p2Skills }),
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: opts?.phase ?? '出牌',
    turn: { round: 1, phase: opts?.phase ?? '出牌', vars: {} },
  });
}

describe('无中生有', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 正面:摸2张 + pending/respondInfo 全链路
  // ─────────────────────────────────────────────────────────────
  it('P1 对自己使用无中生有 → expectPending(请求回应) + pass 后摸 2 张', async () => {
    const c1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const c2 = makeCard('d2', '闪', '♥', '6', '基本牌');
    const state = buildState({ extraCards: { d1: c1, d2: c2 } });
    // 牌堆顶:d1, d2
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    // P2 加载 无懈可击 skill,以便 respondInfo 推导出 cardFilter
    state.players[1].skills = ['无懈可击'];
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const handBefore = harness.state.players[0].hand.length; // 1

    await P1.useCard('无中生有', 'wz1');

    // useCard 后立即:进入"无懈可击"请求回应窗口(broadcast target=-2)
    P1.expectPending('请求回应');
    const info = P2.respondInfo();
    expect(info).not.toBeNull();
    expect(info!.skillId).toBe('无懈可击');
    // cardFilter 存在(无懈可击的 onMount respond 定义)
    expect(info!.cardFilter).toBeDefined();
    // P2 手里没有无懈可击 → respondableCards 为空
    expect(P2.respondableCards()).toEqual([]);

    // pass 消耗无懈窗口
    await P1.pass();

    // P1 起手 1 张 (wz1),出牌 → 摸 2 张 → 净 +1
    expect(harness.state.players[0].hand.length).toBe(handBefore + 1);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['d1', 'd2']));
    // 无中生有进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wz1');
    expect(harness.state.zones.processing).not.toContain('wz1');
    // 牌堆 -2
    expect(harness.state.zones.deck).not.toContain('d1');
    expect(harness.state.zones.deck).not.toContain('d2');
    // view 级断言:P1 视角手牌含 d1/d2 + 无 pending
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].hand!.map(c => c.id)).toEqual(expect.arrayContaining(['d1', 'd2']));
      expect(v.players[0].handCount).toBe(handBefore + 1);
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 1b. 正面:对方有无懈可击时,cardFilter 过滤正确
  // ─────────────────────────────────────────────────────────────
  it('P2 手中有无懈可击时,respondableCards 仅包含无懈可击', async () => {
    const wz = makeCard('wz1', '无中生有', '♥', '7');
    const wx = makeCard('wx1', '无懈可击', '♠', 'J', '锦囊牌');
    const slash = makeCard('s1', '杀', '♠', '5', '基本牌');
    const state = buildState({
      p2Hand: ['wx1', 's1'],
      p2Skills: ['无懈可击', '杀'],
      extraCards: { wx1: wx, s1: slash },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCard('无中生有', 'wz1');

    // P2 视角:pending 是 broadcast(target=-2),respondInfo 也能推导
    P2.expectPending('请求回应');
    const info = P2.respondInfo();
    expect(info?.skillId).toBe('无懈可击');
    // P2 手牌 [wx1, s1] → respondableCards 仅 wx1
    const cards = P2.respondableCards();
    expect(cards.map(c => c.id)).toEqual(['wx1']);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. validate 拒绝:非出牌阶段(全部 5 个阶段)
  // ─────────────────────────────────────────────────────────────
  it('非出牌阶段(准备阶段)使用无中生有 → 被拒绝', async () => {
    await harness.setup(buildState({ phase: '准备' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  it('非出牌阶段(判定阶段)使用无中生有 → 被拒绝', async () => {
    await harness.setup(buildState({ phase: '判定' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  it('非出牌阶段(摸牌阶段)使用无中生有 → 被拒绝', async () => {
    await harness.setup(buildState({ phase: '摸牌' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  it('非出牌阶段(弃牌阶段)使用无中生有 → 被拒绝', async () => {
    await harness.setup(buildState({ phase: '弃牌' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  it('非出牌阶段(回合结束)使用无中生有 → 被拒绝', async () => {
    await harness.setup(buildState({ phase: '回合结束' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. validate 拒绝:pending 期间(防死锁)
  // ─────────────────────────────────────────────────────────────
  it('pending 期间使用无中生有 → 被拒绝(防死锁)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const dodge = makeCard('d1', '闪', '♥', '5', '基本牌');
    const state = buildState({
      p1Hand: ['wz1', 's1'],
      p2Hand: ['d1'],
      p1Skills: ['无中生有', '杀'],
      p2Skills: ['闪'],
      extraCards: { s1: slash, d1: dodge },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.useCardAndTarget('杀', 's1', [1]);
    // pending 期间(询问闪)再出无中生有应被拒
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:牌不在手
  // ─────────────────────────────────────────────────────────────
  it('出不在手牌的无中生有 → 被拒绝', async () => {
    const state = buildState({ p1Hand: [] });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:非自己回合
  // ─────────────────────────────────────────────────────────────
  it('非自己回合使用无中生有 → 被拒绝', async () => {
    await harness.setup(buildState());
    const P2 = harness.player('P2');
    await P2.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. validate 拒绝:牌名错
  // ─────────────────────────────────────────────────────────────
  it('用杀当无中生有出 → 被拒绝(cardNameOk=false)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p1Hand: ['s1'],
      extraCards: { s1: slash },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 's1' },
    });
  });
});