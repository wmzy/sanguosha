// 天义(太史慈·吴·主动技)技能测试:
//   出牌阶段限一次,与一名角色拼点:
//     赢 → 本回合攻击范围无限、可额外使用一张杀、杀可额外指定一个目标
//     没赢(输或平)→ 本回合不能使用杀
//
// 覆盖:
//   1. 赢 → turn.vars['天义/win'] 置位;两张拼点牌进弃牌堆;限一次标记
//   2. 赢 → 可额外使用一张杀(slashMax +1,连续出两杀)
//   3. 赢 → 攻击范围无限 + 额外目标(一张杀打远距离的两名角色)
//   4. 没赢 → 不能使用杀(出杀被拒)
//   5. 平局 → 算没赢(禁杀)
//   6. 每回合限一次(第二次被拒)
//   7. 目标无手牌 → 拒绝
//   8. 不是自己回合 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { slashMax, canSlash, isSlashBlocked } from '../../src/engine/slash-quota';
import { inAttackRange } from '../../src/engine/distance';
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
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
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

describe('天义', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 赢 → win 标记置位、牌进弃牌堆、限一次 ───────────────
  it('太史慈拼点赢 → turn.vars[天义/win] 置位,两张拼点牌进弃牌堆,限一次标记', async () => {
    const win = makeCard('c1', '杀', '♠', 'K');
    const low = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '太史慈', hand: ['c1'], skills: ['天义'] }),
        makePlayer({ index: 1, name: '目标', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: win, c2: low },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('太史慈');
    const P1 = harness.player('目标');

    await P0.triggerAction('天义', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('天义', { cardId: 'c2' });
    await waitForStable(harness.state);

    expect(harness.state.turn.vars['天义/win']).toBe(0);
    expect(harness.state.turn.vars['天义/lost']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
    expect(harness.state.players[0].vars['天义/usedThisTurn']).toBe(true);
  });

  // ─── 2. 赢 → 可额外使用一张杀(slashMax +1,连续两杀)─────────
  it('拼点赢 → slashMax 变 2,本回合可连续使用两张杀', async () => {
    const pdWin = makeCard('c1', '闪', '♠', 'K');
    const pdLow = makeCard('c2', '杀', '♥', '2');
    const slash1 = makeCard('s1', '杀', '♠', '5');
    const slash2 = makeCard('s2', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '太史慈', hand: ['c1', 's1', 's2'], skills: ['天义', '杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: pdWin, c2: pdLow, s1: slash1, s2: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('太史慈');
    const P1 = harness.player('P2');

    // 发动天义并赢(K > 2)
    await P0.triggerAction('天义', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('天义', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 赢后上限 +1 → 2
    expect(slashMax(harness.state, 0)).toBe(2);
    expect(canSlash(harness.state, 0)).toBe(true);

    // 第一张杀:P2 不闪 → -1
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    expect(harness.state.players[1].health).toBe(3);
    // 已用 1,上限 2,仍可出
    expect(canSlash(harness.state, 0)).toBe(true);

    // 第二张杀(额外那一张):P2 不闪 → 再 -1
    await P0.useCardAndTarget('杀', 's2', [1]);
    await P1.pass();
    expect(harness.state.players[1].health).toBe(2);
    // 用尽上限
    expect(canSlash(harness.state, 0)).toBe(false);
  });

  // ─── 3. 赢 → 攻击范围无限 + 额外目标(一张杀打远距离两名)──────
  it('拼点赢 → 攻击范围无限,一张杀可指定远距离的额外目标', async () => {
    const pdWin = makeCard('c1', '闪', '♠', 'K');
    const pdLow = makeCard('c2', '杀', '♥', '2');
    const slash = makeCard('s1', '杀', '♠', '5');
    // 4 人环形:P0→P2 座位距离 2,徒手出杀范围 1 → 平时打不到 P2
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '太史慈', hand: ['c1', 's1'], skills: ['天义', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['c2'], skills: ['回合管理'] }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['回合管理'] }),
        makePlayer({ index: 3, name: 'P3', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { c1: pdWin, c2: pdLow, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('太史慈');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 基线:未赢天义前,P0 打不到 P2(距离 2 > 范围 1)
    expect(inAttackRange(harness.state, 0, 2)).toBe(false);

    // 发动天义并赢
    await P0.triggerAction('天义', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('天义', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 赢后攻击范围无限:P2 现在在范围内
    expect(inAttackRange(harness.state, 0, 2)).toBe(true);

    // 一张杀额外指定两个目标 [1,2](2 是远距离目标,靠天义放行)
    await P0.useCardAndTarget('杀', 's1', [1, 2]);
    await P1.pass(); // P1 不闪
    await P2.pass(); // P2 不闪

    // 两名目标各受 1 点伤害
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 4. 没赢 → 不能使用杀 ────────────────────────────────
  it('拼点没赢 → 本回合不能使用杀(出杀被 validate 拒绝)', async () => {
    const pdLow = makeCard('c1', '闪', '♠', '2');
    const pdHigh = makeCard('c2', '杀', '♥', 'K');
    const slash = makeCard('s1', '杀', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '太史慈', hand: ['c1', 's1'], skills: ['天义', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: pdLow, c2: pdHigh, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('太史慈');
    const P1 = harness.player('P1');

    await P0.triggerAction('天义', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('天义', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 没赢 → lost 标记 + 阻断
    expect(harness.state.turn.vars['天义/lost']).toBe(0);
    expect(isSlashBlocked(harness.state, 0)).toBe(true);
    expect(canSlash(harness.state, 0)).toBe(false);

    // 出杀被拒
    await P0.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: 's1', targets: [1] } });
  });

  // ─── 4b. 没赢 + 连弩 → 仍不能用杀(阻断器覆盖连弩的 ∞ 上限)──
  //  官方"不能使用杀"含连弩场景:slashBlocker 优先于 slashMax,canSlash 恒 false。
  it('拼点没赢 + 装备诸葛连弩 → 仍然不能使用杀(官方:含连弩也不能用)', async () => {
    const pdLow = makeCard('c1', '闪', '♠', '2');
    const pdHigh = makeCard('c2', '杀', '♥', 'K');
    const slash = makeCard('s1', '杀', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '太史慈', hand: ['c1', 's1'], skills: ['天义', '杀', '诸葛连弩'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: pdLow, c2: pdHigh, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('太史慈');
    const P1 = harness.player('P1');

    await P0.triggerAction('天义', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('天义', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 连弩使 slashMax = ∞,但天义阻断器优先 → canSlash 仍为 false
    expect(slashMax(harness.state, 0)).toBe(Infinity);
    expect(isSlashBlocked(harness.state, 0)).toBe(true);
    expect(canSlash(harness.state, 0)).toBe(false);

    // 出杀被拒(即使连弩在身)
    await P0.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: 's1', targets: [1] } });
  });

  // ─── 5. 平局算没赢 → 禁杀 ────────────────────────────────
  it('拼点平局(点数相等)→ 算没赢,本回合不能使用杀', async () => {
    const pdA = makeCard('c1', '闪', '♠', 'K');
    const pdB = makeCard('c2', '杀', '♥', 'K');
    const slash = makeCard('s1', '杀', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '太史慈', hand: ['c1', 's1'], skills: ['天义', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: pdA, c2: pdB, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('太史慈');
    const P1 = harness.player('P1');

    await P0.triggerAction('天义', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('天义', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 平局算没赢:win 未置位,lost 置位
    expect(harness.state.turn.vars['天义/win']).toBeUndefined();
    expect(harness.state.turn.vars['天义/lost']).toBe(0);
    expect(canSlash(harness.state, 0)).toBe(false);
  });

  // ─── 6. 每回合限一次 ────────────────────────────────────
  it('每回合限一次:第二次发动被拒绝', async () => {
    const pdA = makeCard('c1', '闪', '♠', 'K');
    const pdB = makeCard('c2', '杀', '♥', '2');
    const pdC = makeCard('c3', '闪', '♣', 'Q');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '太史慈', hand: ['c1', 'c3'], skills: ['天义'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: pdA, c2: pdB, c3: pdC },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('太史慈');
    const P1 = harness.player('P1');

    await P0.triggerAction('天义', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('天义', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 第二次发动被拒(限一次)
    await P0.expectRejected({ skillId: '天义', actionType: 'use', params: { cardId: 'c3', target: 1 } });
  });

  // ─── 7. 目标无手牌 → 拒绝 ───────────────────────────────
  it('目标无手牌 → use 被拒绝', async () => {
    const pd = makeCard('c1', '闪', '♠', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '太史慈', hand: ['c1'], skills: ['天义'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { c1: pd },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('太史慈');

    await P0.expectRejected({ skillId: '天义', actionType: 'use', params: { cardId: 'c1', target: 1 } });
  });

  // ─── 8. 不是自己回合 → 拒绝 ──────────────────────────────
  it('不是自己回合 → use 被拒绝', async () => {
    const pd = makeCard('c1', '闪', '♠', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '太史慈', hand: ['c1'], skills: ['天义'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['c2'], skills: ['回合管理'] }),
      ],
      cardMap: { c1: pd },
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('太史慈');

    await P0.expectRejected({ skillId: '天义', actionType: 'use', params: { cardId: 'c1', target: 1 } });
  });
});
