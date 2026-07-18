// 界巧变(界张郃·主动技)测试
//
// 官方效果:
//   游戏开始时,你获得 2 枚"变"标记。
//   你可以弃置一张牌或移除 1 枚"变",跳过你的一个阶段(准备阶段和结束阶段除外):
//     - 跳过摸牌阶段:你可以获得至多两名角色各一张手牌
//     - 跳过出牌阶段:你可以移动场上的一张牌
//   结束阶段,若你的手牌数与之前你每回合结束阶段的手牌数均不相等,你获得 1 枚"变"。
//
// 验证:
//   1. 游戏开始初始化:首次 回合开始 → 获得 2 枚"变"标记
//   2. 弃牌方式跳过判定阶段(原有机制)
//   3. 移除变方式跳过判定阶段(新机制,不耗手牌)
//   4. 无手牌但有变 → 仅可移除变发动(跳过方式选择)
//   5. 跳过摸牌阶段:获得至多两名角色各一张手牌(弃牌/移除变两种方式各测一次)
//   6. 跳过出牌阶段:移动场上的一张牌
//   7. 跳过弃牌阶段:**无附加效果**(删除旧实现"摸一张牌"的回归测试)
//   8. 边界:无手牌且无变 → 不能发动
//   9. 结束阶段:手牌数与历史均不相等 → +1 变(含首次空历史真空真)
//  10. 结束阶段:手牌数与历史相等 → 不加变
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState, Mark, PlayerState } from '../../src/engine/types';

const BIAN_PREFIX = '界巧变/变:';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function bianMarks(player: PlayerState): Mark[] {
  return player.marks.filter((m) => m.id.startsWith(BIAN_PREFIX));
}

function makeBianMarks(n: number): Mark[] {
  const out: Mark[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: `${BIAN_PREFIX}init${i}`, scope: 0 });
  }
  return out;
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: PlayerState['equipment'];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
  marks?: Mark[];
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界张郃',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: (opts.vars as Record<string, never>) ?? {},
    marks: opts.marks ?? [],
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

describe('界巧变', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 游戏开始初始化:首次 回合开始 → +2 变 ────────────────────
  it('游戏开始初始化:首次 回合开始 → 获得 2 枚"变"', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界巧变'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    expect(bianMarks(harness.state.players[0]).length).toBe(0);

    // 触发任意玩家回合开始(主公开局)
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(bianMarks(harness.state.players[0]).length).toBe(2);
  });

  it('游戏开始初始化仅触发一次', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界巧变'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(bianMarks(harness.state.players[0]).length).toBe(2);
  });

  // ─── 2. 弃牌方式跳过判定阶段(原有机制保留) ────────────────────
  it('弃一张手牌跳过判定阶段:变标记不变', async () => {
    const discard = makeCard('d1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['d1'],
          skills: ['界巧变'],
          marks: makeBianMarks(2),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { d1: discard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await harness.waitForStable();
    // 询问发动
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: true });
    // 询问方式(弃牌 / 移除变)——选弃牌(choice=false)
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: false });
    // 选弃牌
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { cardIds: ['d1'] });

    expect(harness.state.zones.discardPile).toContain('d1');
    expect(harness.state.players[0].hand).toEqual([]);
    // 变标记未消耗
    expect(bianMarks(harness.state.players[0]).length).toBe(2);
  });

  // ─── 3. 移除变方式跳过判定阶段(新机制) ────────────────────
  it('移除1枚"变"跳过判定阶段:不耗手牌,变-1', async () => {
    const keep = makeCard('k1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['界巧变'],
          marks: makeBianMarks(2),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { k1: keep },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: true });
    // 询问方式——选移除变(choice=true)
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: true });

    // 手牌未消耗
    expect(harness.state.players[0].hand).toEqual(['k1']);
    expect(harness.state.zones.discardPile).toEqual([]);
    // 变标记 -1
    expect(bianMarks(harness.state.players[0]).length).toBe(1);
  });

  // ─── 4. 无手牌但有变 → 直接走"移除变"路径 ────────────────────
  it('无手牌但有变:不询问方式,直接移除变', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界巧变'],
          marks: makeBianMarks(1),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await harness.waitForStable();
    // 询问发动(应能触发——有变可用)
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: true });

    // 直接消耗变(无方式询问、无弃牌询问)
    expect(bianMarks(harness.state.players[0]).length).toBe(0);
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 5. 跳过摸牌阶段:弃牌方式偷牌(至多 2 张) ────────────────────
  it('弃牌跳过摸牌阶段:从 P1 获得一张手牌,不从牌堆摸牌', async () => {
    const discard = makeCard('d1', '杀', '♠', '5');
    const p1card = makeCard('p1c', '闪', '♥', '3');
    const cardMap: Record<string, Card> = { d1: discard, p1c: p1card };
    const deck = buildDeck(cardMap, 4);
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['d1'],
          skills: ['界巧变'],
          marks: makeBianMarks(0),
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['p1c'], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: true });
    // 无变,直接走弃牌(无方式询问)
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { cardIds: ['d1'] });
    // 选偷牌目标
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { targets: [1] });

    expect(harness.state.zones.discardPile).toContain('d1');
    expect(harness.state.players[0].hand).toContain('p1c');
    expect(harness.state.players[1].hand).toEqual([]);
    // 牌堆未被摸(摸牌阶段被跳过)
    expect(harness.state.zones.deck.length).toBe(4);
  });

  // ─── 5b. 跳过摸牌阶段:移除变方式偷牌(不耗手牌) ────────────────────
  it('移除变跳过摸牌阶段:从 P1 获得一张手牌,手牌不消耗', async () => {
    const keep = makeCard('k1', '杀', '♠', '5');
    const p1card = makeCard('p1c', '闪', '♥', '3');
    const cardMap: Record<string, Card> = { k1: keep, p1c: p1card };
    const deck = buildDeck(cardMap, 4);
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1'],
          skills: ['界巧变'],
          marks: makeBianMarks(1),
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['p1c'], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: true });
    // 选移除变
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: true });
    // 选偷牌目标(无弃牌询问)
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { targets: [1] });

    expect(harness.state.players[0].hand).toEqual(['k1', 'p1c']);
    expect(harness.state.players[1].hand).toEqual([]);
    expect(bianMarks(harness.state.players[0]).length).toBe(0);
    expect(harness.state.zones.deck.length).toBe(4);
  });

  // ─── 6. 跳过出牌阶段:移动场上的牌 ────────────────────
  it('跳过出牌阶段:把 P1 装备移到 P0 手牌', async () => {
    const discard = makeCard('d1', '杀', '♠', '5');
    const weapon = makeCard('w1', '诸葛连弩', '♣', 'A', '装备牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['d1'],
          skills: ['界巧变'],
          marks: makeBianMarks(0),
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          equipment: { 武器: 'w1' },
          character: '曹操',
        }),
      ],
      cardMap: { d1: discard, w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: true });
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { cardIds: ['d1'] }); // 弃牌
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { target: 1 }); // 源玩家
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { cardIds: ['w1'] }); // 源牌
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { target: 0 }); // 目标玩家(自己)

    expect(harness.state.players[1].equipment).toEqual({});
    expect(harness.state.players[0].hand).toContain('w1');
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  // ─── 7. 跳过弃牌阶段:无附加效果(回归测试,旧实现错误地摸 1 张) ────
  it('移除变跳过弃牌阶段:无附加效果(不摸牌)', async () => {
    const deckCards = buildDeck({}, 4);
    const cardMap: Record<string, Card> = {};
    for (const id of deckCards) {
      cardMap[id] = makeCard(id, '杀', '♠', '2');
    }
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['dk0'],
          skills: ['界巧变'],
          marks: makeBianMarks(1),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap,
      zones: { deck: [...deckCards], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const deckLenBefore = harness.state.zones.deck.length;
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '弃牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: true });
    // 询问方式——选移除变
    P0.expectPending('请求回应');
    await P0.respond('界巧变', { choice: true });

    // 无附加效果:不摸牌(牌堆不变)、不弃牌
    expect(harness.state.zones.deck.length).toBe(deckLenBefore);
    expect(harness.state.zones.discardPile).toEqual([]);
    expect(harness.state.players[0].hand).toEqual(['dk0']);
    expect(bianMarks(harness.state.players[0]).length).toBe(0);
  });

  // ─── 8. 边界:无手牌且无变 → 不能发动 ────────────────────
  it('无手牌且无变:不触发(无询问)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界巧变'],
          marks: makeBianMarks(0),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 9. 结束阶段:手牌数与历史均不相等 → +1 变(空历史真空真) ────
  it('结束阶段:首次(空历史)→ 获得 1 枚变', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['dk0'],
          skills: ['界巧变'],
          marks: makeBianMarks(0),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { dk0: makeCard('dk0', '杀', '♠', '2') },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);

    expect(bianMarks(harness.state.players[0]).length).toBe(0);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();

    expect(bianMarks(harness.state.players[0]).length).toBe(1);
    // 历史已记录 [1]
    expect(harness.state.players[0].vars['界巧变/历史手牌数']).toEqual([1]);
  });

  it('结束阶段:手牌数与历史均不相等 → +1 变', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['dk0', 'dk1', 'dk2'],
          skills: ['界巧变'],
          marks: makeBianMarks(0),
          vars: { '界巧变/历史手牌数': [1, 2] },
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {
        dk0: makeCard('dk0', '杀', '♠', '2'),
        dk1: makeCard('dk1', '杀', '♠', '3'),
        dk2: makeCard('dk2', '杀', '♠', '4'),
      },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();

    expect(bianMarks(harness.state.players[0]).length).toBe(1);
    expect(harness.state.players[0].vars['界巧变/历史手牌数']).toEqual([1, 2, 3]);
  });

  // ─── 10. 结束阶段:手牌数与历史相等 → 不加变 ────────────────────
  it('结束阶段:手牌数已在历史中 → 不加变', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['dk0', 'dk1'],
          skills: ['界巧变'],
          marks: makeBianMarks(0),
          vars: { '界巧变/历史手牌数': [2, 3] },
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {
        dk0: makeCard('dk0', '杀', '♠', '2'),
        dk1: makeCard('dk1', '杀', '♠', '3'),
      },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();

    expect(bianMarks(harness.state.players[0]).length).toBe(0);
    // 历史不变
    expect(harness.state.players[0].vars['界巧变/历史手牌数']).toEqual([2, 3]);
  });
});
