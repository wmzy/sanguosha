// 颂威(曹丕·主公技)测试
//   其他魏势力角色的判定牌结果为黑色且生效后,可以让你摸一张牌。
//
// 验证:
//   1. happy path:魏势力角色黑色判定牌 → 曹丕摸一张牌
//   2. 红色判定牌:不触发颂威
//   3. 非魏势力:不触发
//   4. 自己的判定:不触发
//   5. 不发动:拒绝摸牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, Faction, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '曹丕',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction ?? '魏',
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

describe('颂威', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── happy path:黑色判定牌 → 曹丕摸牌 ────────────────────
  it('P1(魏势力)判定黑色 → P0(曹丕)确认 → P0 摸一张牌', async () => {
    // 牌堆顶:黑桃判定牌(颂威触发)
    const judge = makeCard('j1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { j1: judge };
    // deck[0]=j1(黑桃判定牌),后续 dkN 为摸牌用
    const dk = buildDeck(cardMap, 5);
    const deck = ['j1', ...dk];

    const state: GameState = createGameState({
      players: [
        // P0 = 曹丕(颂威 owner)
        makePlayer({ index: 0, name: 'P0', skills: ['颂威'], health: 3, maxHealth: 3 }),
        // P1 = 魏势力角色(非曹丕)
        makePlayer({ index: 1, name: 'P1', character: '张辽', faction: '魏' }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 直接触发判定:P1 的判定,黑色牌
    void applyAtom(harness.state, { type: '判定', player: 1, judgeType: '乐不思蜀' });
    await harness.waitForStable();

    // 颂威触发:P0 被询问是否摸牌
    P0.expectPending('请求回应');
    await P0.respond('颂威', { choice: true });

    // P0 摸了一张牌(颂威摸牌)
    expect(harness.state.players[0].hand.length).toBe(1);
  });

  // ─── 红色判定牌:不触发 ────────────────────
  it('P1 判定红色(♥) → 颂威不触发', async () => {
    const judge = makeCard('j1', '杀', '♥', '7');
    const cardMap: Record<string, Card> = { j1: judge };
    const dk = buildDeck(cardMap, 5);
    const deck = ['j1', ...dk];

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['颂威'], health: 3, maxHealth: 3 }),
        makePlayer({ index: 1, name: 'P1', character: '张辽', faction: '魏' }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '判定', player: 1, judgeType: '乐不思蜀' });
    await harness.waitForStable();

    // 颂威不触发:无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 非魏势力:不触发 ────────────────────
  it('P1(蜀势力)判定黑色 → 颂威不触发', async () => {
    const judge = makeCard('j1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { j1: judge };
    const dk = buildDeck(cardMap, 5);
    const deck = ['j1', ...dk];

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['颂威'], health: 3, maxHealth: 3 }),
        makePlayer({ index: 1, name: 'P1', character: '关羽', faction: '蜀' }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '判定', player: 1, judgeType: '乐不思蜀' });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 自己的判定:不触发 ────────────────────
  it('P0(曹丕)自己的判定黑色 → 颂威不触发', async () => {
    const judge = makeCard('j1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { j1: judge };
    const dk = buildDeck(cardMap, 5);
    const deck = ['j1', ...dk];

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['颂威'], health: 3, maxHealth: 3 }),
        makePlayer({ index: 1, name: 'P1', character: '张辽', faction: '魏' }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '判定', player: 0, judgeType: '乐不思蜀' });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 不发动:拒绝摸牌 ────────────────────
  it('P1 判定黑色 → P0 拒绝 → 不摸牌', async () => {
    const judge = makeCard('j1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { j1: judge };
    const dk = buildDeck(cardMap, 5);
    const deck = ['j1', ...dk];

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['颂威'], health: 3, maxHealth: 3 }),
        makePlayer({ index: 1, name: 'P1', character: '张辽', faction: '魏' }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '判定', player: 1, judgeType: '乐不思蜀' });
    await harness.waitForStable();

    P0.expectPending('请求回应');
    await P0.respond('颂威', { choice: false });

    expect(harness.state.players[0].hand.length).toBe(0);
  });
});
