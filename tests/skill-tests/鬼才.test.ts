// tests/skill-tests/鬼才.test.ts
// 鬼才(司马懿·被动):判定牌生效前,可打出手牌代替之。
//
// 覆盖:
//   1. 替换闪电判定牌(♠5→♣5)→ 闪电不命中,目标不受伤
//   2. 不替换 → 闪电命中,目标受伤
//   3. 司马懿无手牌 → 不询问(直接判定)
//
// 关键:鬼才注册为判定改判钩子,由 判定 atom 的 afterApply 阶段触发(逆时针从判定目标
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
    judgeZone: [],
  };
}

describe('鬼才', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 替换闪电判定牌 → 闪电不命中 ──────────────────────────
  it('鬼才用♣5替换♠5判定 → 闪电不命中,P1 不受伤', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 → 闪电命中(2-9)
    const replaceCard = makeCard('r1', '杀', '♣', '5'); // ♣5 → 非黑桃,不命中
    const state: GameState = createGameState({
      players: [
        // P0=司马懿(鬼才),座次靠前 → afterHook 先注册先执行
        makePlayer({
          index: 0,
          name: '司马懿',
          hand: ['r1'],
          skills: ['鬼才', '回合管理'],
          health: 4,
        }),
        // P1=闪电持有者,判定阶段
        makePlayer({
          index: 1,
          name: '闪电主',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 1, card: lightningCard }],
          health: 4,
        }),
      ],
      cardMap: { sd1: lightningCard, j1: judgeCard, r1: replaceCard },
      currentPlayerIndex: 1, // P1 回合
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    // 判定 atom 视图模型局限:替换判定牌后 processedView 与 buildView 不对称(同天妒),关闭自动对比
    const restoreCompare = disableAutoCompare();
    try {
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('司马懿');

    // 触发 P1 判定阶段
    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 无懈窗口
    await fireTimeoutAndWait(harness.state); // 跳过无懈
    await waitForStable(harness.state); // 鬼才询问 pending

    // 司马懿选择替换:打出 ♣5
    await P0.respond('鬼才', { choice: true, cardId: 'r1' });
    await waitForStable(harness.state);

    // 闪电判定牌已变为 ♣5(非黑桃)→ 不命中 → P1 不受伤
    expect(harness.state.players[1].health).toBe(4);
    // 替换牌进弃牌堆(判定后),原判定牌也进弃牌堆
    expect(harness.state.zones.discardPile).toContain('j1');
    expect(harness.state.zones.discardPile).toContain('r1');
    // 司马懿手牌消耗
    expect(harness.state.players[0].hand).not.toContain('r1');
    // 闪电未命中 → 传给下家(司马懿)
    expect(harness.state.players[0].pendingTricks.some((t) => t.name === '闪电')).toBe(true);
    } finally { restoreCompare(); }
  });

  // ─── 2. 不替换 → 闪电命中,P1 受伤 ──────────────────────────
  it('不发动鬼才 → 闪电命中,P1 受3点伤害', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 命中
    const hand = makeCard('r1', '杀', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '司马懿',
          hand: ['r1'],
          skills: ['鬼才', '回合管理'],
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
    const P0 = harness.player('司马懿');

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state);
    await fireTimeoutAndWait(harness.state); // 跳过无懈
    await waitForStable(harness.state); // 鬼才询问

    // 司马懿选择不替换
    await P0.respond('鬼才', { choice: false });
    await waitForStable(harness.state);

    // ♠5 命中 → P1 受 3 点伤害
    expect(harness.state.players[1].health).toBe(1); // 4 - 3
    // 司马懿手牌未消耗
    expect(harness.state.players[0].hand).toContain('r1');
  });

  // ─── 3. 司马懿无手牌 → 不询问,直接判定 ────────────────────
  it('司马懿无手牌 → 鬼才不询问,直接判定命中', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '司马懿',
          hand: [], // 无手牌
          skills: ['鬼才', '回合管理'],
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
      cardMap: { sd1: lightningCard, j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state);
    await fireTimeoutAndWait(harness.state); // 跳过无懈
    await waitForStable(harness.state); // 无鬼才询问(无手牌)→ 判定直接结算

    // ♠5 命中 → P1 受 3 点伤害(鬼才未介入)
    expect(harness.state.players[1].health).toBe(1);
    // 无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 4. 替换为命中牌 → 闪电命中 ──────────────────────────
  it('鬼才用♠3替换♥5 → 闪电命中(改判成功)', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♥', '5'); // ♥5 原本不命中
    const replaceCard = makeCard('r1', '杀', '♠', '3'); // ♠3 → 命中(2-9)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '司马懿',
          hand: ['r1'],
          skills: ['鬼才', '回合管理'],
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
    // 判定 atom 视图模型局限:替换判定牌后 processedView 与 buildView 不对称(同天妒),关闭自动对比
    const restoreCompare = disableAutoCompare();
    try {
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('司马懿');

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state);
    await fireTimeoutAndWait(harness.state);
    await waitForStable(harness.state);

    // 司马懿改判为♠3(命中)
    await P0.respond('鬼才', { choice: true, cardId: 'r1' });
    await waitForStable(harness.state);

    // ♠3 命中 → P1 受 3 点伤害
    expect(harness.state.players[1].health).toBe(1);
    } finally { restoreCompare(); }
  });

  // ─── 5. 消费方座次靠前、改判方座次靠后 → 改判仍生效 ──────
  // 旧实现(挂判定 after-hook 靠注册序混排)下此场景改判失效:消费方(闪电)
  // 座次靠前先注册先结算,改判方后注册来不及改判。改用 afterApply 改判阶段后,
  // 改判严格先于消费方 after hook,与座次无关。
  it('闪电持有者(P0)座次靠前,司马懿(P1)座次靠后 → 鬼才改判仍生效', async () => {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 命中
    const replaceCard = makeCard('r1', '杀', '♣', '5'); // ♣5 非黑桃 → 不命中
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
        // P1=司马懿(改判方),座次靠后
        makePlayer({
          index: 1,
          name: '司马懿',
          hand: ['r1'],
          skills: ['鬼才', '回合管理'],
          health: 4,
        }),
      ],
      cardMap: { sd1: lightningCard, j1: judgeCard, r1: replaceCard },
      currentPlayerIndex: 0, // P0 回合
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    const restoreCompare = disableAutoCompare();
    try {
      state.zones = { deck: ['j1'], discardPile: [], processing: [] };
      await harness.setup(state);
      const P1 = harness.player('司马懿');

      void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
      await waitForStable(harness.state); // 无懈窗口
      await fireTimeoutAndWait(harness.state); // 跳过无懈
      await waitForStable(harness.state); // 鬼才询问(逆时针从 P0 起,问到 P1)

      // 司马懿(P1)用 ♣5 替换 ♠5
      await P1.respond('鬼才', { choice: true, cardId: 'r1' });
      await waitForStable(harness.state);

      // 改判生效:判定牌变 ♣5 → 闪电不命中 → P0 不受伤
      expect(harness.state.players[0].health).toBe(4);
      // 闪电传给下家(司马懿)
      expect(harness.state.players[1].pendingTricks.some((t) => t.name === '闪电')).toBe(true);
      // 替换牌消耗
      expect(harness.state.players[1].hand).not.toContain('r1');
    } finally {
      restoreCompare();
    }
  });
});
