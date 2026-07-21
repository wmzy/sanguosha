// 界自守(界刘表·群·主动技)测试:
//   摸牌阶段,你可以多摸X张牌,你以此法摸牌的结束阶段,
//   若你本回合对其他角色造成过伤害,你弃置X张牌(X为全场势力数)。
//
// 官方来源:OL 界限突破 hero/626。
//
// 验证:
//   1. 发动:摸牌阶段确认发动 → 多摸 X 张(X=势力数)
//   2. 不发动:不确认 → 正常摸 2 张
//   3. 弃牌惩罚:发动 + 本回合造成过伤害 → 结束阶段弃 X 张
//   4. 无伤害不弃:发动 + 未造成伤害 → 结束阶段不弃牌
//   5. 自伤不算:发动 + 自伤(无目标≠自己) → 不触发弃牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

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
  faction?: PlayerState['faction'];
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction,
  };
}

/** 当前唯一 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return null;
  return (slots[0].atom as unknown as { requestType?: string }).requestType ?? null;
}

/** __弃牌 pending 要求弃的牌数(cardFilter.min),无 __弃牌 返回 null */
function discardExcess(state: GameState): number | null {
  for (const slot of state.pendingSlots.values()) {
    const atom = slot.atom as {
      requestType?: string;
      prompt?: { cardFilter?: { min?: number } };
    };
    if (atom.requestType === '__弃牌') {
      return atom.prompt?.cardFilter?.min ?? null;
    }
  }
  return null;
}

/** 自守/弃牌 pending 要求弃的牌数(cardFilter.min),无则返回 null */
function zishouDiscardExcess(state: GameState): number | null {
  for (const slot of state.pendingSlots.values()) {
    const atom = slot.atom as {
      requestType?: string;
      prompt?: { cardFilter?: { min?: number } };
    };
    if (atom.requestType === '自守/弃牌') {
      return atom.prompt?.cardFilter?.min ?? null;
    }
  }
  return null;
}

describe('界自守', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 发动:摸牌阶段确认 → 多摸 X 张 ────────────────────
  it('发动自守:摸牌阶段多摸 X 张(X=势力数=2)', async () => {
    // 牌堆 5 张:正常摸 2 + 自守多摸 2 = 4
    const deck = [
      makeCard('d1', '杀', '♠', '2'),
      makeCard('d2', '闪', '♥', '3'),
      makeCard('d3', '桃', '♦', '4'),
      makeCard('d4', '酒', '♣', '5'),
      makeCard('d5', '杀', '♠', '6'),
    ];
    const cardMap: Record<string, Card> = {};
    for (const c of deck) cardMap[c.id] = c;

    // 2 势力:群(界刘表)/魏(P1)→ X = 2
    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界刘表',
            faction: '群',
            hand: [],
            skills: ['界自守', '回合管理'],
          }),
          makePlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['回合管理'],
          }),
        ],
        cardMap,
        zones: { deck: deck.map((c) => c.id), discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const P0 = harness.player('界刘表');

    const restoreAutoCompare = disableAutoCompare();

    // 开局 → 摸牌阶段 → 询问是否发动自守
    await P0.triggerAction('回合管理', 'start');
    expect(currentRequestType(harness.state)).toBe('自守/confirm');

    // 确认发动
    await P0.respond('界自守', { choice: true });
    await harness.waitForStable();

    // 验证:正常摸 2 + 自守 X=2 → 共摸 4 张
    expect(harness.state.players[0].hand.length).toBe(4);
    expect(harness.state.zones.deck.length).toBe(1);
    // ACTIVE 标记已设
    expect(harness.state.turn.vars['自守/active']).toBe(true);

    restoreAutoCompare();
  });

  // ─── 2. 不发动:不确认 → 正常摸 2 张 ────────────────────
  it('不发动自守:正常摸 2 张', async () => {
    const deck = [
      makeCard('d1', '杀', '♠', '2'),
      makeCard('d2', '闪', '♥', '3'),
      makeCard('d3', '桃', '♦', '4'),
    ];
    const cardMap: Record<string, Card> = {};
    for (const c of deck) cardMap[c.id] = c;

    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界刘表',
            faction: '群',
            hand: [],
            skills: ['界自守', '回合管理'],
          }),
          makePlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['回合管理'],
          }),
        ],
        cardMap,
        zones: { deck: deck.map((c) => c.id), discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const P0 = harness.player('界刘表');

    const restoreAutoCompare = disableAutoCompare();

    await P0.triggerAction('回合管理', 'start');
    expect(currentRequestType(harness.state)).toBe('自守/confirm');

    // 不发动
    await P0.respond('界自守', { choice: false });
    await harness.waitForStable();

    // 验证:正常摸 2 张
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.deck.length).toBe(1);
    expect(harness.state.turn.vars['自守/active']).toBeUndefined();

    restoreAutoCompare();
  });

  // ─── 3. 弃牌惩罚:发动 + 造成过伤害 → 结束阶段弃 X 张 ────
  it('弃牌惩罚:发动+对他人造成伤害 → 结束阶段弃 X 张', async () => {
    // 给刘表足够的初始手牌,使其在弃牌阶段后仍有牌可供自守弃置
    // 刘表 health=3, 界宗室手牌上限=3+2=5,初始 5 张 → 弃牌阶段不弃 → 结束阶段弃 2
    const hand = [
      makeCard('h1', '杀', '♠', '2'),
      makeCard('h2', '闪', '♥', '3'),
      makeCard('h3', '桃', '♦', '4'),
      makeCard('h4', '酒', '♣', '5'),
      makeCard('h5', '杀', '♠', '7'),
    ];
    const deck = [
      makeCard('d1', '杀', '♠', '8'),
      makeCard('d2', '闪', '♥', '9'),
      makeCard('d3', '桃', '♦', '10'),
      makeCard('d4', '酒', '♣', 'J'),
    ];
    const cardMap: Record<string, Card> = {};
    for (const c of [...hand, ...deck]) cardMap[c.id] = c;

    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界刘表',
            faction: '群',
            hand: hand.map((c) => c.id),
            skills: ['界自守', '界宗室', '回合管理', '杀'],
            health: 3,
            maxHealth: 3,
          }),
          makePlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['回合管理', '闪'],
            health: 3,
            maxHealth: 3,
          }),
        ],
        cardMap,
        zones: { deck: deck.map((c) => c.id), discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const P0 = harness.player('界刘表');
    const P1 = harness.player('P1');

    const restoreAutoCompare = disableAutoCompare();

    // 开局 → 摸牌阶段 → 发动自守(多摸 X=2)
    await P0.triggerAction('回合管理', 'start');
    await P0.respond('界自守', { choice: true });
    await harness.waitForStable();
    // 手牌 5+4=9 张(初始 5 + 摸 4)
    expect(harness.state.players[0].hand.length).toBe(9);

    // 出牌阶段:刘表对 P1 出杀,造成伤害 → 标记 damageDealt
    await P0.useCardAndTarget('杀', 'h1', [1]);
    await P1.pass(); // P1 不出闪
    await harness.waitForStable();
    expect(harness.state.turn.vars['自守/damageDealt']).toBe(true);

    // 结束出牌阶段 → 弃牌阶段 → 结束阶段
    // 弃牌阶段:手牌 8(9-1杀),上限=3+2=5,弃 3 张
    await P0.triggerAction('回合管理', 'end', {});
    await harness.waitForStable();

    // 弃牌阶段:需弃 3 张(8-5)
    expect(currentRequestType(harness.state)).toBe('__弃牌');
    expect(discardExcess(harness.state)).toBe(3);
    // 弃 3 张
    const discardCards = harness.state.players[0].hand.slice(0, 3);
    await P0.respond('系统规则', { cardIds: discardCards });
    await harness.waitForStable();

    // 弃牌后手牌 5 张,进入结束阶段 → 自守弃牌惩罚(X=2)
    expect(harness.state.players[0].hand.length).toBe(5);
    expect(currentRequestType(harness.state)).toBe('自守/弃牌');
    expect(zishouDiscardExcess(harness.state)).toBe(2);

    // 弃 2 张
    const penaltyCards = harness.state.players[0].hand.slice(0, 2);
    await P0.respond('界自守', { cardIds: penaltyCards });
    await harness.waitForStable();

    // 最终手牌 3 张(5-2)
    expect(harness.state.players[0].hand.length).toBe(3);

    restoreAutoCompare();
  });

  // ─── 4. 无伤害不弃:发动 + 未造成伤害 → 结束阶段不弃 ────
  it('无伤害不弃:发动自守但未造成伤害 → 结束阶段不弃', async () => {
    const hand = [
      makeCard('h1', '闪', '♥', '3'),
      makeCard('h2', '桃', '♦', '4'),
      makeCard('h3', '酒', '♣', '5'),
    ];
    const deck = [
      makeCard('d1', '杀', '♠', '8'),
      makeCard('d2', '闪', '♥', '9'),
      makeCard('d3', '桃', '♦', '10'),
      makeCard('d4', '酒', '♣', 'J'),
    ];
    const cardMap: Record<string, Card> = {};
    for (const c of [...hand, ...deck]) cardMap[c.id] = c;

    await harness.setup(
      createGameState({
        players: [
          makePlayer({
            index: 0,
            name: '界刘表',
            faction: '群',
            hand: hand.map((c) => c.id),
            skills: ['界自守', '界宗室', '回合管理'],
            health: 3,
            maxHealth: 3,
          }),
          makePlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['回合管理'],
            health: 3,
            maxHealth: 3,
          }),
        ],
        cardMap,
        zones: { deck: deck.map((c) => c.id), discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const P0 = harness.player('界刘表');

    const restoreAutoCompare = disableAutoCompare();

    // 开局 → 发动自守
    await P0.triggerAction('回合管理', 'start');
    await P0.respond('界自守', { choice: true });
    await harness.waitForStable();

    // 不出杀(未造成伤害)
    // 结束回合 → 弃牌阶段(手牌 7, 上限=3+2=5, 弃 2)→ 结束阶段(无自守弃牌)
    await P0.triggerAction('回合管理', 'end', {});

    // 弃牌阶段
    expect(currentRequestType(harness.state)).toBe('__弃牌');
    expect(discardExcess(harness.state)).toBe(2);
    const discardCards = harness.state.players[0].hand.slice(0, 2);
    await P0.respond('系统规则', { cardIds: discardCards });
    await harness.waitForStable();

    // 弃牌后手牌 5 张,进入结束阶段 → 未造成伤害,无自守弃牌
    expect(harness.state.players[0].hand.length).toBe(5);
    expect(currentRequestType(harness.state)).not.toBe('自守/弃牌');
    // damageDealt 未设
    expect(harness.state.turn.vars['自守/damageDealt']).toBeUndefined();

    restoreAutoCompare();
  });
});
