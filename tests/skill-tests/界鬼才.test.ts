// 界鬼才(界司马懿·被动触发)技能测试:
//   判定牌生效前,可打出一张手牌或装备牌代替之(与标版鬼才差异:可用装备区的牌)。
//
// 来源:2026-08-26 bug 修复会话新增。此前本技能无任何专属测试;
//   同会话修复 respond 只认 choice===true 的参数契约缺陷——浏览器/Headless 客户端
//   对 useCard 型 pending 只发 {cardId}(无 choice),导致玩家选牌后被静默视为不发动。
//
// 覆盖:
//   1. 手牌替换({choice:true, cardId} 传统形状)→ 替换成功
//   2. 回归:仅 {cardId}(浏览器真实形状)→ 同样替换成功
//   3. 不发动(pass)→ 判定按原牌结算
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SkillTestHarness,
  waitForStable,
  fireTimeoutAndWait,
  disableAutoCompare,
} from '../engine-harness';
import { applyAtom } from '../../src/engine/core/apply';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
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
    character: '',
    health: opts.health ?? 4,
    maxHealth: 4,
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

describe('界鬼才', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  function lightningScene(hand: string[]) {
    const lightningCard = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // ♠5 → 命中(2-9)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界司马懿',
          hand,
          skills: ['界鬼才', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: '闪电主',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 1, card: lightningCard }],
        }),
      ],
      cardMap: {
        sd1: lightningCard,
        j1: judgeCard,
        ...Object.fromEntries(hand.map((id) => [id, makeCard(id, '杀', '♣', '5')])),
      },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    return { state, judgeCard };
  }

  it('手牌替换({choice:true, cardId}) → ♣5 替换后闪电不命中', async () => {
    const { state } = lightningScene(['r1']);
    const restoreCompare = disableAutoCompare();
    try {
      state.zones = { deck: ['j1'], discardPile: [], processing: [] };
      await harness.setup(state);
      const P0 = harness.player('界司马懿');

      void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
      await waitForStable(harness.state); // 无懈窗口
      await fireTimeoutAndWait(harness.state); // 跳过无懈
      await waitForStable(harness.state); // 界鬼才询问

      await P0.respond('界鬼才', { choice: true, cardId: 'r1' });
      await waitForStable(harness.state);

      expect(harness.state.players[0].hand).not.toContain('r1');
      expect(harness.state.zones.discardPile).toContain('r1');
      expect(harness.state.players[1].health).toBe(4); // ♣5 非黑桃 → 不命中
    } finally {
      restoreCompare();
    }
  });

  it('回归:respond 仅带 {cardId} 无 choice → 同样替换判定牌', async () => {
    const { state } = lightningScene(['r1']);
    const restoreCompare = disableAutoCompare();
    try {
      state.zones = { deck: ['j1'], discardPile: [], processing: [] };
      await harness.setup(state);
      const P0 = harness.player('界司马懿');

      void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
      await waitForStable(harness.state);
      await fireTimeoutAndWait(harness.state);
      await waitForStable(harness.state);

      // 浏览器/HeadlessGameClient 的真实发送形状:只有 cardId,无 choice
      await P0.respond('界鬼才', { cardId: 'r1' });
      await waitForStable(harness.state);

      expect(harness.state.players[0].hand).not.toContain('r1');
      expect(harness.state.zones.discardPile).toContain('r1');
      expect(harness.state.players[1].health).toBe(4);
    } finally {
      restoreCompare();
    }
  });

  it('不发动 → ♠5 命中,闪电主受 3 点伤害', async () => {
    const { state } = lightningScene([]);
    const restoreCompare = disableAutoCompare();
    try {
      state.zones = { deck: ['j1'], discardPile: [], processing: [] };
      await harness.setup(state);

      void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
      await waitForStable(harness.state);
      await fireTimeoutAndWait(harness.state); // 界鬼才询问超时 = 不发动
      await waitForStable(harness.state);

      expect(harness.state.players[1].health).toBe(1); // 4 - 3
    } finally {
      restoreCompare();
    }
  });
});
