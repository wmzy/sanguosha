// tests/skill-tests/据守.test.ts
// 据守(曹仁·主动技)测试:结束阶段,翻面并摸四张牌,然后弃置一张手牌
//   (若为装备牌则改为使用之)。
//
// 对齐官方 hero/29 现行描述(OL 加强版):不跳过整回合。
//
// 验证:
//   1. 正面:发动据守 → 摸 4 张 + 标记已用 + 无翻面标签(不跳过整回合)
//   2. 正面:在 回合结束 阶段发动也可以
//   3. 正面:选非装备手牌 → 弃置该牌(进弃牌堆)
//   4. 正面:选装备牌 → 装备到对应栏位
//   5. 正面:无手牌时跳过弃置步骤(只摸 4 张)
//   6. 负面:出牌阶段发动 → 拒绝(非结束阶段)
//   7. 负面:已使用过 → 拒绝
//   8. 正面:不跳过整回合(下一回合 cPI 推进到下家,但据守发动者不会因据守被跳过)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
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

function makeWeapon(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  range: number,
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype: '武器', range };
}

function makeArmor(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype: '防具' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '曹仁',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['据守'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function buildDeck(cardMap: Record<string, Card>, n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `dk${i}`;
    cardMap[id] = makeCard(id, '杀', '♠', String(i + 2));
    ids.push(id);
  }
  return ids;
}

describe('据守', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:摸 4 张 + 标记已用 + 不跳过整回合 ────────────────
  it('正面:发动据守 → 摸 4 张 + 标记已用 + 无翻面标签', async () => {
    const cardMap: Record<string, Card> = {};
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();
    harness.processAllEvents();

    // 摸 4 张。实现:摸牌后手牌非空 → 创建 据守/弃牌 pending(见用例 5);
    // 本用例不回应,故 use execute 挂在 pending 上,手牌暂保持 4(弃置尚未发生)。
    expect(harness.state.players[0].hand.length).toBe(4);
    // 无翻面标签(OL 加强版不跳过整回合)
    expect(harness.state.players[0].tags).not.toContain('据守/翻面');
    // 已用标记
    expect(harness.state.players[0].vars['据守/usedThisTurn']).toBe(true);
  });

  // ─── 2. 正面:回合结束 阶段也可发动 ────────────────
  it('正面:在 回合结束 阶段发动也可以', async () => {
    const cardMap: Record<string, Card> = {};
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].hand.length).toBe(4);
  });

  // ─── 3. 正面:选非装备手牌 → 弃置该牌 ────────────────
  it('正面:选非装备手牌 → 该牌进入弃牌堆,手牌=初始1+摸4-弃1=4', async () => {
    const base: Card = makeCard('base0', '闪', '♥', '2');
    const cardMap: Record<string, Card> = { base0: base };
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['base0'], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();

    // 据守/弃牌 pending 应出现
    const slot = harness.state.pendingSlots.get(0);
    expect(slot).toBeDefined();
    const rt = (slot?.atom as { requestType?: string }).requestType;
    expect(rt).toBe('据守/弃牌');

    // 选 base0(非装备)弃置
    await P1.respond('据守', { cardId: 'base0' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 初始 1 + 摸 4 - 弃 1 = 4
    expect(harness.state.players[0].hand.length).toBe(4);
    // base0 进入弃牌堆
    expect(harness.state.zones.discardPile).toContain('base0');
    // base0 不再在手中
    expect(harness.state.players[0].hand).not.toContain('base0');
  });

  // ─── 4. 正面:选装备牌 → 装备到对应栏位 ────────────────
  it('正面:选装备牌 → 装备到对应栏位(非弃置)', async () => {
    const weapon = makeWeapon('wp1', '诸葛连弩', '♣', 1);
    const cardMap: Record<string, Card> = { wp1: weapon };
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wp1'], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();

    // 选 wp1(装备牌)→ 应装备而非弃置
    await P1.respond('据守', { cardId: 'wp1' });
    await harness.waitForStable();
    harness.processAllEvents();

    // wp1 在装备区(武器栏)
    expect(harness.state.players[0].equipment['武器']).toBe('wp1');
    // wp1 不在弃牌堆
    expect(harness.state.zones.discardPile).not.toContain('wp1');
    // wp1 不在手中(已装备)
    expect(harness.state.players[0].hand).not.toContain('wp1');
    // 手牌 = 摸 4(装备牌没回手)
    expect(harness.state.players[0].hand.length).toBe(4);
  });

  // ─── 4b. 正面:防具装备牌 → 装备到防具栏 ────────────────
  it('正面:选防具装备牌 → 装备到防具栏', async () => {
    const armor = makeArmor('ar1', '八卦阵', '♣', '2');
    const cardMap: Record<string, Card> = { ar1: armor };
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['ar1'], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();
    await P1.respond('据守', { cardId: 'ar1' });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].equipment['防具']).toBe('ar1');
    expect(harness.state.zones.discardPile).not.toContain('ar1');
  });

  // ─── 5. 正面:空手时仍触发弃置(因为已摸 4 张) ────────────────
  // 实现细节:弃置检查发生在 摸牌 之后,故空手 → 摸 4 → 仍需弃 1。
  // 此处验证 OL 加强版正确流程:空手发动据守,仍要走完弃置窗口。
  it('正面:空手发动据守 → 摸 4 后产生 据守/弃牌 pending(仍需弃 1)', async () => {
    const cardMap: Record<string, Card> = {};
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();

    // 摸 4 张
    expect(harness.state.players[0].hand.length).toBe(4);
    // 据守/弃牌 pending 应出现(摸 4 后手牌非空)
    const slot = harness.state.pendingSlots.get(0);
    expect(slot).toBeDefined();
    const rt = (slot?.atom as { requestType?: string }).requestType;
    expect(rt).toBe('据守/弃牌');

    // 选第一张(非装备)弃置
    const firstCard = harness.state.players[0].hand[0];
    await P1.respond('据守', { cardId: firstCard });
    await harness.waitForStable();
    harness.processAllEvents();

    // 弃完后手牌 = 3
    expect(harness.state.players[0].hand.length).toBe(3);
    expect(harness.state.zones.discardPile).toContain(firstCard);
  });

  // ─── 6. 负面:出牌阶段发动 → 拒绝(非结束阶段) ────────────────
  it('负面:出牌阶段发动 → 拒绝(非结束阶段)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '据守', actionType: 'use', params: {} });
    // 无翻面标签
    expect(harness.state.players[0].tags).not.toContain('据守/翻面');
  });

  // ─── 7. 负面:已使用过 → 拒绝 ────────────────
  it('负面:已使用过 → 拒绝', async () => {
    const cardMap: Record<string, Card> = {};
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次发动(成功)
    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.players[0].vars['据守/usedThisTurn']).toBe(true);

    // 第二次发动(拒绝)
    await P1.expectRejected({ skillId: '据守', actionType: 'use', params: {} });
  });

  // ─── 8. 正面:OL 加强版不跳过整回合(完整结算后无翻面/跳过残留) ────────
  // 标版据守对齐 OL 加强版:不添加 据守/翻面 标签、不设 据守/skipAll 标志
  // (跳过整回合机制仅界据守等保留)。本用例让据守完整结算(回应弃牌,
  // 不留悬挂 frame/pending)后,断言无任何翻面/跳过相关残留作为回归守卫。
  it('正面:据守完整结算后无 翻面/skipAll 残留(OL 加强版不跳过整回合)', async () => {
    const cardMap: Record<string, Card> = {};
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();

    // 据守/弃牌 pending 出现 → 回应弃一张,让据守完整结算(不悬挂 frame/pending)
    const slot = harness.state.pendingSlots.get(0);
    expect(slot).toBeDefined();
    expect((slot?.atom as { requestType?: string }).requestType).toBe('据守/弃牌');
    await P1.respond('据守', { cardId: harness.state.players[0].hand[0] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 完整结算后:无 据守/翻面 标签(下一回合准备阶段 before-hook 不会启动跳过)
    expect(harness.state.players[0].tags).not.toContain('据守/翻面');
    // 无 据守/skipAll 标志(下一回合阶段 hook 不会 cancel)
    expect(harness.state.localVars['据守/skipAll']).toBeUndefined();
  });

  // ─── 回归(2026-08-26):「摸四弃一」的弃一是强制代价 ────────────────
  // 此前无 mandatory 且 respond 对空响应放行、超时也无兜底 → 玩家点「不回应」
  // 或超时即可白摸四张。修复:mandatory:true + 兜底自动弃首张。
  it('强制弃牌:空响应({})→ 兜底自动弃手牌首张,不可白摸四张', async () => {
    const base: Card = makeCard('base0', '闪', '♥', '2');
    const cardMap: Record<string, Card> = { base0: base };
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['base0'], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();

    // 弃牌询问带 mandatory 标记(前端隐藏「不回应」+ 走多选 UI 契约)
    const slot = harness.state.pendingSlots.get(0) as {
      atom?: { requestType?: string; mandatory?: boolean };
    };
    expect(slot?.atom?.requestType).toBe('据守/弃牌');
    expect(slot?.atom?.mandatory).toBe(true);

    // 空响应(浏览器旧「不回应」形状 {} / 超时 pass 同路径)→ 兜底仍须弃一张
    await P1.respond('据守', {});
    await harness.waitForStable();
    harness.processAllEvents();

    // 初始 1 + 摸 4 - 弃 1 = 4(bug 下为 5)
    expect(harness.state.players[0].hand.length).toBe(4);
    // 兜底弃的是手牌首张(base0)
    expect(harness.state.zones.discardPile).toContain('base0');
    expect(harness.state.players[0].hand).not.toContain('base0');
  });

  // 界据守同款回归:摸四后的弃一同样不可被空响应/超时绕过
  it('界据守:空响应({})→ 兜底自动弃手牌首张', async () => {
    const base: Card = makeCard('base0', '闪', '♥', '2');
    const cardMap: Record<string, Card> = { base0: base };
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['base0'], skills: ['界据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界据守', 'use', {});
    await harness.waitForStable();

    const slot = harness.state.pendingSlots.get(0) as {
      atom?: { requestType?: string; mandatory?: boolean };
    };
    expect(slot?.atom?.requestType).toBe('界据守/弃牌');
    expect(slot?.atom?.mandatory).toBe(true);

    await P1.respond('界据守', {});
    await harness.waitForStable();
    harness.processAllEvents();

    // 初始 1 + 摸 4 - 弃 1 = 4(bug 下为 5)
    expect(harness.state.players[0].hand.length).toBe(4);
    expect(harness.state.zones.discardPile).toContain('base0');
  });

  // ─── 回归(2026-08-27):mandatory 多选弃牌 UI 的 {cardIds} 形状 ────
  // 浏览器 usePendingState(强制弃牌 UI)与 HeadlessGameClient 对该 pending 提交
  // {cardIds:[x]} 数组,respond execute 旧实现只读 params.cardId 单数 → 选择被
  // 静默忽略、恒走兜底弃首张。修复:归一化双形状 + 归属校验。
  it('强制弃牌:respond({cardIds:[非首张手牌]}) → 恰弃所选牌(浏览器多选 UI 形状)', async () => {
    const base: Card = makeCard('base0', '闪', '♥', '2');
    const extra: Card = makeCard('extra0', '杀', '♠', '3');
    const cardMap: Record<string, Card> = { base0: base, extra0: extra };
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['base0', 'extra0'], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();

    // 摸 4 后手牌 = [base0, extra0, dk0..dk3];用 {cardIds} 形状选非首张 extra0
    await P1.respond('据守', { cardIds: ['extra0'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 恰弃所选的 extra0(修复前:cardIds 被忽略 → 兜底弃首张 base0)
    expect(harness.state.zones.discardPile).toContain('extra0');
    expect(harness.state.players[0].hand).not.toContain('extra0');
    expect(harness.state.players[0].hand).toContain('base0');
    expect(harness.state.zones.discardPile).not.toContain('base0');
    // 初始 2 + 摸 4 - 弃 1 = 5
    expect(harness.state.players[0].hand.length).toBe(5);
  });

  it('强制弃牌:respond({cardIds:[他人牌]}) → 归属守卫拦截,兜底弃手牌首张', async () => {
    const mine: Card = makeCard('mine0', '闪', '♥', '2');
    const others: Card = makeCard('others0', '杀', '♠', '3');
    const cardMap: Record<string, Card> = { mine0: mine, others0: others };
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['mine0'], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['others0'], skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();

    // 异常客户端注入他人牌 id → 不得写入选择 → 兜底弃自己手牌首张
    await P1.respond('据守', { cardIds: ['others0'] });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.zones.discardPile).toContain('mine0');
    expect(harness.state.zones.discardPile).not.toContain('others0');
    // P2 的牌未被复制/移动
    expect(harness.state.players[1].hand).toContain('others0');
  });

  it('界据守:respond({cardIds:[非首张装备牌]}) → 装备所选牌(而非兜底弃首张)', async () => {
    const keep: Card = makeCard('keep0', '闪', '♥', '2');
    const weapon = makeWeapon('wp9', '诸葛连弩', '♣', 1);
    const cardMap: Record<string, Card> = { keep0: keep, wp9: weapon };
    const deck = buildDeck(cardMap, 6);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['keep0', 'wp9'], skills: ['界据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界据守', 'use', {});
    await harness.waitForStable();

    // 摸 4 后手牌 = [keep0, wp9, dk0..dk3];{cardIds} 形状选非首张装备牌 wp9
    await P1.respond('界据守', { cardIds: ['wp9'] });
    await harness.waitForStable();
    harness.processAllEvents();

    // 所选装备牌被使用(武器栏),首张 keep0 保留在手(修复前:忽略选择 → 弃首张 keep0)
    expect(harness.state.players[0].equipment['武器']).toBe('wp9');
    expect(harness.state.players[0].hand).toContain('keep0');
    expect(harness.state.zones.discardPile).not.toContain('keep0');
    expect(harness.state.zones.discardPile).not.toContain('wp9');
    // 初始 2 + 摸 4 - 装备 1 = 5
    expect(harness.state.players[0].hand.length).toBe(5);
  });
});
