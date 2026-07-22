// 界鬼道(界张角·被动):判定牌生效前,可用一张黑色牌替换之;
//   若此黑色牌为黑桃2~9,你摸一张牌。
//
// 覆盖:
//   1. 用♣5(黑色非黑桃)替换 → 替换成功,不摸牌
//   2. 用♠3(黑桃2-9)替换 → 替换成功 + 摸一张牌(界限突破新增)
//   3. 用♠A(黑桃非2-9)替换 → 替换成功,不摸牌
//   4. 不替换 → 无摸牌
//   5. 用红色牌替换被拒(黑色限制)
//   6. 无黑色手牌 → 不询问
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SkillTestHarness,
  waitForStable,
  fireTimeoutAndWait,
  disableAutoCompare,
} from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
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
  skills?: string[];
  pendingTricks?: Array<{ name: string; source: number; card: Card }>;
  health?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    tags: [],
  };
}

describe('界鬼道', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 用♣5(黑色非黑桃)替换 → 替换成功,不摸牌 ──────────────
  it('界鬼道用♣5替换 → 闪电不命中,不摸牌', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 → 闪电命中(2-9)
    const replaceCard = makeCard('r1', '杀', '♣', '5'); // ♣5 黑色非黑桃 → 不命中,不摸牌
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          hand: ['r1'],
          skills: ['界鬼道', '回合管理'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: '闪电主',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 1, card: lightningCard }],
          health: 4,
        }),
      ],
      cardMap: { sd1: lightningCard, j1: judgeCard, r1: replaceCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    const restoreCompare = disableAutoCompare();
    try {
      state.zones = { deck: ['j1'], discardPile: [], processing: [] };
      await harness.setup(state);
      const P0 = harness.player('界张角');

      void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
      await waitForStable(harness.state); // 无懈窗口
      await fireTimeoutAndWait(harness.state); // 跳过无懈
      await waitForStable(harness.state); // 界鬼道询问

      // 界鬼道用 ♣5(黑色)替换
      await P0.respond('界鬼道', { choice: true, cardId: 'r1' });
      await waitForStable(harness.state);

      // 判定牌变为 ♣5(非黑桃)→ 闪电不命中 → P1 不受伤
      expect(harness.state.players[1].health).toBe(4);
      // 替换牌消耗,原判定牌进弃牌堆
      expect(harness.state.players[0].hand).not.toContain('r1');
      // ♣5 非黑桃2-9 → 不摸牌(手牌仍为空)
      expect(harness.state.players[0].hand.length).toBe(0);
      // 闪电传给下家(界张角)
      expect(harness.state.players[0].pendingTricks.some((t) => t.name === '闪电')).toBe(true);
    } finally {
      restoreCompare();
    }
  });

  // ─── 2. 用♠3(黑桃2-9)替换 → 替换成功 + 摸一张牌 ──────────────
  it('界鬼道用♠3(黑桃2-9)替换 → 替换成功且摸一张牌', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 → 闪电命中
    const replaceCard = makeCard('r1', '杀', '♠', '3'); // ♠3 黑桃2-9 → 替换+摸牌
    const drawCard = makeCard('dd1', '杀', '♥', '4'); // 摸牌堆顶
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          hand: ['r1'],
          skills: ['界鬼道', '回合管理'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: '闪电主',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 1, card: lightningCard }],
          health: 4,
        }),
      ],
      cardMap: { sd1: lightningCard, j1: judgeCard, r1: replaceCard, dd1: drawCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    const restoreCompare = disableAutoCompare();
    try {
      // 牌堆顶是 dd1(摸牌将抽到),其下是 j1(判定牌)
      state.zones = { deck: ['j1', 'dd1'], discardPile: [], processing: [] };
      await harness.setup(state);
      const P0 = harness.player('界张角');

      void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
      await waitForStable(harness.state);
      await fireTimeoutAndWait(harness.state);
      await waitForStable(harness.state); // 界鬼道询问

      // 界鬼道用 ♠3(黑桃2-9)替换
      await P0.respond('界鬼道', { choice: true, cardId: 'r1' });
      await waitForStable(harness.state);

      // ♠3 黑桃2-9 → 摸一张牌(dd1)
      expect(harness.state.players[0].hand).toContain('dd1');
      // 替换牌 r1 已消耗
      expect(harness.state.players[0].hand).not.toContain('r1');
      // 判定牌变为 ♠3(黑桃2-9)→ 闪电仍命中 → P1 受 3 点伤害
      expect(harness.state.players[1].health).toBe(1); // 4 - 3
    } finally {
      restoreCompare();
    }
  });

  // ─── 3. 用♠A(黑桃非2-9)替换 → 替换成功,不摸牌 ───────────────
  it('界鬼道用♠A(黑桃非2-9)替换 → 替换成功但不摸牌', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 → 闪电命中
    const replaceCard = makeCard('r1', '杀', '♠', 'A'); // ♠A 黑桃非2-9 → 替换但不摸牌
    const drawCard = makeCard('dd1', '杀', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          hand: ['r1'],
          skills: ['界鬼道', '回合管理'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: '闪电主',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 1, card: lightningCard }],
          health: 4,
        }),
      ],
      cardMap: { sd1: lightningCard, j1: judgeCard, r1: replaceCard, dd1: drawCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    const restoreCompare = disableAutoCompare();
    try {
      state.zones = { deck: ['j1', 'dd1'], discardPile: [], processing: [] };
      await harness.setup(state);
      const P0 = harness.player('界张角');

      void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
      await waitForStable(harness.state);
      await fireTimeoutAndWait(harness.state);
      await waitForStable(harness.state);

      // 用 ♠A 替换
      await P0.respond('界鬼道', { choice: true, cardId: 'r1' });
      await waitForStable(harness.state);

      // ♠A 非黑桃2-9 → 不摸牌(dd1 仍在牌堆)
      expect(harness.state.players[0].hand).not.toContain('dd1');
      expect(harness.state.players[0].hand.length).toBe(0);
      // 替换牌 r1 已消耗
      expect(harness.state.players[0].hand).not.toContain('r1');
      // ♠A 非黑桃2-9 → 闪电不命中 → P1 不受伤
      expect(harness.state.players[1].health).toBe(4);
    } finally {
      restoreCompare();
    }
  });

  // ─── 4. 不替换 → 无摸牌 ──────────────────────────────────
  it('不发动界鬼道 → 闪电♠5命中,P1 受3点伤害,界张角不摸牌', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const hand = makeCard('r1', '杀', '♣', '5');
    const drawCard = makeCard('dd1', '杀', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          hand: ['r1'],
          skills: ['界鬼道', '回合管理'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: '闪电主',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 1, card: lightningCard }],
          health: 4,
        }),
      ],
      cardMap: { sd1: lightningCard, j1: judgeCard, r1: hand, dd1: drawCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1', 'dd1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界张角');

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state);
    await fireTimeoutAndWait(harness.state);
    await waitForStable(harness.state);

    // 选择不替换
    await P0.respond('界鬼道', { choice: false });
    await waitForStable(harness.state);

    // ♠5 命中 → P1 受 3 点伤害
    expect(harness.state.players[1].health).toBe(1); // 4 - 3
    // 手牌未消耗,未摸牌
    expect(harness.state.players[0].hand).toContain('r1');
    expect(harness.state.players[0].hand).not.toContain('dd1');
  });

  // ─── 5. 用红色牌替换被拒(黑色限制) ────────────────────────
  it('界鬼道不能用红色牌替换 → 提交红色牌被拒,改用黑色牌成功', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const redCard = makeCard('red1', '杀', '♥', '5'); // ♥5 红色 → 不允许
    const blackCard = makeCard('blk1', '杀', '♣', '5'); // ♣5 黑色 → 允许
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          hand: ['red1', 'blk1'],
          skills: ['界鬼道', '回合管理'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: '闪电主',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 1, card: lightningCard }],
          health: 4,
        }),
      ],
      cardMap: { sd1: lightningCard, j1: judgeCard, red1: redCard, blk1: blackCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    const restoreCompare = disableAutoCompare();
    try {
      state.zones = { deck: ['j1'], discardPile: [], processing: [] };
      await harness.setup(state);
      const P0 = harness.player('界张角');

      void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
      await waitForStable(harness.state);
      await fireTimeoutAndWait(harness.state);
      await waitForStable(harness.state);

      // 尝试用红色牌 → 被拒
      await P0.expectRejected({
        skillId: '界鬼道',
        actionType: 'respond',
        params: { choice: true, cardId: 'red1' },
      });

      // 改用黑色牌 → 成功
      await P0.respond('界鬼道', { choice: true, cardId: 'blk1' });
      await waitForStable(harness.state);

      // 替换成功:blk1 消耗,red1 仍在
      expect(harness.state.players[0].hand).not.toContain('blk1');
      expect(harness.state.players[0].hand).toContain('red1');
      // ♣5 替换 → 闪电不命中
      expect(harness.state.players[1].health).toBe(4);
    } finally {
      restoreCompare();
    }
  });

  // ─── 6. 无黑色手牌 → 不询问 ────────────────────────────────
  it('界张角无黑色手牌 → 界鬼道不询问,直接判定', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 → 命中
    const redOnly = makeCard('red1', '杀', '♥', '5'); // 仅红色手牌
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          hand: ['red1'],
          skills: ['界鬼道', '回合管理'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: '闪电主',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 1, card: lightningCard }],
          health: 4,
        }),
      ],
      cardMap: { sd1: lightningCard, j1: judgeCard, red1: redOnly },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('界张角');

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state);
    await fireTimeoutAndWait(harness.state);
    await waitForStable(harness.state); // 界鬼道不询问(无黑色手牌)

    // 界鬼道未触发(无 pending):直接判定完成
    expect(harness.state.pendingSlots.size).toBe(0);
    // ♠5 命中 → P1 受 3 点伤害
    expect(harness.state.players[1].health).toBe(1); // 4 - 3
    // 红色手牌未消耗
    expect(harness.state.players[0].hand).toContain('red1');
  });
});
