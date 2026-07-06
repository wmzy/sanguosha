// 铁骑(马超·被动技)测试:
//   红色判定 → 目标不能出闪(强制命中)
//   黑色判定 / 不发动 → 目标正常出闪
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
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
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
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
    character: '马超',
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
  };
}

describe('铁骑', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 红色判定 → 目标不能出闪,强制命中 ─────────────────────────────
  it('红色判定 → P2 有闪也不能出,扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const judge = makeCard('j1', '桃', '♦', '5'); // 方块=红色判定
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['铁骑', '杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { k1: kill, d1: dodge, j1: judge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1 出杀 → 指定目标后铁骑询问是否发动
    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');

    // 发动铁骑 → 判定(红色)
    await P1.respond('铁骑', { choice: true });

    // 红色判定 → P2 被禁闪,询问闪被跳过 → 强制命中
    // P2 手里有闪但无法使用,直接扣血
    expect(harness.state.players[1].health).toBe(3);
    // P2 的闪仍在手里(没能打出)
    expect(harness.state.players[1].hand).toContain('d1');
  });

  // ─── 黑色判定 → 无效果,目标正常出闪 ─────────────────────────────
  it('黑色判定 → P2 正常出闪抵消', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const judge = makeCard('j1', '杀', '♠', '3'); // 黑桃=黑色判定
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['铁骑', '杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { k1: kill, d1: dodge, j1: judge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    await P1.respond('铁骑', { choice: true });

    // 黑色判定 → 无禁闪 → 询问闪正常进行
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });

    // P2 出闪抵消 → 不扣血
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 不发动铁骑 → 正常询问闪 ─────────────────────────────
  it('不发动铁骑 → P2 正常出闪抵消', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['铁骑', '杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    // 不发动
    await P1.respond('铁骑', { choice: false });

    // 无判定 → 询问闪正常
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 非马超出杀 → 铁骑不触发 ─────────────────────────────
  it('他人出杀 → 铁骑(P1)不触发', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['铁骑'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    // P2 出杀指定 P1 —— source≠P1(铁骑owner),铁骑 after hook 不触发
    await P2.useCardAndTarget('杀', 'k1', [0]);

    // 直接进入询问闪(无 铁骑/confirm)
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { type: string }).type).toBe('询问闪');
  });
});
