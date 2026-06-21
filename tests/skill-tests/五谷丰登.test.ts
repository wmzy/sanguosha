// tests/skill-tests/五谷丰登.test.ts
// 五谷丰登(普通锦囊):出牌阶段对所有存活角色使用。
//   翻 N 张到处理区亮出,从使用者开始按座次依次选1张到手牌,剩余进弃牌堆。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState, Json, PlayerState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  health?: number;
  maxHealth?: number;
  skills?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    // 五谷丰登是通用锦囊技能(任何玩家拿到这张牌都能用、且任何玩家都可能成为目标需要 respond)
    // 所以每个玩家都必须 instantiate
    skills: opts.skills ?? ['五谷丰登', '无懈可击'],
    vars: {} as Record<string, Json>,
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♥',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, rank, type };
}

describe('五谷丰登', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 2人局:P1 出五谷丰登 → P1 选1张,P2 选1张,剩余进弃牌堆
  // ─────────────────────────────────────────────────────────────
  it('用例1:2人局 → P1/P2 各选1张到手牌,原锦囊进弃牌堆', async () => {
    const wugu: Card = makeCard('wg1', '五谷丰登', '♥', '3');
    // 牌堆顶2张(亮出)
    const cardA: Card = makeCard('pa', '杀', '♠', '7', '基本牌');
    const cardB: Card = makeCard('pb', '桃', '♥', '2', '基本牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wg1'], skills: ['五谷丰登'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { wg1: wugu, pa: cardA, pb: cardB },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['pa', 'pb'], discardPile: [], processing: [] };
    await harness.setup(state);

    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCard('五谷丰登', 'wg1');
    // 无懈窗口(广播 slot)→ 超时(没人打)
    await P1.pass();

    // P1 选牌 pending
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    await P1.respond('五谷丰登', { cardId: 'pa' });

    // P2 选牌 pending
    await P2.respond('五谷丰登', { cardId: 'pb' });

    // 关键断言
    expect(harness.state.players[0].hand).toContain('pa'); // P1 拿了 pa
    expect(harness.state.players[1].hand).toContain('pb'); // P2 拿了 pb
    // 原锦囊进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wg1');
    // 处理区清空(2张亮牌已被选走)
    expect(harness.state.zones.processing.length).toBe(0);
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 3人局:P1/P2/P3 依次选1张,每人各得1张
  // ─────────────────────────────────────────────────────────────
  it('用例2:3人局 → P1/P2/P3 按座次各选1张', async () => {
    const wugu: Card = makeCard('wg1', '五谷丰登', '♥', '3');
    const cards = [
      makeCard('pa', '杀', '♠', '7', '基本牌'),
      makeCard('pb', '桃', '♥', '2', '基本牌'),
      makeCard('pc', '闪', '♦', '3', '基本牌'),
    ];

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wg1'], skills: ['五谷丰登'] }),
        makePlayer({ index: 1, name: 'P2' }),
        makePlayer({ index: 2, name: 'P3' }),
      ],
      cardMap: { wg1: wugu, pa: cards[0], pb: cards[1], pc: cards[2] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['pa', 'pb', 'pc'], discardPile: [], processing: [] };
    await harness.setup(state);

    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    await P1.useCard('五谷丰登', 'wg1');
    await P1.pass(); // 无懈窗口

    await P1.respond('五谷丰登', { cardId: 'pa' });
    await P2.respond('五谷丰登', { cardId: 'pb' });
    await P3.respond('五谷丰登', { cardId: 'pc' });

    expect(harness.state.players[0].hand).toContain('pa');
    expect(harness.state.players[1].hand).toContain('pb');
    expect(harness.state.players[2].hand).toContain('pc');
    expect(harness.state.zones.processing.length).toBe(0);
    expect(harness.state.zones.discardPile).toContain('wg1');
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 3人局 + 玩家不选(超时)→ 失去选牌机会,剩余牌进弃牌堆
  // ─────────────────────────────────────────────────────────────
  it('用例3:玩家超时不选 → 该玩家不得牌,剩余进弃牌堆', async () => {
    const wugu: Card = makeCard('wg1', '五谷丰登', '♥', '3');
    const cards = [
      makeCard('pa', '杀', '♠', '7', '基本牌'),
      makeCard('pb', '桃', '♥', '2', '基本牌'),
      makeCard('pc', '闪', '♦', '3', '基本牌'),
    ];

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wg1'], skills: ['五谷丰登'] }),
        makePlayer({ index: 1, name: 'P2' }),
        makePlayer({ index: 2, name: 'P3' }),
      ],
      cardMap: { wg1: wugu, pa: cards[0], pb: cards[1], pc: cards[2] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['pa', 'pb', 'pc'], discardPile: [], processing: [] };
    await harness.setup(state);

    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    await P1.useCard('五谷丰登', 'wg1');
    await P1.pass(); // 无懈窗口

    await P1.respond('五谷丰登', { cardId: 'pa' });
    // P2 超时不选
    await P1.pass(); // fireTimeout 触发 P2 的选牌 slot
    await P3.respond('五谷丰登', { cardId: 'pc' });

    // P1 / P3 拿到牌;P2 没拿到
    expect(harness.state.players[0].hand).toContain('pa');
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.players[2].hand).toContain('pc');
    // 未被选走的 pb 进弃牌堆
    expect(harness.state.zones.discardPile).toContain('pb');
    expect(harness.state.zones.discardPile).toContain('wg1');
    expect(harness.state.zones.processing.length).toBe(0);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:非出牌阶段使用
  // ─────────────────────────────────────────────────────────────
  it('validate 拒绝:非出牌阶段使用', async () => {
    const wugu: Card = makeCard('wg1', '五谷丰登', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wg1'], skills: ['五谷丰登'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { wg1: wugu },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '五谷丰登', actionType: 'use',
      params: { cardId: 'wg1' },
    });
  });
});
