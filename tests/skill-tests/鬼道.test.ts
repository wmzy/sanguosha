// 鬼道(张角·被动):判定牌生效前,可用一张黑色牌替换之。
//
// 覆盖:
//   1. 替换闪电判定牌(♠5→♣5黑色)→ 闪电不命中
//   2. 不替换 → 闪电命中
//   3. 用红色牌替换被拒(黑色限制)
//   4. 无黑色手牌 → 不询问
//
// 关键:鬼道注册为判定改判钩子,由 判定 atom 的 afterApply 阶段触发(逆时针从判定目标
// 起依次询问),严格先于消费方(闪电)的 after hook。改判是否生效不再依赖座次。
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

describe('鬼道', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 替换闪电判定牌(♠5→♣5黑色)→ 闪电不命中 ──────────────
  it('鬼道用♣5(黑色)替换♠5 → 闪电不命中', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 → 闪电命中(2-9)
    const replaceCard = makeCard('r1', '杀', '♣', '5'); // ♣5 黑色非黑桃 → 不命中
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          hand: ['r1'],
          skills: ['鬼道', '回合管理'],
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
      const P0 = harness.player('张角');

      void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
      await waitForStable(harness.state); // 无懈窗口
      await fireTimeoutAndWait(harness.state); // 跳过无懈
      await waitForStable(harness.state); // 鬼道询问

      // 鬼道用 ♣5(黑色)替换
      await P0.respond('鬼道', { choice: true, cardId: 'r1' });
      await waitForStable(harness.state);

      // 判定牌变为 ♣5(非黑桃)→ 闪电不命中 → P1 不受伤
      expect(harness.state.players[1].health).toBe(4);
      // 替换牌消耗,原判定牌进弃牌堆
      expect(harness.state.players[0].hand).not.toContain('r1');
      // 闪电传给下家(张角)
      expect(harness.state.players[0].pendingTricks.some((t) => t.name === '闪电')).toBe(true);
    } finally {
      restoreCompare();
    }
  });

  // ─── 2. 不替换 → 闪电命中 ──────────────────────────────────
  it('不发动鬼道 → 闪电♠5命中,P1 受3点伤害', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const hand = makeCard('r1', '杀', '♣', '5'); // 黑色牌但选择不用
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          hand: ['r1'],
          skills: ['鬼道', '回合管理'],
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
      cardMap: { sd1: lightningCard, j1: judgeCard, r1: hand },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('张角');

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state);
    await fireTimeoutAndWait(harness.state);
    await waitForStable(harness.state);

    // 选择不替换
    await P0.respond('鬼道', { choice: false });
    await waitForStable(harness.state);

    // ♠5 命中 → P1 受 3 点伤害
    expect(harness.state.players[1].health).toBe(1); // 4 - 3
    // 手牌未消耗
    expect(harness.state.players[0].hand).toContain('r1');
  });

  // ─── 3. 用红色牌替换被拒(黑色限制) ────────────────────────
  it('鬼道不能用红色牌替换 → 提交红色牌被拒,改用黑色牌成功', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 命中
    const redCard = makeCard('red1', '杀', '♥', '5'); // ♥5 红色 → 不允许
    const blackCard = makeCard('blk1', '杀', '♣', '5'); // ♣5 黑色 → 允许
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          hand: ['red1', 'blk1'],
          skills: ['鬼道', '回合管理'],
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
      const P0 = harness.player('张角');

      void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
      await waitForStable(harness.state);
      await fireTimeoutAndWait(harness.state);
      await waitForStable(harness.state); // 鬼道询问

      // 提交红色牌 → 被拒(鬼道限黑色)
      await P0.expectRejected({
        skillId: '鬼道',
        actionType: 'respond',
        params: { choice: true, cardId: 'red1' },
      });

      // 改用黑色牌 → 接受
      await P0.respond('鬼道', { choice: true, cardId: 'blk1' });
      await waitForStable(harness.state);

      // ♣5 非黑桃 → 闪电不命中
      expect(harness.state.players[1].health).toBe(4);
      expect(harness.state.players[0].hand).toContain('red1'); // 红色牌未消耗
      expect(harness.state.players[0].hand).not.toContain('blk1'); // 黑色牌已用
    } finally {
      restoreCompare();
    }
  });

  // ─── 4. 无黑色手牌 → 不询问 ────────────────────────────────
  it('张角无黑色手牌 → 鬼道不询问,直接判定', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const redHand = makeCard('r1', '杀', '♥', '5'); // 只有红色牌
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          hand: ['r1'],
          skills: ['鬼道', '回合管理'],
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
      cardMap: { sd1: lightningCard, j1: judgeCard, r1: redHand },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state);
    await fireTimeoutAndWait(harness.state); // 跳过无懈
    await waitForStable(harness.state); // 无鬼道询问(无黑色牌)→ 直接判定

    // ♠5 命中 → P1 受 3 点伤害(鬼道未介入)
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 5. 消费方座次靠前、改判方座次靠后 → 改判仍生效 ──────
  // 旧实现(挂判定 after-hook 靠注册序混排)下此场景改判失效。改用 afterApply 改判阶段后,
  // 改判严格先于消费方 after hook,与座次无关。
  it('闪电持有者(P0)座次靠前,张角(P1)座次靠后 → 鬼道改判仍生效', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 命中
    const replaceCard = makeCard('r1', '杀', '♣', '5'); // ♣5 黑色非黑桃 → 不命中
    const state: GameState = createGameState({
      players: [
        // P0=闪电持有者(消费方),座次靠前
        makePlayer({
          index: 0,
          name: '闪电主',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 0, card: lightningCard }],
          health: 4,
        }),
        // P1=张角(改判方),座次靠后
        makePlayer({
          index: 1,
          name: '张角',
          hand: ['r1'],
          skills: ['鬼道', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { sd1: lightningCard, j1: judgeCard, r1: replaceCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    const restoreCompare = disableAutoCompare();
    try {
      state.zones = { deck: ['j1'], discardPile: [], processing: [] };
      await harness.setup(state);
      const P1 = harness.player('张角');

      void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
      await waitForStable(harness.state);
      await fireTimeoutAndWait(harness.state); // 跳过无懈
      await waitForStable(harness.state); // 鬼道询问(逆时针从 P0 起,问到 P1)

      // 张角(P1)用 ♣5(黑色)替换 ♠5
      await P1.respond('鬼道', { choice: true, cardId: 'r1' });
      await waitForStable(harness.state);

      // 改判生效:判定牌变 ♣5 → 闪电不命中 → P0 不受伤
      expect(harness.state.players[0].health).toBe(4);
      // 闪电传给下家(张角)
      expect(harness.state.players[1].pendingTricks.some((t) => t.name === '闪电')).toBe(true);
      // 替换牌消耗
      expect(harness.state.players[1].hand).not.toContain('r1');
    } finally {
      restoreCompare();
    }
  });
});
