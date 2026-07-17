// tests/skill-tests/界国色.test.ts
// 界国色(界大乔·主动技):出牌阶段限一次，你可以选择一项，然后摸一张牌：
//   1.将一张方片牌当【乐不思蜀】使用；2.弃置一张方片牌和场上一张【乐不思蜀】。
//
// 官方来源:三国杀 OL 界限突破 hero/309。
//
// 验证:
//   1. 选项①:方片手牌当乐使用 → 放置乐 + 摸1张
//   2. 选项①:装备区方片牌当乐使用 → 卸下转化 + 放置乐 + 摸1张
//   3. 选项②:弃方片 + 弃场上乐 → 移除乐 + 摸1张
//   4. 限一次:同一回合第二次使用 → 拒绝
//   5. 负面:非方片牌 → use 触发后选牌阶段拒绝(或 use validate 拒绝)
//   6. 负面:非自己回合 → 拒绝
//   7. 负面:无方片牌 → use 被拒绝
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
  pendingTricks?: PlayerState['pendingTricks'];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界大乔',
    health: 3,
    maxHealth: 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    tags: [],
    judgeZone: [],
  };
}

describe('界国色', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 选项①:方片手牌当乐使用 + 摸1张 ───────────────────────
  it('选项①:方片手牌当乐使用 → 放置乐不思蜀 + 摸1张', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const drawCard = makeCard('d1', '闪', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界大乔', hand: ['c1'], skills: ['界国色'] }),
        makePlayer({ index: 1, name: '目标', skills: ['回合管理'] }),
      ],
      cardMap: { c1: diamond, d1: drawCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界大乔');

    await P0.triggerAction('界国色', 'use');
    await waitForStable(harness.state);

    // 询问选项:确认=①使用
    P0.expectPending('请求回应');
    await P0.respond('界国色', { choice: true });

    // 选方片牌 + 目标
    P0.expectPending('请求回应');
    await P0.respond('界国色', { cardId: 'c1', target: 1 });

    await waitForStable(harness.state);

    // 目标判定区放入乐不思蜀
    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
    expect(harness.state.players[1].pendingTricks[0].source).toBe(0);
    // 原方片牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c1');
    // 摸1张:d1 入手
    expect(harness.state.players[0].hand).toContain('d1');
  });

  // ─── 2. 选项①:装备区方片牌当乐使用 ───────────────────────────
  it('选项①:装备区方片牌当乐 → 卸下转化 + 放置乐 + 摸1张', async () => {
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
    const drawCard = makeCard('d1', '闪', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界大乔',
          hand: [],
          equipment: { 武器: 'e1' },
          skills: ['界国色'],
        }),
        makePlayer({ index: 1, name: '目标', skills: ['回合管理'] }),
      ],
      cardMap: { e1: weapon, d1: drawCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界大乔');

    await P0.triggerAction('界国色', 'use');
    await waitForStable(harness.state);

    P0.expectPending('请求回应');
    await P0.respond('界国色', { choice: true }); // 选项①

    P0.expectPending('请求回应');
    await P0.respond('界国色', { cardId: 'e1', target: 1 });

    await waitForStable(harness.state);

    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('e1');
    // 摸1张
    expect(harness.state.players[0].hand).toContain('d1');
  });

  // ─── 3. 选项②:弃方片 + 弃场上乐 + 摸1张 ──────────────────────
  it('选项②:弃方片手牌 + 弃场上乐 → 移除乐 + 摸1张', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const drawCard = makeCard('d1', '闪', '♥', '5');
    const leCard = makeCard('le1', '乐不思蜀', '♠', '6', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界大乔', hand: ['c1'], skills: ['界国色'] }),
        makePlayer({
          index: 1,
          name: '目标',
          skills: ['回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card: leCard }],
        }),
      ],
      cardMap: { c1: diamond, d1: drawCard, le1: leCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界大乔');

    await P0.triggerAction('界国色', 'use');
    await waitForStable(harness.state);

    // 询问选项:取消=②移除
    P0.expectPending('请求回应');
    await P0.respond('界国色', { choice: false });

    // 选方片牌弃置
    P0.expectPending('请求回应');
    await P0.respond('界国色', { cardId: 'c1' });

    // 选场上乐所在玩家
    P0.expectPending('请求回应');
    await P0.respond('界国色', { target: 1 });

    await waitForStable(harness.state);

    // 方片牌被弃
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c1');
    // 乐不思蜀被移除
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    // 摸1张
    expect(harness.state.players[0].hand).toContain('d1');
  });

  // ─── 4. 限一次:同一回合第二次使用被拒 ─────────────────────────
  it('限一次:使用过一次后,同回合第二次被拒绝', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const diamond2 = makeCard('c2', '杀', '♦', '8');
    const drawCard = makeCard('d1', '闪', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界大乔',
          hand: ['c1', 'c2'],
          skills: ['界国色'],
        }),
        makePlayer({ index: 1, name: '目标', skills: ['回合管理'] }),
      ],
      cardMap: { c1: diamond, c2: diamond2, d1: drawCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界大乔');

    // 第一次使用
    await P0.triggerAction('界国色', 'use');
    await waitForStable(harness.state);
    P0.expectPending('请求回应');
    await P0.respond('界国色', { choice: true }); // 选项①
    P0.expectPending('请求回应');
    await P0.respond('界国色', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);

    // 第二次使用 → 被拒绝(限一次)
    await P0.expectRejected({
      skillId: '界国色',
      actionType: 'use',
      params: {},
    });
  });

  // ─── 5. 负面:非自己回合 → 拒绝 ───────────────────────────────
  it('非自己回合 → use 被拒绝', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界大乔', hand: ['c1'], skills: ['界国色'] }),
        makePlayer({ index: 1, name: '目标', hand: ['d1'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: diamond, d1: makeCard('d1', '闪', '♥', '5') },
      currentPlayerIndex: 1, // 目标的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界大乔');

    await P0.expectRejected({
      skillId: '界国色',
      actionType: 'use',
      params: {},
    });
  });

  // ─── 6. 负面:无方片牌 → use 被拒绝 ───────────────────────────
  it('无方片牌 → use 被拒绝', async () => {
    const heart = makeCard('c1', '杀', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界大乔', hand: ['c1'], skills: ['界国色'] }),
        makePlayer({ index: 1, name: '目标', skills: ['回合管理'] }),
      ],
      cardMap: { c1: heart },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界大乔');

    await P0.expectRejected({
      skillId: '界国色',
      actionType: 'use',
      params: {},
    });
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── 7. availableActions:声明 use action ────────────────────
  it('availableActions:声明 use action', async () => {
    const diamond = makeCard('c1', '杀', '♦', '7');
    const heart = makeCard('c2', '杀', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界大乔', hand: ['c1', 'c2'], skills: ['界国色'] }),
        makePlayer({ index: 1, name: '目标', skills: ['回合管理'] }),
      ],
      cardMap: { c1: diamond, c2: heart },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界大乔');

    const actions = P0.availableActions();
    const guose = actions.find((a) => a.skillId === '界国色' && a.actionType === 'use');
    expect(guose).toBeDefined();
    expect(guose!.label).toBe('界国色');
  });
});
