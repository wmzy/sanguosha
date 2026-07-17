// 界谦逊(界陆逊·触发技)测试:当延时锦囊或他人普通锦囊对你生效且你为唯一目标时,
//   你可以将所有手牌移出游戏直到回合结束。
//
// 验证:
//   1. 延时锦囊(乐不思蜀)对你生效 → 触发 → 确认 → 手牌移出游戏 → 回合结束归还
//   2. 延时锦囊对你生效 → 不发动 → 手牌不移出
//   3. 无手牌时延时锦囊生效 → 不触发(无询问)
//   4. 他人普通锦囊(决斗)以你为唯一目标 → 触发 → 确认 → 手牌移出
//   5. 自己使用的普通锦囊不触发(frame.from===自己)
//   6. 多目标普通锦囊不触发(targets.length>1)
//   7. 联动:谦逊移出全部手牌 → 触发界连营(X=移出手牌数)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom, pushFrame, popFrame } from '../../src/engine/create-engine';
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
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '陆逊',
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
  };
}

describe('界谦逊', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 延时锦囊生效 → 确认 → 移出 → 回合结束归还 ────────────────────
  it('延时锦囊(乐不思蜀)对陆逊生效 → 确认 → 手牌移出游戏 → 回合结束归还', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const trick = makeCard('ls1', '乐不思蜀', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界谦逊'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2, ls1: trick },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 对 P0 放置乐不思蜀(直接驱动 atom,触发谦逊)
    void applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '乐不思蜀', source: 1, card: trick },
    });
    await harness.waitForStable();

    // 谦逊询问
    P0.expectPending('请求回应');
    await P0.respond('界谦逊', { choice: true }); // 发动
    await harness.waitForStable();

    // 手牌全部移出游戏:hand 空,vars 暂存
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[0].vars['界谦逊/移出']).toEqual(['c1', 'c2']);
    // 牌未进弃牌堆(移出游戏 ≠ 弃置)
    expect(harness.state.zones.discardPile).toEqual([]);

    // 回合结束 → 归还
    void applyAtom(harness.state, { type: '回合结束', player: 1 });
    await harness.waitForStable();

    // 手牌归还,vars 清空
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(harness.state.players[0].vars['界谦逊/移出']).toBeUndefined();
  });

  // ─── 2. 延时锦囊生效 → 不发动 → 手牌不移出 ────────────────────
  it('延时锦囊生效 → 不发动谦逊 → 手牌不移出', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const trick = makeCard('ls1', '乐不思蜀', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界谦逊'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, ls1: trick },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '乐不思蜀', source: 1, card: trick },
    });
    await harness.waitForStable();
    P0.expectPending('请求回应');

    // 不发动
    await P0.respond('界谦逊', { choice: false });
    await harness.waitForStable();

    // 手牌未移出
    expect(harness.state.players[0].hand).toEqual(['c1']);
    expect(harness.state.players[0].vars['界谦逊/移出']).toBeUndefined();
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 3. 无手牌 → 不触发 ────────────────────
  it('无手牌时延时锦囊生效 → 谦逊不触发(无询问)', async () => {
    const trick = makeCard('ls1', '乐不思蜀', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界谦逊'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { ls1: trick },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '乐不思蜀', source: 1, card: trick },
    });
    await harness.waitForStable();

    // 无手牌可移出 → 不询问
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].vars['界谦逊/移出']).toBeUndefined();
  });

  // ─── 4. 他人普通锦囊(决斗)以陆逊为唯一目标 → 触发 ────────────────────
  //   直接驱动 pushFrame(模拟决斗结算帧)+ 成为目标 atom,隔离测试成为目标钩子。
  it('他人普通锦囊(决斗)以陆逊为唯一目标 → 触发谦逊 → 确认 → 手牌移出', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    // 决斗牌:type=锦囊牌,无 trickSubtype(与真实牌堆一致)
    const duel = makeCard('dd', '决斗', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界谦逊'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2, dd: duel },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 模拟决斗结算帧:P1(from=1)对 P0(target=0),targets=[0](唯一目标)
    await pushFrame(harness.state, '决斗', 1, { cardId: 'dd', targets: [0] });
    // 决斗牌进处理区(帧 cards)
    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'dd',
      from: { zone: '手牌', player: 1 },
      to: { zone: '处理区' },
    });
    // 触发成为目标 → 谦逊钩子
    void applyAtom(harness.state, { type: '成为目标', source: 1, target: 0, cardId: 'dd' });
    await harness.waitForStable();

    // 谦逊询问(普通锦囊唯一目标路径)
    P0.expectPending('请求回应');
    await P0.respond('界谦逊', { choice: true });
    await harness.waitForStable();

    // 手牌全部移出
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.players[0].vars['界谦逊/移出']).toEqual(['c1', 'c2']);

    // 清理帧
    await popFrame(harness.state);
  });

  // ─── 5. 自己使用的普通锦囊不触发 ────────────────────
  it('自己使用的普通锦囊(from===自己) → 谦逊不触发', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const duel = makeCard('dd', '决斗', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'dd'],
          skills: ['界谦逊'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, dd: duel },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    // P0 自己使用的决斗(from=0)
    await pushFrame(harness.state, '决斗', 0, { cardId: 'dd', targets: [1] });
    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'dd',
      from: { zone: '手牌', player: 0 },
      to: { zone: '处理区' },
    });
    // 成为目标的 target 是 P1(不是陆逊),但即使构造 target=陆逊,from=陆逊 也不触发
    void applyAtom(harness.state, { type: '成为目标', source: 0, target: 0, cardId: 'dd' });
    await harness.waitForStable();

    // 自己使用 → 不触发
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toEqual(['c1']);
    await popFrame(harness.state);
  });

  // ─── 6. 多目标普通锦囊不触发(targets.length>1) ────────────────────
  it('多目标普通锦囊(targets 含他人) → 陆逊非唯一目标 → 谦逊不触发', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const scroll = makeCard('sc', '铁索连环', '♣', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界谦逊'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
      ],
      cardMap: { c1, sc: scroll },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    // P1 使用铁索连环,targets=[0,2](陆逊非唯一目标)
    await pushFrame(harness.state, '铁索连环', 1, { cardId: 'sc', targets: [0, 2] });
    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'sc',
      from: { zone: '手牌', player: 1 },
      to: { zone: '处理区' },
    });
    void applyAtom(harness.state, { type: '成为目标', source: 1, target: 0, cardId: 'sc' });
    await harness.waitForStable();

    // 非唯一目标 → 不触发
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toEqual(['c1']);
    await popFrame(harness.state);
  });

  // ─── 7. 联动:谦逊移出全部手牌 → 触发界连营(X=移出手牌数) ────────────────────
  it('联动:谦逊移出 2 张手牌 → 界连营触发 X=2 → 令 2 名角色各摸一张', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const trick = makeCard('ls1', '乐不思蜀', '♠', 'A', '锦囊牌');
    const d1 = makeCard('d1', '闪', '♥', '3');
    const d2 = makeCard('d2', '桃', '♦', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界谦逊', '界连营'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
      ],
      cardMap: { c1, c2, ls1: trick, d1, d2 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 延时锦囊触发谦逊
    void applyAtom(harness.state, {
      type: '添加延时锦囊',
      player: 0,
      trick: { name: '乐不思蜀', source: 1, card: trick },
    });
    await harness.waitForStable();

    // ① 谦逊询问 → 发动
    P0.expectPending('请求回应');
    await P0.respond('界谦逊', { choice: true });
    await harness.waitForStable();

    // 手牌移出 → 连营触发(X=2)
    expect(harness.state.players[0].hand).toEqual([]);
    P0.expectPending('请求回应');
    await P0.respond('界连营', { choice: true }); // 发动连营
    await harness.waitForStable();
    // X=2 → 选 P1/P2 各摸一张
    await P0.respond('界连营', { targets: [1, 2] });
    await harness.waitForStable();

    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(1);
    expect(harness.state.zones.deck.length).toBe(0);
  });
});
