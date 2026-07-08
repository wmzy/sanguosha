// 万箭齐发(普通锦囊):出牌阶段对所有其他角色使用。
//   每名目标依次结算:可出【闪】抵消,否则受使用者造成的 1 点伤害。
//
// 实现(万箭齐发.ts):use action → 锦囊进处理区 → 逐目标:先问无懈可击(被抵消则跳过),
//   再询问闪 → 处理区有闪=抵消(移闪入弃牌堆),无闪=造成 1 点伤害 → 锦囊入弃牌堆。
//
// 验证:
//   1. 正面:目标无闪 → 受 1 点伤害,万箭入弃牌堆
//   2. 正面:目标出闪 → 不受伤害,闪与万箭均入弃牌堆
//   3. 负面:非自己回合 → 拒绝
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
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['杀', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

const WANJIAN: Card = {
  id: 'wj1',
  name: '万箭齐发',
  suit: '♥',
  color: suitColor('♥'),
  rank: '7',
  type: '锦囊牌',
};

describe('万箭齐发', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  /** 消耗可能出现的无懈可击询问窗口(若有则 pass) */
  async function consumeNullWindow(): Promise<void> {
    const slot = [...harness.state.pendingSlots.values()][0];
    if (slot && (slot.atom as { type: string }).type === '请求回应') {
      await harness.player('P2').pass();
    }
  }

  // ─── 正面:目标无闪 → 受 1 点伤害 ─────────────────────────

  it('正面:P2 无闪 → P2 扣 1 血,万箭入弃牌堆', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wj1'], skills: ['万箭齐发'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { wj1: WANJIAN },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('万箭齐发', 'wj1', []);
    await consumeNullWindow();

    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('wj1');
    expect(harness.state.zones.processing).not.toContain('wj1');
  });

  // ─── 正面:目标出闪 → 不受伤害 ─────────────────────────────

  it('正面:P2 出闪 → P2 不扣血,闪与万箭入弃牌堆', async () => {
    const dodge = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wj1'], skills: ['万箭齐发'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { wj1: WANJIAN, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('万箭齐发', 'wj1', []);
    await consumeNullWindow();

    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });

    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('wj1');
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  // ─── 负面:非自己回合 → 拒绝 ──────────────────────────────

  it('负面:非自己回合 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wj1'], skills: ['万箭齐发'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { wj1: WANJIAN },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await P2.expectRejected({
      skillId: '万箭齐发',
      actionType: 'use',
      params: { cardId: 'wj1' },
    });
  });
});
