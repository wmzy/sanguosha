// 荐降(蒯越蒯良·魏·被动技)测试
//   当你成为其他角色使用牌的目标后，你可以令手牌数最少的一名角色摸一张牌。
//
// 验证:
//   1. 成为他人杀的目标 → 发动荐降 → 手牌数最少者(自己)摸一张
//   2. 不发动 → 不摸牌
//   3. 并列最少 → choosePlayer 选择目标摸牌
//   4. 令其他最少手牌角色摸牌
//   5. 自己使用牌以自己为目标(桃) → 不触发(仅"其他角色")
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { skillLoaders } from '../../src/engine/skills';
import 荐降Mod from '../../src/engine/skills/荐降';
import 审时Mod from '../../src/engine/skills/审时';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card } from '../../src/engine/types';

// 运行时注册(subagent 不碰 index.ts 源文件;主 agent 统一注册)。
// 此处赋值让测试可加载技能模块;主 agent 在 index.ts 注册后,同 key 覆盖无副作用。
skillLoaders['荐降'] = async () => 荐降Mod;
skillLoaders['审时'] = async () => 审时Mod;

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
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '蒯越蒯良',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('荐降', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 成为他人杀的目标 → 发动荐降 → 自己(最少手牌)摸一张 ────────
  it('成为他人杀的目标,发动荐降,自己(手牌最少)摸一张', async () => {
    // deck 顶(d4)为 闪,保证 P0 摸到后 询问闪 为 normal pending(可 pass 不闪)
    const deck = ['d1', 'd2', 'd3', 'd4'].map((id, i) =>
      makeCard(id, i === 3 ? '闪' : '杀', '♠', '2'),
    );
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['荐降'] }), // 0 手牌(最少)
        // P1 带 2 张额外牌,出杀后仍持有 2 张,避免与 P0(0)并列最少
        makePlayer({ index: 1, name: 'P1', hand: ['s1', 'k1', 'k2'], character: '张飞' }),
        makePlayer({ index: 2, name: 'P2', hand: ['a', 'b', 'c'], character: '刘备' }),
      ],
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        k1: makeCard('k1', '闪', '♣', '2'),
        k2: makeCard('k2', '闪', '♣', '3'),
        a: makeCard('a', '闪', '♥', '2'),
        b: makeCard('b', '闪', '♥', '3'),
        c: makeCard('c', '闪', '♥', '4'),
        ...Object.fromEntries(deck.map((crd) => [crd.id, crd])),
      },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      zones: { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    expect(harness.state.players[0].hand.length).toBe(0); // 初始 0

    // P1 对 P0 出杀(P1 出杀后手牌 2 张,仍多于 P0)
    await P1.useCardAndTarget('杀', 's1', [0]);

    // 第一个 pending:荐降 confirm(成目标后时机,先于 询问闪)
    P0.expectPending('请求回应');

    // 发动荐降 → P0(0)为唯一最少 → 直接摸一张
    await P0.respond('荐降', { choice: true });

    // P0 摸一张(deck 顶 d4=闪)
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.players[0].hand).toContain('d4');

    // 询问闪(normal:P0 有闪)→ P0 不闪
    P0.expectPending('询问闪');
    await P0.pass();

    // P0 受 1 点伤害(未闪)
    expect(harness.state.players[0].health).toBe(2);
  });

  // ─── 不发动荐降 → 不摸牌 ────────────────────────────
  it('不发动荐降 → 不摸牌', async () => {
    const deck = ['d1', 'd2'].map((id) => makeCard(id, '闪', '♠', '2'));
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['荐降'] }),
        // P1 带额外牌,出杀后不与 P0(0)并列
        makePlayer({ index: 1, name: 'P1', hand: ['s1', 'k1'], character: '张飞' }),
      ],
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        k1: makeCard('k1', '闪', '♣', '2'),
        ...Object.fromEntries(deck.map((c) => [c.id, c])),
      },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    await P1.useCardAndTarget('杀', 's1', [0]);
    P0.expectPending('请求回应');
    await P0.respond('荐降', { choice: false }); // 不发动

    expect(harness.state.players[0].hand.length).toBe(0); // 未摸牌
    // P0 无手牌 → 询问闪 skip → 直接受伤
    expect(harness.state.players[0].health).toBe(2);
  });

  // ─── 并列最少 → choosePlayer 选择目标摸牌 ────────────────────
  it('并列最少手牌 → choosePlayer 选择一名最少者摸牌', async () => {
    const deck = ['d1', 'd2'].map((id) => makeCard(id, '闪', '♠', '2'));
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['x'], skills: ['荐降'] }), // 1 张
        makePlayer({ index: 1, name: 'P1', hand: ['s1', 'y'], character: '张飞' }), // 2 张
        makePlayer({ index: 2, name: 'P2', hand: ['z'], character: '刘备' }), // 1 张(并列最少)
      ],
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        x: makeCard('x', '闪', '♥', '2'),
        y: makeCard('y', '闪', '♥', '3'),
        z: makeCard('z', '闪', '♥', '4'),
        ...Object.fromEntries(deck.map((c) => [c.id, c])),
      },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(1);

    // P1 对 P0 出杀 → P0 成为目标
    await P1.useCardAndTarget('杀', 's1', [0]);

    // 荐降 confirm
    P0.expectPending('请求回应');
    await P0.respond('荐降', { choice: true });

    // P0 与 P2 并列最少(各 1)→ choosePlayer 询问
    P0.expectPending('请求回应');
    // P0 选择 P2 摸牌
    await P0.respond('荐降', { targets: [2] });

    expect(harness.state.players[2].hand.length).toBe(2); // P2 摸了一张
    expect(harness.state.players[0].hand.length).toBe(1); // P0 未变

    // 询问闪 → 不闪
    P0.expectPending('询问闪');
    await P0.pass();
  });

  // ─── 令其他最少手牌角色摸牌 ────────────────────────────
  it('其他角色手牌最少 → 该角色摸一张', async () => {
    const deck = ['d1', 'd2'].map((id) => makeCard(id, '闪', '♠', '2'));
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['p', 'q'], skills: ['荐降'] }), // 2 张
        makePlayer({ index: 1, name: 'P1', hand: ['s1', 'r', 't'], character: '张飞' }), // 3 张(最多)
        makePlayer({ index: 2, name: 'P2', hand: [], character: '刘备' }), // 0 张(最少)
      ],
      cardMap: {
        s1: makeCard('s1', '杀', '♠', '7'),
        p: makeCard('p', '闪', '♥', '2'),
        q: makeCard('q', '闪', '♥', '3'),
        r: makeCard('r', '闪', '♥', '4'),
        t: makeCard('t', '闪', '♥', '5'),
        ...Object.fromEntries(deck.map((c) => [c.id, c])),
      },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    // P1 对 P0 出杀
    await P1.useCardAndTarget('杀', 's1', [0]);

    P0.expectPending('请求回应');
    await P0.respond('荐降', { choice: true });

    // 最少手牌是 P2(0 张)→ P2 直接摸一张(无需选择)
    expect(harness.state.players[2].hand.length).toBe(1);
    expect(harness.state.players[0].hand.length).toBe(2); // P0 未变

    P0.expectPending('询问闪');
    await P0.pass();
  });

  // ─── 自己使用牌以自己为目标 → 不触发(仅"其他角色")────────────
  it('自己对自己使用桃 → 不触发荐降', async () => {
    const deck = ['d1', 'd2'].map((id) => makeCard(id, '闪', '♠', '2'));
    const state = createGameState({
      players: [
        // P0 受过伤(hp=2),可对自己用桃回血
        makePlayer({ index: 0, name: 'P0', hand: ['peach'], skills: ['荐降'], health: 2 }),
        makePlayer({ index: 1, name: 'P1', hand: ['a', 'b'], character: '张飞' }),
      ],
      cardMap: {
        peach: makeCard('peach', '桃', '♥', 'A'),
        a: makeCard('a', '闪', '♣', '2'),
        b: makeCard('b', '闪', '♣', '3'),
        ...Object.fromEntries(deck.map((c) => [c.id, c])),
      },
      currentPlayerIndex: 0, // P0 自己回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P0 对自己用桃(回血)
    await P0.useCardAndTarget('桃', 'peach', [0]);

    // 不应触发荐降(自己对自己);P0 应已回血且无荐降 pending
    expect(harness.state.players[0].health).toBe(3); // 回 1 点
    // 无 pending(荐降未触发,桃结算完毕,出牌窗口继续)
    P0.expectNoPending();
  });
});
