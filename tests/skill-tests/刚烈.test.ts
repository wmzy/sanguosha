// 刚烈(夏侯惇·被动技)测试
//   受到伤害后判定,非红桃则来源弃两张手牌或受 1 点伤害。
//
// 验证:
//   1. 非红桃 + 来源选择受伤 → 来源扣 1 血
//   2. 非红桃 + 来源选择弃牌 → 来源弃两张手牌
//   3. 红桃 → 无事发生
//   4. 来源手牌不足两张 → 强制受到伤害
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

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
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '夏侯惇',
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

describe('刚烈', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 非红桃 + 选择受伤 ────────────────────────────
  it('非红桃:来源选择受 1 点伤害', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // 判定牌:黑桃(非红桃)
    const extra1 = makeCard('e1', '闪', '♦', '3');
    const extra2 = makeCard('e2', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        // P0 带 2 张额外手牌,出杀后仍有 2 张 → 刚烈提供二选一
        makePlayer({ index: 0, name: 'P0', hand: ['k1', 'e1', 'e2'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge, e1: extra1, e2: extra2 },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // P1 不出闪
    // 刚烈判定(非红桃)后,询问来源 P0 二选一
    P0.expectPending('请求回应');
    await P0.respond('刚烈', { choice: false }); // 选择受到伤害

    expect(harness.state.players[1].health).toBe(3); // P1 受杀 1 伤
    expect(harness.state.players[0].health).toBe(3); // P0 受刚烈 1 伤
    // P0 选择受伤,未弃牌,仍持有 e1 e2
    expect(harness.state.players[0].hand).toEqual(['e1', 'e2']);
  });

  // ─── 非红桃 + 选择弃牌 ────────────────────────────
  it('非红桃:来源选择弃两张手牌', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♣', '5'); // 判定牌:梅花(非红桃)
    const extra1 = makeCard('e1', '闪', '♦', '3');
    const extra2 = makeCard('e2', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1', 'e1', 'e2'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge, e1: extra1, e2: extra2 },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    P0.expectPending('请求回应');
    await P0.respond('刚烈', { choice: true }); // 选择弃两张手牌

    expect(harness.state.players[1].health).toBe(3); // P1 受杀 1 伤
    expect(harness.state.players[0].health).toBe(4); // P0 未受伤
    // P0 出杀后剩 [e1,e2],刚烈弃掉两张 → 手牌为空
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('e1');
    expect(harness.state.zones.discardPile).toContain('e2');
  });

  // ─── 红桃 → 无事 ────────────────────────────
  it('红桃:刚烈不触发效果', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♥', '5'); // 判定牌:红桃
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // 不出闪

    // 红桃:刚烈判定后无事,无 pending(杀结算完毕)
    expect(harness.state.players[1].health).toBe(3); // P1 受杀 1 伤
    expect(harness.state.players[0].health).toBe(4); // P0 无伤
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 来源手牌不足两张 → 强制受伤 ────────────────────
  it('来源手牌不足两张:强制受到伤害', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // 非红桃
    const state: GameState = createGameState({
      players: [
        // P0 只有杀,出杀后手牌为空(< 2)→ 只能受伤
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // 不出闪 → 刚烈判定非红桃 → 手牌不足 → 直接受伤

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].health).toBe(3); // 强制受伤
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
