// 巧变(张郃·主动技)测试
//   弃一张手牌跳过自己的一个阶段:
//     - 跳过摸牌阶段:从至多两名其他角色各获得一张手牌
//     - 跳过出牌阶段:将场上的一张牌移动到另一个合理的位置
//
// 验证:
//   1. 跳过摸牌阶段:弃 1 手牌 + 从其他角色各获得 1 张
//   2. 跳过判定阶段:仅弃牌跳过(无附加效果)
//   3. 跳过出牌阶段:弃牌 + 移动场上牌(从 P1 装备移到自己手牌)
//   4. 不发动:阶段正常进行
//   5. 边界:无手牌时不能发动
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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
  hand?: string[];
  equipment?: PlayerState['equipment'];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '张郃',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
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

describe('巧变', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 跳过摸牌阶段:从其他角色各获得 1 张 ────────────────────
  it('跳过摸牌阶段:弃 1 + 从 P1 获得 1 张手牌', async () => {
    const discard = makeCard('d1', '杀', '♠', '5');
    const p1card = makeCard('p1c', '闪', '♥', '3');
    const cardMap: Record<string, Card> = { d1: discard, p1c: p1card };
    const deck = buildDeck(cardMap, 4);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['d1'], skills: ['巧变'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1c'],
          character: '曹操',
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 模拟 回合管理 推进到摸牌阶段:applyAtom(阶段开始, 摸牌)
    // 巧变 hook 询问发动
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('巧变', { choice: true });

    // 选弃牌
    P0.expectPending('请求回应');
    await P0.respond('巧变', { cardIds: ['d1'] });

    // 选偷牌目标
    P0.expectPending('请求回应');
    await P0.respond('巧变', { targets: [1] });

    // P0 弃 d1 → 弃牌堆
    expect(harness.state.zones.discardPile).toContain('d1');
    // P0 从 P1 获得 p1c
    expect(harness.state.players[0].hand).toContain('p1c');
    // P1 手牌为空
    expect(harness.state.players[1].hand).toEqual([]);
    // P0 未从牌堆摸牌(摸牌阶段被跳过)
    expect(harness.state.zones.deck.length).toBe(4);
  });

  // ─── 跳过判定阶段:仅弃牌跳过 ────────────────────
  it('跳过判定阶段:弃 1 张,无附加效果', async () => {
    const discard = makeCard('d1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['d1'], skills: ['巧变'] }),
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
    P0.expectPending('请求回应');
    await P0.respond('巧变', { choice: true });
    P0.expectPending('请求回应');
    await P0.respond('巧变', { cardIds: ['d1'] });

    // 弃牌完成
    expect(harness.state.zones.discardPile).toContain('d1');
    expect(harness.state.players[0].hand).toEqual([]);
    // 无后续询问(判定阶段无附加效果)
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 跳过出牌阶段:移动场上牌 ────────────────────
  it('跳过出牌阶段:弃牌 + 把 P1 装备移到自己手牌', async () => {
    const discard = makeCard('d1', '杀', '♠', '5');
    const weapon = makeCard('w1', '诸葛连弩', '♣', 'A', '装备牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['d1'], skills: ['巧变'] }),
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
    // 询问发动
    P0.expectPending('请求回应');
    await P0.respond('巧变', { choice: true });
    // 选弃牌
    P0.expectPending('请求回应');
    await P0.respond('巧变', { cardIds: ['d1'] });
    // 选源玩家(P1)
    P0.expectPending('请求回应');
    await P0.respond('巧变', { target: 1 });
    // 选源牌(w1)
    P0.expectPending('请求回应');
    await P0.respond('巧变', { cardIds: ['w1'] });
    // 选目标玩家(P0 自己)
    P0.expectPending('请求回应');
    await P0.respond('巧变', { target: 0 });

    // P1 装备被移走
    expect(harness.state.players[1].equipment).toEqual({});
    // P0 获得 w1
    expect(harness.state.players[0].hand).toContain('w1');
    // P0 弃了 d1
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  // ─── 不发动:阶段正常进行 ────────────────────
  it('不发动巧变:阶段正常进行(无后续询问)', async () => {
    const discard = makeCard('d1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['d1'], skills: ['巧变'] }),
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
    P0.expectPending('请求回应');
    await P0.respond('巧变', { choice: false });

    // 不发动:无弃牌
    expect(harness.state.players[0].hand).toEqual(['d1']);
    expect(harness.state.zones.discardPile).toEqual([]);
  });

  // ─── 边界:无手牌时不能发动 ────────────────────
  it('无手牌:巧变不触发(无询问)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['巧变'] }),
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
    // 无询问(巧变 hook 检查 hand.length === 0 直接 return)
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
