// 英魂(孙坚·主动技)测试
//   回合开始阶段(准备阶段),若已受伤,令一名其他角色二选一:
//   选项1:摸X弃1;选项2:摸1弃X(X=已损失体力值)。
//
// 通过直接 dispatch 阶段开始(准备) 触发英魂 before-hook
//   (准备阶段是回合一首个阶段,无法由更早阶段推进进入,故直接派发)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
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
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  faction?: '吴' | '魏' | '蜀' | '群';
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '孙坚',
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
    faction: opts.faction ?? '吴',
    identity: '主公',
  };
}

/** 触发孙坚(player 0)的准备阶段,启动英魂 before-hook */
function triggerReadyPhase(harness: SkillTestHarness): void {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
}

describe('英魂', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 选项1:摸X弃1 ──────────────────────────────────────────
  it('发动英魂 → 目标选选项1(摸X弃1):P1 摸2弃1,净+1', async () => {
    // 孙坚 4血剩2血 → X=2
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 2,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1a', 'p1b'],
          skills: ['回合管理'],
          faction: '魏',
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        d1: makeCard('d1', '桃', '♥'),
        d2: makeCard('d2', '酒', '♣'),
        d3: makeCard('d3', '杀', '♠'),
        d4: makeCard('d4', '闪', '♦'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙坚 = harness.player('孙坚');
    const P1 = harness.player('P1');

    triggerReadyPhase(harness);
    await waitForStable(harness.state); // confirm 询问
    孙坚.expectPending('请求回应');
    await 孙坚.respond('英魂', { choice: true }); // 发动

    await waitForStable(harness.state); // choosePlayer 询问
    await 孙坚.respond('英魂', { targets: [1] }); // 选 P1

    await waitForStable(harness.state); // 目标 option 询问
    P1.expectPending('请求回应');
    await P1.respond('英魂', { choice: true }); // 选项1(摸2弃1)

    await waitForStable(harness.state); // 目标选弃牌
    await P1.respond('英魂', { cardIds: ['p1a'] }); // 弃 p1a
    await harness.waitForStable();

    // P1 原2张 +摸2 -弃1 = 3张
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.players[1].hand).not.toContain('p1a');
    // 摸牌消耗牌堆2张
    expect(harness.state.zones.deck.length).toBe(2);
    // 弃牌堆含 p1a
    expect(harness.state.zones.discardPile).toContain('p1a');
  });

  // ─── 选项2:摸1弃X ──────────────────────────────────────────
  it('发动英魂 → 目标选选项2(摸1弃X):P1 摸1弃2,净-1', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 2,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1a', 'p1b'],
          skills: ['回合管理'],
          faction: '魏',
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        d1: makeCard('d1', '桃', '♥'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙坚 = harness.player('孙坚');
    const P1 = harness.player('P1');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { choice: true });
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { targets: [1] });
    await waitForStable(harness.state);
    await P1.respond('英魂', { choice: false }); // 选项2(摸1弃2)
    await waitForStable(harness.state);
    // P1 手牌:p1a,p1b + 摸1(d1) = 3张,需弃2
    await P1.respond('英魂', { cardIds: ['p1a', 'p1b'] });
    await harness.waitForStable();

    // P1 原2张 +摸1 -弃2 = 1张
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[1].hand).toContain('d1');
    expect(harness.state.zones.deck.length).toBe(0);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['p1a', 'p1b']));
  });

  // ─── 满血不触发 ──────────────────────────────────────────────
  it('孙坚满血(未受伤)→ 英魂不发动,无询问', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 4,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['p1a'], skills: ['回合管理'], faction: '魏' }),
      ],
      cardMap: { p1a: makeCard('p1a', '杀') },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    triggerReadyPhase(harness);
    await harness.waitForStable();

    // 无任何 pending(英魂未触发)
    expect(harness.state.pendingSlots.size).toBe(0);
    // 手牌不变
    expect(harness.state.players[1].hand.length).toBe(1);
  });

  // ─── 孙坚选择不发动 ──────────────────────────────────────────
  it('孙坚已受伤但选择不发动 → 无效果', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 2,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['p1a'], skills: ['回合管理'], faction: '魏' }),
      ],
      cardMap: { p1a: makeCard('p1a', '杀'), d1: makeCard('d1', '桃', '♥') },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙坚 = harness.player('孙坚');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    孙坚.expectPending('请求回应');
    await 孙坚.respond('英魂', { choice: false }); // 不发动
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].hand).toEqual(['p1a']);
    expect(harness.state.zones.deck.length).toBe(1); // 未摸牌
  });

  // ─── 目标超时默认选项1 ───────────────────────────────────────
  it('目标超时不选 → 默认选项1(摸X弃1)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙坚',
          health: 3,
          maxHealth: 4,
          hand: [],
          skills: ['英魂', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1a', 'p1b', 'p1c'],
          skills: ['回合管理'],
          faction: '魏',
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        p1c: makeCard('p1c', '桃', '♥'),
        d1: makeCard('d1', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    // X = 4-3 = 1:选项1 摸1弃1;选项2 摸1弃1(相同)→ 用超时验证默认走选项1分支
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const 孙坚 = harness.player('孙坚');
    const P1 = harness.player('P1');

    triggerReadyPhase(harness);
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { choice: true });
    await waitForStable(harness.state);
    await 孙坚.respond('英魂', { targets: [1] });
    await waitForStable(harness.state); // 目标 option 询问

    // 目标超时(pass)→ 默认选项1
    await P1.pass();
    await waitForStable(harness.state); // 弃牌询问(选项1 弃1)
    P1.expectPending('请求回应');
    await P1.respond('英魂', { cardIds: ['p1a'] });
    await harness.waitForStable();

    // P1 原3张 +摸1(d1) -弃1(p1a) = 3张
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.players[1].hand).toContain('d1');
    expect(harness.state.zones.discardPile).toContain('p1a');
  });
});
