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
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
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

    // 摸 4 张,但据守要求弃 1 张手牌(目前 pending 中等回应)
    // 因初始无手牌 → 跳过弃置 → 净增 4 张
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

  // ─── 8. 正面:不跳过整回合(据守发动者下回合仍正常游戏) ────────────────
  // 验证 OL 加强版"不跳过整回合":据守不添加 据守/翻面 标签,
  // 故据守发动者下一回合不会被 skipAll 机制跳过。
  // 这里直接断言据守发动后无翻面相关 localVars / tags 残留。
  it('正面:据守发动后无 skipAll/skipTag 残留 → 下一回合不被跳过', async () => {
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

    // 据守发动后:无 翻面 标签(不会触发 skipAll)
    expect(harness.state.players[0].tags).not.toContain('据守/翻面');
    // 无 skipAll 标志(下一回合阶段 hook 不会 cancel)
    expect(harness.state.localVars['据守/skipAll']).toBeUndefined();

    // 模拟进入下一回合:P1 的准备阶段开始 → 不应被 cancel
    // 推进到 P2 回合再回到 P1(下一轮)
    await applyAtom(harness.state, { type: '清过期标记', player: 0 });
    await applyAtom(harness.state, { type: '下一玩家' });
    await applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    harness.processAllEvents();

    // cPI 已推进到 P2(若据守错误地跳过整回合,cPI 可能保持 0 或异常推进)
    expect(harness.state.currentPlayerIndex).toBe(1);
  });
});
