// tests/skill-tests/国色.test.ts
// 国色(大乔·主动技/转化):你可以将一张方块牌当【乐不思蜀】使用。
//
// 实现模型:独立 use action(镜像断粮——延时锦囊转化技标准模型),非奇袭影子卡模型
// (延时锦囊的 trick.card.id 会持久存入 pendingTricks,影子卡入弃牌堆被 delete 后视图无法解析)。
//
// 覆盖:
//   1. 正面:方块手牌 → 放置乐不思蜀到距离1目标,原牌进弃牌堆
//   2. 正面:装备区方块牌 → 卸下后放置,槽位清空,原牌进弃牌堆
//   3. 正面:targets 数组形式提交同样成功(与乐不思蜀前端兼容)
//   4. 负面:非方块牌(♥/♠/♣) → 拒绝
//   5. 负面:非自己回合 → 拒绝
//   6. 负面:目标距离>1 → 拒绝(3人局 P0→P2 = 2)
//   7. 负面:对自己使用 → 拒绝
//   8. 负面:不在手牌也不在装备区 → 拒绝
//   9. availableActions:声明 use action,cardFilter 仅方块牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
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
  equipment?: Record<string, string>;
  skills?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '大乔',
    health: 3,
    maxHealth: 3,
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

describe('国色', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 方块手牌 → 放置乐不思蜀 ─────────────────────────────

  it('方块手牌当乐不思蜀 → 放置到距离1目标,原牌进弃牌堆', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7'); // 方块红牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '大乔', hand: ['c1'], skills: ['国色'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: diamond, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('大乔');

    await P0.triggerAction('国色', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);

    // 目标判定区放入乐不思蜀(乐不思蜀 hooks 只认 trick.name)
    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
    expect(harness.state.players[1].pendingTricks[0].source).toBe(0);
    // 原方块牌进弃牌堆(满足"使用后原牌进入弃牌堆")
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c1');
    // 无残留 pending(无懈询问在目标回合判定阶段才发生)
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 2. 装备区方块牌 → 卸下后放置 ──────────────────────────

  it('装备区方块牌当乐不思蜀 → 卸下转化,槽位清空,原牌进弃牌堆', async () => {
    const weapon: Card = {
      id: 'e1',
      name: '丈八蛇矛',
      suit: '♦',
      color: '红',
      rank: 'Q',
      type: '装备牌',
      subtype: '武器',
      range: 3,
    };
    const state: GameState = createGameState({
      players: [
        // P1 起手无手牌,仅装备区一张方块武器
        makePlayer({
          index: 0,
          name: '大乔',
          hand: [],
          equipment: { 武器: 'e1' },
          skills: ['国色'],
        }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { e1: weapon, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('大乔');

    await P0.triggerAction('国色', 'use', { cardId: 'e1', target: 1 });
    await waitForStable(harness.state);

    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
    // 装备已被卸下(用于转化)
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    // 原装备牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('e1');
  });

  // ─── 3. targets 数组形式提交(前端 useCardAndTarget 兼容)──────

  it('targets 数组形式提交 → 同样成功', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '大乔', hand: ['c1'], skills: ['国色'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: diamond, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('大乔');

    await P0.triggerAction('国色', 'use', { cardId: 'c1', targets: [1] });
    await waitForStable(harness.state);

    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  // ─── 4. 负面:非方块牌 → 拒绝 ───────────────────────────────

  it.each([
    ['红桃(♥)', '♥'],
    ['黑桃(♠)', '♠'],
    ['梅花(♣)', '♣'],
  ] as const)('transform:%s 牌 → 拒绝(非方块)', async (_label, suit) => {
    const card = makeCard('c1', '杀', suit, '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '大乔', hand: ['c1'], skills: ['国色'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: card, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('大乔');

    await P0.expectRejected({
      skillId: '国色',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
    // 未消耗手牌
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── 5. 负面:非自己回合 → 拒绝 ─────────────────────────────

  it('非自己回合 → 拒绝', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '大乔', hand: ['c1'], skills: ['国色'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: diamond, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 1, // 目标的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('大乔');

    await P0.expectRejected({
      skillId: '国色',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  // ─── 6. 负面:目标距离>1 → 拒绝(3人局 P0→P2 = 2)──────────

  it('目标距离>1 → 拒绝(4人局 P0→P2 = 2)', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '大乔', hand: ['c1'], skills: ['国色'] }),
        makePlayer({ index: 1, name: '中间A', hand: [], skills: ['回合管理'] }),
        makePlayer({ index: 2, name: '远端', hand: [], skills: ['回合管理'] }),
        makePlayer({ index: 3, name: '中间B', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { c1: diamond },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('大乔');

    // 4人环形座位 P0→P2 距离= min(2, 4-2)=2 > 1 → 拒绝
    await P0.expectRejected({
      skillId: '国色',
      actionType: 'use',
      params: { cardId: 'c1', target: 2 },
    });
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── 7. 负面:对自己使用 → 拒绝 ─────────────────────────────

  it('对自己使用 → 拒绝', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '大乔', hand: ['c1'], skills: ['国色'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: diamond, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('大乔');

    await P0.expectRejected({
      skillId: '国色',
      actionType: 'use',
      params: { cardId: 'c1', target: 0 },
    });
  });

  // ─── 8. 负面:不在手牌也不在装备区 → 拒绝 ───────────────────

  it('不在手牌也不在装备区的卡 → 拒绝', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '大乔', hand: [], skills: ['国色'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: diamond, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('大乔');

    await P0.expectRejected({
      skillId: '国色',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  // ─── 9. availableActions:声明 use action,cardFilter 仅方块牌 ─

  it('availableActions:声明 use action,cardFilter 仅匹配方块牌', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const heart = makeCard('c2', '杀', '♥', '3');
    const spade = makeCard('c3', '杀', '♠', '5');
    const club = makeCard('c4', '杀', '♣', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '大乔',
          hand: ['c1', 'c2', 'c3', 'c4'],
          skills: ['国色'],
        }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: {
        c1: diamond,
        c2: heart,
        c3: spade,
        c4: club,
        d1: makeCard('d1', '闪', '♥', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('大乔');

    const actions = P0.availableActions();
    const guose = actions.find((a) => a.skillId === '国色' && a.actionType === 'use');
    expect(guose).toBeDefined();
    expect(guose!.label).toBe('国色');
    expect(guose!.prompt.type).toBe('useCardAndTarget');

    // cardFilter 仅匹配方块牌(c1 ♦),排除 ♥/♠/♣
    const cardFilter =
      guose!.prompt.type === 'useCardAndTarget' ? guose!.prompt.cardFilter.filter : null;
    expect(cardFilter).toBeDefined();
    const allowed: string[] = [];
    for (const cardId of harness.state.players[0].hand) {
      const card = harness.state.cardMap[cardId];
      if (cardFilter!(card)) allowed.push(cardId);
    }
    expect(allowed).toEqual(['c1']);
  });
});
