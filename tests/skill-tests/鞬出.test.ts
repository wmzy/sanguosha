// 鞬出(庞德·群雄·被动技)测试:
//   1. 目标弃非装备牌(手牌)→ 获得此杀,杀不生效(不扣血)
//   2. 目标弃装备牌 → 不能使用闪,强制命中(扣血,有闪也不能出)
//   3. 庞德不发动 → 正常询问闪,目标出闪抵消
//   4. 目标无牌可弃 → 鞬出不触发,正常受伤
//   5. 他人出杀 → 鞬出不触发
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
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  subtype?: string,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type, ...(subtype ? { subtype } : {}) };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '庞德',
    health: opts.health ?? 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('鞬出', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 弃非装备牌(手牌)→ 获得此杀,不扣血 ─────────────────────────────
  it('目标弃手牌(非装备)→ 获得此杀,杀不生效,不扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '庞德', hand: ['k1'], skills: ['杀', '鞬出'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('庞德');
    const P2 = harness.player('P2');

    // 庞德出杀指定 P2 → 指定目标后鞬出询问是否发动
    await P0.useCardAndTarget('杀', 'k1', [1]);
    P0.expectPending('请求回应');
    await P0.respond('鞬出', { choice: true });

    // 目标自选弃一张牌(选手牌 handIndex 0 = 闪)
    P2.expectPending('请求回应');
    await P2.respond('鞬出', { zone: 'hand', handIndex: 0 });

    // 非装备牌 → 此杀不生效,目标获得此杀,不扣血
    expect(harness.state.players[1].health).toBe(4);
    // 闪被弃置
    expect(harness.state.players[1].hand).not.toContain('d1');
    expect(harness.state.zones.discardPile).toContain('d1');
    // 目标获得此杀(杀牌进目标手牌)
    expect(harness.state.players[1].hand).toContain('k1');
    // 杀牌不在弃牌堆(被目标获得,而非结算后弃置)
    expect(harness.state.zones.discardPile).not.toContain('k1');
  });

  // ─── 弃装备牌 → 不能使用闪,强制命中 ─────────────────────────────
  it('目标弃装备 → 不能使用闪,强制命中扣血(有闪也不能出)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const horse = makeCard('h1', '紫骍', '♥', '5', '装备牌', '进攻马');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '庞德', hand: ['k1'], skills: ['杀', '鞬出'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1'],
          equipment: { 进攻马: 'h1' },
          skills: ['闪'],
        }),
      ],
      cardMap: { k1: kill, d1: dodge, h1: horse },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('庞德');
    const P2 = harness.player('P2');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    P0.expectPending('请求回应');
    await P0.respond('鞬出', { choice: true });

    // 目标选弃装备(紫骍)
    P2.expectPending('请求回应');
    await P2.respond('鞬出', { zone: 'equipment', cardId: 'h1' });

    // 装备牌 → 禁闪,强制命中(询问闪被跳过)→ 扣血
    expect(harness.state.players[1].health).toBe(3);
    // 装备被弃置
    expect(harness.state.players[1].equipment['进攻马']).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('h1');
    // P2 有闪但因禁闪未能使用,闪仍在手里
    expect(harness.state.players[1].hand).toContain('d1');
    // 杀结算后进弃牌堆(正常命中路径)
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── 不发动鞬出 → 正常询问闪,目标出闪抵消 ─────────────────────────────
  it('庞德不发动 → 正常询问闪,目标出闪抵消', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '庞德', hand: ['k1'], skills: ['杀', '鞬出'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('庞德');
    const P2 = harness.player('P2');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    P0.expectPending('请求回应');
    // 不发动
    await P0.respond('鞬出', { choice: false });

    // 无鞬出干预 → 询问闪正常进行
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });
    expect(harness.state.players[1].health).toBe(4);
  });

  // ─── 目标无牌可弃 → 鞬出不触发,正常受伤 ─────────────────────────────
  it('目标无牌可弃 → 鞬出不触发,直接询问闪,无闪受伤', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '庞德', hand: ['k1'], skills: ['杀', '鞬出'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('庞德');
    const P2 = harness.player('P2');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // 目标无牌 → 鞬出不询问,直接进入询问闪
    P2.expectPending('询问闪');
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 他人出杀 → 鞬出(庞德)不触发 ─────────────────────────────
  it('他人出杀 → 鞬出不触发(直接询问闪)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '庞德', skills: ['鞬出'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    // P2 出杀指定庞德 —— source≠庞德(鞬出 owner),鞬出 after hook 不触发
    await P2.useCardAndTarget('杀', 'k1', [0]);

    // 直接进入询问闪(无 鞬出/confirm)
    const slot = [...harness.state.pendingSlots.values()][0];
    expect((slot.atom as { type: string }).type).toBe('询问闪');
  });
});
