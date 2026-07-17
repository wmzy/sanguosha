// 界制衡(界孙权·主动技)测试:
//   use:出牌阶段限一次,你可以弃置任意张牌(手牌/装备),然后摸等量张牌;
//       若你以此法弃置了所有手牌,你额外摸一张牌。
//
// OL 官方(hero/442)。与标制衡区别:界版有"弃置所有手牌→额外摸一张"奖励。
//
// 验证:
//   1. 弃 1 张手牌 → 摸 1 张(净手牌数不变)
//   2. 弃 N 张手牌 → 摸 N 张
//   3. 弃置【所有】手牌(纯手牌) → 摸 N+1(额外奖励)
//   4. 装备也能弃(武器/防具→卸下 + 摸等量)
//   5. 手牌 + 装备混合:手牌全弃 → 摸 N+1(奖励,装备参与不影响判定)
//   6. 手牌 + 装备混合:手牌未全弃 → 摸 N(无奖励)
//   7. 仅弃装备(手牌为空) → 摸 N(无奖励——未弃置任何手牌)
//   8. availableActions:列出 use action,prompt 是 distribute select(handAndEquip)
//   9. 限一次:第二次发动 → 拒绝
//  10. 负面:cardIds=空数组 → 拒绝
//  11. 负面:不在手牌也不在装备区的牌 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
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

function makeEquip(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  subtype: '武器' | '防具' | '进攻马' | '防御马' | '宝物',
  rank = 'A',
  range?: number,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype, range };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '界孙权',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界制衡'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界制衡', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:弃手牌 → 摸等量 ───────────────────────────

  it('use:弃 1 张手牌(保留 1 张) → 摸 1 张(净手牌数不变;未弃所有手牌无奖励)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const d1 = makeCard('d1', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, c2, d1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 弃 c1,保留 c2(未弃"所有"手牌)→ 无奖励 → 摸 1 张 → 净手牌数不变(2)
    await P1.triggerAction('界制衡', 'use', { cardIds: ['c1'] });

    expect(harness.state.players[0].hand).toHaveLength(2);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c2', 'd1']));
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.deck).toEqual([]);
  });

  it('use:弃 2 张手牌(全部手牌) → 摸 2+1=3 张(额外奖励)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const d1 = makeCard('d1', '杀', '♠', '3');
    const d2 = makeCard('d2', '闪', '♥', '7');
    const d3 = makeCard('d3', '桃', '♦', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, c2, d1, d2, d3 },
      zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 弃置全部 2 张手牌 → 额外多摸 1 张 → 共摸 3 张
    await P1.triggerAction('界制衡', 'use', { cardIds: ['c1', 'c2'] });

    expect(harness.state.players[0].hand).toHaveLength(3);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['d1', 'd2', 'd3']));
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'c2']));
  });

  it('use:弃 3 张手牌,其中只弃 2 张(保留 1 张) → 摸 2 张(无额外奖励)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const c3 = makeCard('c3', '桃', '♦', '5');
    const d1 = makeCard('d1', '杀', '♠', '3');
    const d2 = makeCard('d2', '闪', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2', 'c3'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, c2, c3, d1, d2 },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 弃 2 张(保留 c3),未弃"所有"手牌 → 无奖励 → 摸 2 张
    await P1.triggerAction('界制衡', 'use', { cardIds: ['c1', 'c2'] });

    expect(harness.state.players[0].hand).toHaveLength(3); // 保留 c3 + 摸 d1,d2
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c3', 'd1', 'd2']));
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'c2']));
  });

  // ─── 正面:装备也能界制衡 ─────────────────────────────

  it('use:装备(武器/防具)也能界制衡 → 卸下装备 + 摸等量', async () => {
    const weapon = makeEquip('w1', '诸葛连弩', '♣', '武器', 'A', 1);
    const armor = makeEquip('a1', '八卦阵', '♣', '防具', 'A');
    const d1 = makeCard('d1', '杀', '♠', '3');
    const d2 = makeCard('d2', '闪', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], equipment: { 武器: 'w1', 防具: 'a1' } }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { w1: weapon, a1: armor, d1, d2 },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界制衡', 'use', { cardIds: ['w1', 'a1'] });

    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.players[0].equipment['防具']).toBeUndefined();
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['w1', 'a1']));
    // 手牌为空 → 未弃置任何手牌 → 无额外奖励 → 摸 2 张
    expect(harness.state.players[0].hand).toHaveLength(2);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['d1', 'd2']));
  });

  it('use:手牌+装备混合,手牌全弃 → 摸 N+1(装备参与不影响奖励判定)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const weapon = makeEquip('w1', '诸葛连弩', '♣', '武器', 'A', 1);
    const d1 = makeCard('d1', '闪', '♥', '7');
    const d2 = makeCard('d2', '杀', '♠', '3');
    const d3 = makeCard('d3', '桃', '♦', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], equipment: { 武器: 'w1' } }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, w1: weapon, d1, d2, d3 },
      zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 弃 c1(全部手牌)+ w1(装备)= 2 张;所有手牌已弃 → 额外多摸 1 → 共摸 3 张
    await P1.triggerAction('界制衡', 'use', { cardIds: ['c1', 'w1'] });

    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'w1']));
    expect(harness.state.players[0].hand).toHaveLength(3);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['d1', 'd2', 'd3']));
  });

  it('use:手牌+装备混合,手牌未全弃 → 摸 N(无奖励)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const weapon = makeEquip('w1', '诸葛连弩', '♣', '武器', 'A', 1);
    const d1 = makeCard('d1', '闪', '♥', '7');
    const d2 = makeCard('d2', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], equipment: { 武器: 'w1' } }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, c2, w1: weapon, d1, d2 },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 弃 c1 + w1(保留 c2),手牌未全弃 → 无奖励 → 摸 2 张
    await P1.triggerAction('界制衡', 'use', { cardIds: ['c1', 'w1'] });

    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'w1']));
    expect(harness.state.players[0].hand).toHaveLength(3); // 保留 c2 + 摸 d1,d2
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c2', 'd1', 'd2']));
  });

  // ─── defineAction 声明验证 ─────────────────────────

  it('availableActions:列出 use action,prompt 是 distribute select(handAndEquip)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const actions = P1.availableActions();
    const skill = actions.find((a) => a.skillId === '界制衡' && a.actionType === 'use');
    expect(skill).toBeDefined();
    expect(skill!.label).toBe('界制衡');
    expect(skill!.prompt.type).toBe('distribute');
    if (skill!.prompt.type === 'distribute') {
      expect(skill!.prompt.mode).toBe('select');
      expect(skill!.prompt.source).toBe('handAndEquip');
      expect(skill!.prompt.minTotal).toBe(1);
      expect(skill!.prompt.maxTotal).toBe(99);
    }
  });

  // ─── 限一次 ─────────────────────────────

  it('限一次:第二次发动 → 拒绝(usedThisTurn 标记)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const c2 = makeCard('c2', '闪', '♥', '2');
    const c3 = makeCard('c3', '桃', '♦', '5');
    const d1 = makeCard('d1', '桃', '♦', '5');
    const d2 = makeCard('d2', '杀', '♠', '9');
    const d3 = makeCard('d3', '闪', '♥', '6');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2', 'c3'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { c1, c2, c3, d1, d2, d3 },
      zones: { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次:弃 c1(保留 c2,c3;未弃所有手牌→无奖励)→ 摸 1 张
    await P1.triggerAction('界制衡', 'use', { cardIds: ['c1'] });
    expect(harness.state.players[0].hand).toHaveLength(3); // 保留 c2,c3 + 摸 1
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c2', 'c3']));
    expect(harness.state.players[0].hand).not.toContain('c1');

    // 第二次:拒绝(限一次)
    await P1.expectRejected({
      skillId: '界制衡',
      actionType: 'use',
      params: { cardIds: ['c2'] },
    });
  });

  // ─── 负面 ─────────────────────────────

  it('负面:cardIds=空数组 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界制衡',
      actionType: 'use',
      params: { cardIds: [] },
    });
  });

  it('负面:不在手牌也不在装备区的牌 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2', hand: ['c1'] }),
      ],
      cardMap: { c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界制衡',
      actionType: 'use',
      params: { cardIds: ['c1'] },
    });
  });
});
