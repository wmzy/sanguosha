// 界巧说(界简雍·蜀·主动技)测试
//   出牌阶段,你可以拼点:若你赢,本回合使用的下一张牌可以多指定或少指定一个目标;
//   若你没赢,此技能失效且你不能使用锦囊牌直到回合结束。
//
// 验证:
//   1. 赢 → turn.vars['巧说/winNext'] 置位;两张拼点牌进弃牌堆;限一次标记
//   2. 赢 → 下一张牌打出后 winNext 自动清除(消费)
//   3. 输 → turn.vars['巧说/lost'] 置位;后续不能使用普通锦囊牌(过河拆桥被拒)
//   4. 平 → 算没赢,lost 置位 + 不能用普通锦囊
//   5. 没赢 → 仍可使用基本牌(杀/桃 等不受 trickBlocker 影响)
//   6. 每回合限一次:第二次被拒
//   7. 目标无手牌 → 拒绝
//   8. 不是自己回合 → 拒绝
//   9. 不能与自己拼点
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { isTrickBlocked } from '../../src/engine/trick-quota';
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

function makeTrick(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return {
    id,
    name,
    suit,
    color: suitColor(suit),
    rank,
    type: '锦囊牌',
    trickSubtype: '普通锦囊',
  };
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
    character: '界简雍',
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

describe('界巧说', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 赢 → winNext 置位 + 牌进弃牌堆 + 限一次 ──────────────────
  it('拼点赢 → turn.vars[巧说/winNext] 置位,两张拼点牌进弃牌堆,限一次标记', async () => {
    const ownerHigh = makeCard('c1', '杀', '♠', 'K');
    const targetLow = makeCard('c2', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界巧说'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerHigh, c2: targetLow },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界巧说', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界巧说', { cardId: 'c2' });
    await waitForStable(harness.state);

    expect(harness.state.turn.vars['巧说/winNext']).toBe(0);
    expect(harness.state.turn.vars['巧说/lost']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
    expect(harness.state.players[0].vars['界巧说/usedThisTurn']).toBe(true);
  });

  // ─── 2. 赢 → 下一张牌打出后 winNext 自动清除(消费)──────────────
  it('拼点赢 → 下张牌打出后 winNext 自动清除', async () => {
    const pdWin = makeCard('c1', '杀', '♠', 'K');
    const pdLow = makeCard('c2', '闪', '♥', '2');
    const slash = makeCard('s1', '杀', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 's1'],
          skills: ['界巧说', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: pdWin, c2: pdLow, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 拼点并赢
    await P0.triggerAction('界巧说', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界巧说', { cardId: 'c2' });
    await waitForStable(harness.state);

    expect(harness.state.turn.vars['巧说/winNext']).toBe(0);

    // 出下一张牌(杀)
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    await waitForStable(harness.state);

    // winNext 已被消费清除
    expect(harness.state.turn.vars['巧说/winNext']).toBeUndefined();
  });

  // ─── 3. 输 → lost 置位 + 不能使用普通锦囊 ─────────────────────
  it('拼点没赢 → turn.vars[巧说/lost] 置位 + isTrickBlocked(P0)=true + 过河拆桥被拒', async () => {
    const ownerLow = makeCard('c1', '杀', '♠', '2');
    const targetHigh = makeCard('c2', '闪', '♥', 'K');
    const trick = makeTrick('t1', '过河拆桥', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 't1'],
          skills: ['界巧说', '过河拆桥'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerLow, c2: targetHigh, t1: trick },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界巧说', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界巧说', { cardId: 'c2' });
    await waitForStable(harness.state);

    expect(harness.state.turn.vars['巧说/lost']).toBe(0);
    expect(isTrickBlocked(harness.state, 0)).toBe(true);

    // 出过河拆桥被拒(普通锦囊被阻断)
    await P0.expectRejected({
      skillId: '过河拆桥',
      actionType: 'use',
      params: { cardId: 't1', targets: [1] },
    });
    // t1 仍在 P0 手牌
    expect(harness.state.players[0].hand).toContain('t1');
  });

  // ─── 4. 平 → 算没赢,lost 置位 + trickBlocker 拦截 ────────────
  it('拼点平局(点数相等)→ 算没赢,本回合不能使用普通锦囊', async () => {
    const ownerK = makeCard('c1', '杀', '♠', 'K');
    const targetK = makeCard('c2', '闪', '♥', 'K');
    const trick = makeTrick('t1', '无中生有', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 't1'],
          skills: ['界巧说', '无中生有'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerK, c2: targetK, t1: trick },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界巧说', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界巧说', { cardId: 'c2' });
    await waitForStable(harness.state);

    expect(harness.state.turn.vars['巧说/winNext']).toBeUndefined();
    expect(harness.state.turn.vars['巧说/lost']).toBe(0);
    expect(isTrickBlocked(harness.state, 0)).toBe(true);

    // 无中生有被拒
    await P0.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 't1' },
    });
  });

  // ─── 5. 没赢 → 仍可使用基本牌(杀不受 trickBlocker 影响)───────
  it('拼点没赢 → trickBlocker 不影响基本牌(杀仍可使用)', async () => {
    const ownerLow = makeCard('c1', '杀', '♠', '2');
    const targetHigh = makeCard('c2', '闪', '♥', 'K');
    const slash = makeCard('s1', '杀', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 's1'],
          skills: ['界巧说', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: ownerLow, c2: targetHigh, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界巧说', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界巧说', { cardId: 'c2' });
    await waitForStable(harness.state);

    expect(isTrickBlocked(harness.state, 0)).toBe(true);

    // 出杀仍可(基本牌不受 trickBlocker 影响)
    await P0.useCardAndTarget('杀', 's1', [1]);
    await P1.pass();
    await waitForStable(harness.state);

    // 杀成功造成伤害
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 6. 每回合限一次 ────────────────────────────────────────
  it('每回合限一次:第二次发动被拒', async () => {
    const pdA = makeCard('c1', '杀', '♠', 'K');
    const pdB = makeCard('c2', '闪', '♥', '2');
    const pdC = makeCard('c3', '杀', '♣', 'Q');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c3'],
          skills: ['界巧说'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: pdA, c2: pdB, c3: pdC },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界巧说', 'use', { cardId: 'c1', target: 1 });
    await waitForStable(harness.state);
    await P1.respond('界巧说', { cardId: 'c2' });
    await waitForStable(harness.state);

    // 第二次发动被拒(限一次)
    await P0.expectRejected({
      skillId: '界巧说',
      actionType: 'use',
      params: { cardId: 'c3', target: 1 },
    });
  });

  // ─── 7. 目标无手牌 → 拒绝 ─────────────────────────────────
  it('目标无手牌 → use 被拒绝', async () => {
    const pd = makeCard('c1', '杀', '♠', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界巧说'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: pd },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界巧说',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  // ─── 8. 不是自己回合 → 拒绝 ───────────────────────────────
  it('不是自己回合 → use 被拒绝', async () => {
    const pd = makeCard('c1', '杀', '♠', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界巧说'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: pd },
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界巧说',
      actionType: 'use',
      params: { cardId: 'c1', target: 1 },
    });
  });

  // ─── 9. 不能与自己拼点 ───────────────────────────────────
  it('不能与自己拼点:target=self 被拒', async () => {
    const pd = makeCard('c1', '杀', '♠', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界巧说'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['c2'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: { c1: pd },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界巧说',
      actionType: 'use',
      params: { cardId: 'c1', target: 0 },
    });
  });
});
