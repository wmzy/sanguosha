// 雷击(张角·被动):当你使用或打出【闪】时,可令任意一名角色判定,
// 若结果为黑桃,你对该角色造成2点雷电伤害。
//
// 覆盖:
//   1. 打闪→雷击→选目标→判定黑桃→造成2点雷电伤害(happy path)
//   2. 打闪→雷击→判定非黑桃→无伤害
//   3. 打闪→雷击→放弃发动→无判定无伤害
//   4. 被询问闪但未出闪→雷击不触发
//   5. 组合:打闪→雷击→鬼道改判为黑桃→命中(雷击+鬼道联动)
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SkillTestHarness,
  waitForStable,
  disableAutoCompare,
} from '../engine-harness';
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
  character?: string;
  faction?: '魏' | '蜀' | '吴' | '群';
  hand?: string[];
  skills?: string[];
  health?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    faction: opts.faction,
  };
}

describe('雷击', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 打闪→雷击→黑桃→2点雷电伤害 ──────────────────────────
  it('张角打闪触发雷击,判定黑桃→目标受2点雷电伤害', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // 黑桃5 → 命中
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: ['d1'],
          skills: ['雷击', '闪', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge, k1: kill, j1: judge },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('张角');
    const P1 = harness.player('攻击者');

    // P1 对张角出杀
    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state); // 张角被询问闪
    P0.expectPending('询问闪');

    // 张角出闪
    await P0.respond('闪', { cardId: 'd1' });
    await waitForStable(harness.state); // 雷击触发:询问选目标

    // 雷击询问选择目标
    P0.expectPending('请求回应');
    await P0.respond('雷击', { target: 1 });
    await waitForStable(harness.state);

    // 黑桃5 → P1 受 2 点雷电伤害(杀被闪抵消,张角不掉血)
    expect(harness.state.players[1].health).toBe(2); // 4 - 2
    expect(harness.state.players[0].health).toBe(3); // 张角未受伤(闪抵消杀)
  });

  // ─── 2. 判定非黑桃→无伤害 ──────────────────────────────────
  it('判定结果非黑桃(♥5)→目标不受伤害', async () => {
    const dodge = makeCard('d1', '闪', '♠', '3');
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♥', '5'); // ♥5 → 非黑桃,不命中
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: ['d1'],
          skills: ['雷击', '闪', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge, k1: kill, j1: judge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('张角');
    const P1 = harness.player('攻击者');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state);
    await P0.respond('闪', { cardId: 'd1' });
    await waitForStable(harness.state);
    await P0.respond('雷击', { target: 1 });
    await waitForStable(harness.state);

    // ♥5 非黑桃 → 无伤害(杀仍被闪抵消)
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 3. 放弃发动雷击 ──────────────────────────────────────
  it('张角选择不发动雷击(pass)→无判定无伤害', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: ['d1'],
          skills: ['雷击', '闪', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge, k1: kill, j1: judge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('张角');
    const P1 = harness.player('攻击者');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state);
    await P0.respond('闪', { cardId: 'd1' });
    await waitForStable(harness.state);
    P0.expectPending('请求回应'); // 雷击询问

    // 放弃(pass = 超时)
    await P0.pass();
    await waitForStable(harness.state);

    // 未判定 → 判定牌仍在牌堆顶(j1 未被消耗)
    expect(harness.state.zones.deck).toContain('j1');
    // 双方无伤害
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 4. 未出闪→雷击不触发 ────────────────────────────────
  it('张角被询问闪但未出闪(pass)→雷击不触发', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: [], // 无闪
          skills: ['雷击', '闪', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { k1: kill, j1: judge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('张角');
    const P1 = harness.player('攻击者');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await waitForStable(harness.state);
    P0.expectPending('询问闪');

    // 张角不出闪
    await P0.pass();
    await waitForStable(harness.state);

    // 雷击未触发:无 请求回应 pending;判定牌未被消耗
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.zones.deck).toContain('j1');
    // 杀命中:张角受 1 点伤害(无闪)
    expect(harness.state.players[0].health).toBe(2); // 3 - 1
    // 攻击者不受雷击伤害
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 5. 组合:雷击+鬼道 改判为黑桃命中 ────────────────────
  it('张角打闪→雷击→鬼道把判定牌改为黑桃→命中2点雷电伤害', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♥', '5'); // ♥5 原本不命中
    const replace = makeCard('r1', '杀', '♠', '3'); // ♠3 黑色牌 → 鬼道改判命中
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: ['d1', 'r1'], // 闪 + 鬼道替换牌
          skills: ['雷击', '鬼道', '闪', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          hand: ['k1'],
          skills: ['杀', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge, k1: kill, j1: judge, r1: replace },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // 鬼道替换判定牌(直接 mutate frameCards)→ processedView 与 buildView 不对称(同鬼才),关闭自动对比
    const restoreCompare = disableAutoCompare();
    try {
      state.zones = { deck: ['j1'], discardPile: [], processing: [] };
      await harness.setup(state);
      const P0 = harness.player('张角');
      const P1 = harness.player('攻击者');

      await P1.useCardAndTarget('杀', 'k1', [0]);
      await waitForStable(harness.state);
      await P0.respond('闪', { cardId: 'd1' });
      await waitForStable(harness.state);
      // 雷击询问选目标
      P0.expectPending('请求回应');
      await P0.respond('雷击', { target: 1 });
      await waitForStable(harness.state);
      // 判定后 → 鬼道询问是否替换
      P0.expectPending('请求回应');

      // 鬼道:用 ♠3 替换 ♥5
      await P0.respond('鬼道', { choice: true, cardId: 'r1' });
      await waitForStable(harness.state);

      // 改判为 ♠3(黑桃)→ P1 受 2 点雷电伤害
      expect(harness.state.players[1].health).toBe(2); // 4 - 2
      // 替换牌消耗
      expect(harness.state.players[0].hand).not.toContain('r1');
    } finally {
      restoreCompare();
    }
  });
});
