// tests/skill-tests/界恩怨.test.ts
// 界恩怨(界法正·被动技)测试:
//   当你获得一名其他角色至少两张牌后,你可以令其摸一张牌。
//   当你受到1点伤害后,你可以令伤害来源选择一项:
//     1.交给你一张红色手牌;2.失去1点体力。
//
// 验证:
//   effect A:
//   1. happy:法正获 P1 两张牌 → confirm → P1 摸 1
//   2. 不发动:confirm=false → P1 不摸
//   3. 仅获 1 张 → 不触发
//   effect B:
//   4. 选项 1(交红牌):P1 伤法正 → confirm → P1 选交红牌 → 法正获得红牌
//   5. 选项 2(失体力):P1 伤法正 → confirm → P1 选失体力 → P1 失 1 体力
//   6. 来源无红牌 → 强制失体力
//   7. 法正不发动 effect B → 来源不受影响
//
// 测试技巧:hook 创建 pending 时不能用 await applyAtom(会阻塞),
//   用 void + waitForStable 模式(同 遗计/救援/界诛害 测试)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { skillLoaders } from '../../src/engine/skills';
import * as 界恩怨Module from '../../src/engine/skills/界恩怨';
import type { SkillModule } from '../../src/engine/skill';
skillLoaders['界恩怨'] = async () => 界恩怨Module as unknown as SkillModule;

import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import { runDamageFlow } from '../../src/engine/damage-flow';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
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
  character?: string;
  alive?: boolean;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界法正',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界恩怨'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

/** 模拟"法正从 from 获得 2 张牌"的批次(同 depth=0,同批次计数)。
 *  第二张获得会触发 effect A hook(创建 pending),用 void + waitForStable 模式。 */
async function simulateGainTwoCards(
  harness: SkillTestHarness,
  ownerId: number,
  from: number,
  cardIds: string[],
): Promise<void> {
  // 第一张:count 0→1,无触发,同步完成
  await applyAtom(harness.state, { type: '获得', player: ownerId, cardId: cardIds[0], from });
  // 第二张:count 1→2,触发 hook(创建 pending);void 启动避免阻塞
  void applyAtom(harness.state, { type: '获得', player: ownerId, cardId: cardIds[1], from });
  await harness.waitForStable();
  harness.processAllEvents();
}

/** 触发"P1 对法正造成 1 点伤害"(void + waitForStable 模式) */
async function dealDamageToOwner(
  harness: SkillTestHarness,
  source: number,
  amount = 1,
): Promise<void> {
  void runDamageFlow(harness.state, source, 0, amount);
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界恩怨', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── effect A:happy path ─────────────────────────
  it('effect A:法正获 P1 两张牌 → confirm → P1 摸 1', async () => {
    const x1 = makeCard('x1', '杀', '♦');
    const x2 = makeCard('x2', '杀', '♣');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界恩怨'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['x1', 'x2'],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { x1, x2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const deckLen = harness.state.zones.deck.length;

    await simulateGainTwoCards(harness, 0, 1, ['x1', 'x2']);

    // 法正被询问是否发动 effect A
    P0.expectPending('请求回应');
    await P0.respond('界恩怨', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 摸了 1 张牌(从牌堆顶)
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.zones.deck.length).toBe(deckLen - 1);
  });

  // ─── effect A:不发动 ───────────────────────────
  it('effect A:法正 confirm=false → P1 不摸', async () => {
    const x1 = makeCard('x1', '杀', '♦');
    const x2 = makeCard('x2', '杀', '♣');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界恩怨'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['x1', 'x2'],
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: { x1, x2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const deckLen = harness.state.zones.deck.length;

    await simulateGainTwoCards(harness, 0, 1, ['x1', 'x2']);

    P0.expectPending('请求回应');
    await P0.respond('界恩怨', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 未摸牌(仅失去 x1,x2 给法正)
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.deck.length).toBe(deckLen);
  });

  // ─── effect A:仅获 1 张 → 不触发 ───────────────
  it('effect A:仅获 1 张 → 不触发(无询问)', async () => {
    const x1 = makeCard('x1', '杀', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界恩怨'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['x1'],
          skills: [],
          character: '曹操',
        }),
      ],
      cardMap: { x1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 仅 1 张获得(count=1,无触发)
    await applyAtom(harness.state, { type: '获得', player: 0, cardId: 'x1', from: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    P0.expectNoPending();
  });

  // ─── effect B:选项 1(交红牌)──────────────────
  it('effect B:P1 伤法正 → confirm → P1 交红牌给法正', async () => {
    const redCard = makeCard('redCard', '杀', '♥'); // 红色
    const blackCard = makeCard('blackCard', '杀', '♠'); // 黑色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界恩怨'], health: 3 }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['redCard', 'blackCard'],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { redCard, blackCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 对法正造成 1 点伤害
    await dealDamageToOwner(harness, 1);
    expect(harness.state.players[0].health).toBe(2);

    // 法正 confirm 是否发动
    P0.expectPending('请求回应');
    await P0.respond('界恩怨', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 选 选项 1(交红色手牌)
    const P1 = harness.player('P1');
    P1.expectPending('请求回应');
    await P1.respond('界恩怨', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 选具体红牌
    P1.expectPending('请求回应');
    await P1.respond('界恩怨', { cardId: 'redCard' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 红牌从 P1 转到法正
    expect(harness.state.players[0].hand).toContain('redCard');
    expect(harness.state.players[1].hand).not.toContain('redCard');
    expect(harness.state.players[1].hand).toContain('blackCard');
    // P1 体力未变(未失去体力)
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── effect B:选项 2(失体力)──────────────────
  it('effect B:P1 伤法正 → confirm → P1 选失体力 → P1 失 1 体力', async () => {
    const redCard = makeCard('redCard', '杀', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界恩怨'], health: 3 }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['redCard'],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { redCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await dealDamageToOwner(harness, 1);

    // 法正 confirm
    P0.expectPending('请求回应');
    await P0.respond('界恩怨', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 选 选项 2(失体力)
    const P1 = harness.player('P1');
    P1.expectPending('请求回应');
    await P1.respond('界恩怨', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 失 1 体力,redCard 仍在 P1 手中
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].hand).toContain('redCard');
    expect(harness.state.players[0].hand).not.toContain('redCard');
  });

  // ─── effect B:来源无红牌 → 强制失体力 ─────────
  it('effect B:来源无红色手牌 → 强制失去 1 点体力', async () => {
    const blackCard = makeCard('blackCard', '杀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界恩怨'], health: 3 }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['blackCard'], // 仅黑色
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { blackCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await dealDamageToOwner(harness, 1);

    // 法正 confirm
    P0.expectPending('请求回应');
    await P0.respond('界恩怨', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 不被询问选择(无红色) → 直接失 1 体力
    const P1 = harness.player('P1');
    P1.expectNoPending();
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].hand).toContain('blackCard');
  });

  // ─── effect B:法正不发动 ───────────────────────
  it('effect B:法正 confirm=false → 来源不受影响', async () => {
    const redCard = makeCard('redCard', '杀', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界恩怨'], health: 3 }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['redCard'],
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { redCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await dealDamageToOwner(harness, 1);

    P0.expectPending('请求回应');
    await P0.respond('界恩怨', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[1].hand).toContain('redCard');
  });
});
