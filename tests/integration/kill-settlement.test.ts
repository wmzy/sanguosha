// 杀的完整结算流程测试:出杀→询问闪→出闪/不出闪→伤害/miss→处理区清理
import { applyAtom, frameCards } from '../../src/engine/index';
import { SHORT_DELAY_MS } from '../../src/engine/card-response-availability';
import { fireTimeoutAndWait, waitForStable } from '../engine-harness';
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function build(opts?: {
  p1Hand?: string[];
  p2Hand?: string[];
  extraCards?: Record<string, Card>;
}): GameState {
  const slash: Card = { id: 's0', name: '杀', suit: '♠', color: '黑', rank: 'A', type: '基本牌' };
  const cards: Record<string, Card> = { s0: slash, ...opts?.extraCards };
  return createGameState({
    players: [
      {
        index: 0,
        name: 'P1',
        character: '主公',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: ['s0'],
        equipment: {},
        skills: ['杀'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '反',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: opts?.p2Hand ?? [],
        equipment: {},
        skills: ['闪'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('杀完整结算流程', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('出杀→P2 不出闪→扣1血→杀牌进弃牌堆→处理区清空', async () => {
    const dodge: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['d1'], extraCards: { d1: dodge } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's0', [1]);
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪

    expect(harness.state.players[1].health).toBe(3);
    // 杀牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('s0');
    // 处理区清空
    expect(frameCards(harness.state)).toEqual([]);
  });

  it('出杀→P2 出闪→不扣血→杀和闪都进弃牌堆→处理区清空', async () => {
    const dodge: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['d1'], extraCards: { d1: dodge } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's0', [1]);
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });

    expect(harness.state.players[1].health).toBe(4); // 不扣血
    expect(harness.state.zones.discardPile).toContain('s0');
    expect(harness.state.zones.discardPile).toContain('d1');
    expect(frameCards(harness.state)).toEqual([]);
    // P2 手牌减少(出了闪)
    expect(harness.state.players[1].hand.length).toBe(0);
  });

  it('BUG验证:被询问闪时不能 respond 杀(P2有杀技能)', async () => {
    // P2 同时有杀和闪技能,手牌只有杀
    const slash2: Card = {
      id: 's2',
      name: '杀',
      suit: '♣',
      color: '黑',
      rank: '5',
      type: '基本牌',
    };
    await harness.setup(build({ p2Hand: ['s2'], extraCards: { s2: slash2 } }));
    // 手动给 P2 加杀技能
    harness.state.players[1].skills.push('杀');
    harness.rebuildViews();
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's0', [1]);
    P2.expectPending('询问闪');
    // P2 尝试用杀 respond(应该被拒绝——当前是询问闪不是询问杀)
    await P2.expectRejected({ skillId: '杀', actionType: 'respond', params: { cardId: 's2' } });
    // 处理区应该只有杀牌(没被污染)
    expect(frameCards(harness.state)).toEqual(['s0']);
    // 询问闪仍在
    P2.expectPending('询问闪');
  });

  it('出杀后处理区状态:只有杀牌(无其他泄漏)', async () => {
    const dodge: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['d1'], extraCards: { d1: dodge } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's0', [1]);
    // 询问闪期间(P2 有闪 → normal),处理区应该只有杀牌
    expect(frameCards(harness.state)).toEqual(['s0']);
    await P2.pass();
    // 结算后处理区清空
    expect(frameCards(harness.state)).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────
  // 卡牌回应型询问优化:询问闪 的 skip / silent / normal 三模式
  // ─────────────────────────────────────────────────────────────
  it('询问闪 normal:P2 有闪 → 正常询问(可操作 useCard prompt),出闪不扣血', async () => {
    const dodge: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['d1'], extraCards: { d1: dodge } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's0', [1]);
    // normal:创建 slot,target 看到可操作 useCard prompt + responseMode='normal'
    expect(harness.state.pendingSlots.size).toBe(1);
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { type: string }).type).toBe('询问闪');
    // 走正常超时缩放(不是 SHORT_DELAY_MS)
    expect(slot.resolvedTimeoutMs).not.toBe(SHORT_DELAY_MS);
    expect(P2.processedView.pending?.responseMode).toBe('normal');
    expect(P2.processedView.pending?.prompt.type).toBe('useCard');

    await P2.respond('闪', { cardId: 'd1' });
    expect(harness.state.players[1].health).toBe(4); // 出闪不扣血
  });

  it('询问闪 silent:P2 有手牌但无闪 → 不被询问(观察型 pending)+ 短延时后扣血', async () => {
    // P2 手牌为一张杀(非闪):有手牌但无匹配响应牌 → silent
    const kill: Card = { id: 'k1', name: '杀', suit: '♣', color: '黑', rank: '5', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['k1'], extraCards: { k1: kill } }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const healthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('杀', 's0', [1]);
    // silent:仍创建 slot(短延时),但 target 看到观察型 prompt(不可操作),无 responseMode='normal'
    expect(harness.state.pendingSlots.size).toBe(1);
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { type: string }).type).toBe('询问闪');
    expect(slot.resolvedTimeoutMs).toBe(SHORT_DELAY_MS); // 固定短延时,不走 timeoutScale
    // target(P2)不被询问:prompt 是观察型 confirm,不是可操作 useCard
    expect(P2.processedView.pending?.responseMode).toBe('silent');
    expect(P2.processedView.pending?.prompt.type).toBe('confirm');
    // 其他人(P1)看到观察型 pending(短暂停顿)
    expect(P1.processedView.pending).not.toBeNull();
    expect(P1.processedView.pending?.target).toBe(1);
    // P2 仍持有该杀(未被强制出)
    expect(harness.state.players[1].hand).toContain('k1');

    // 短延时 slot 自然超时(pass 触发 fireTimeout)→ 不出闪 → 扣血
    await P2.pass();
    expect(harness.state.players[1].health).toBe(healthBefore - 1);
  });

  it('询问闪 skip:P2 0 手牌 → 不创建 slot、无延时,直接扣血', async () => {
    await harness.setup(build()); // P2 hand=[]
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const healthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('杀', 's0', [1]);
    // skip:无 slot、无延时(P2 手牌为 0 本就公开),直接进入伤害
    expect(harness.state.pendingSlots.size).toBe(0);
    // target 和其他人都看不到等待询问
    expect(P2.processedView.pending).toBeNull();
    expect(P1.processedView.pending).toBeNull();
    expect(harness.state.players[1].health).toBe(healthBefore - 1);
  });
});

// ─────────────────────────────────────────────────────────────
// 请求回应(useCard+cardFilter) 卡牌回应型:skip / silent / normal 三模式
// 直接驱动 请求回应 atom,验证 preResolve + toViewEvents + applyView + buildView 一致。
// ─────────────────────────────────────────────────────────────
describe('请求回应(useCard+cardFilter) 卡牌回应 skip/silent/normal', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 请求回应:要求 target 出杀(useCard+cardFilter.filter)。非广播、非 mandatory。
  const makeAskKill = (target: number) => ({
    type: '请求回应' as const,
    requestType: 'test/杀',
    target,
    prompt: {
      type: 'useCard' as const,
      title: '请出杀',
      cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
    },
  });

  it('normal:target 有杀 → 创建 slot(正常超时),target 看到可操作 prompt', async () => {
    const kill: Card = { id: 'k1', name: '杀', suit: '♣', color: '黑', rank: '5', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['k1'], extraCards: { k1: kill } }));
    const P2 = harness.player('P2');

    void applyAtom(harness.state, makeAskKill(1));
    await waitForStable(harness.state);
    harness.processAllEvents();

    expect(harness.state.pendingSlots.size).toBe(1);
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { type: string }).type).toBe('请求回应');
    expect(slot.resolvedTimeoutMs).not.toBe(SHORT_DELAY_MS); // 正常超时缩放
    expect(P2.processedView.pending?.responseMode).toBe('normal');
    expect(P2.processedView.pending?.prompt.type).toBe('useCard');

    await fireTimeoutAndWait(harness.state);
    harness.processAllEvents();
  });

  it('silent:target 有手牌但无杀 → 创建短延时 slot,target 不被询问(观察型 prompt)', async () => {
    const flash: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '5', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['d1'], extraCards: { d1: flash } }));
    const P2 = harness.player('P2');

    void applyAtom(harness.state, makeAskKill(1));
    await waitForStable(harness.state);
    harness.processAllEvents();

    expect(harness.state.pendingSlots.size).toBe(1);
    const slot = [...harness.state.pendingSlots.values()][0];
    expect(slot.resolvedTimeoutMs).toBe(SHORT_DELAY_MS); // 固定短延时,不走 timeoutScale
    // target 不被询问:观察型 confirm prompt + responseMode='silent'
    expect(P2.processedView.pending?.responseMode).toBe('silent');
    expect(P2.processedView.pending?.prompt.type).toBe('confirm');
    // target 仍持有原手牌(未被强制出)
    expect(harness.state.players[1].hand).toContain('d1');

    await fireTimeoutAndWait(harness.state);
    harness.processAllEvents();
  });

  it('skip:target 0 手牌 → 不创建 slot、无延时,applyAtom 立即返回', async () => {
    await harness.setup(build()); // P2 hand=[]
    const P2 = harness.player('P2');

    // skip 模式:applyAtom 不阻塞(无 slot),直接返回
    await applyAtom(harness.state, makeAskKill(1));
    harness.processAllEvents();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(P2.processedView.pending).toBeNull();
  });

  it('mandatory 不参与:强制弃牌(filter=()=>true)即使无手牌匹配也走正常询问', async () => {
    // mandatory + useCard:即使 target 有手牌无匹配,resolvedTimeoutMs 仍为正常超时(非 silent)
    const flash: Card = { id: 'd1', name: '闪', suit: '♥', color: '红', rank: '5', type: '基本牌' };
    await harness.setup(build({ p2Hand: ['d1'], extraCards: { d1: flash } }));
    const P2 = harness.player('P2');

    void applyAtom(harness.state, {
      type: '请求回应',
      requestType: 'test/弃',
      target: 1,
      prompt: {
        type: 'useCard',
        title: '强制弃牌',
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      mandatory: true,
    });
    await waitForStable(harness.state);
    harness.processAllEvents();

    expect(harness.state.pendingSlots.size).toBe(1);
    const slot = [...harness.state.pendingSlots.values()][0];
    // mandatory → preResolve 返回 null → 正常超时(非 SHORT_DELAY_MS)
    expect(slot.resolvedTimeoutMs).not.toBe(SHORT_DELAY_MS);
    // 非 silent:target 看到可操作 prompt(useCard),responseMode='normal'
    expect(P2.processedView.pending?.responseMode).toBe('normal');
    expect(P2.processedView.pending?.prompt.type).toBe('useCard');

    await fireTimeoutAndWait(harness.state);
    harness.processAllEvents();
  });
});
