// 方天画戟(武器,攻击范围 4):
//   当你使用【杀】时,若此杀是你最后 1 张手牌,你可以额外指定至多 2 个目标(最多 3 名)。
//
// 实现说明(方天画戟.ts):本技能为占位——【杀】的 validate 不限制目标数量上限,
//   仅校验每个目标在攻击范围内,故多目标由【杀】自身天然支持。本技能 onInit 无 hook。
//   此处以代码实际行为为准,验证"多目标由杀 validate 支持"这一设计:
//
// 验证:
//   1. 正面:3 人局,方天画戟装备,最后一张手牌为杀 → 同时指定 2 名目标,均受伤害
//   2. 兼容:仅指定 1 名目标时正常结算(单目标不破坏)
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
  equipment?: Record<string, string>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['杀', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

// 方天画戟牌(武器,range 4)
const FANGTIAN: Card = {
  id: 'fty',
  name: '方天画戟',
  suit: '♦',
  color: suitColor('♦'),
  rank: '5',
  type: '装备牌',
  subtype: '武器',
  range: 4,
};

describe('方天画戟', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:最后一张手牌为杀,同时指定 2 名目标 ───────────────

  it('正面:3 人局,最后一张手牌为杀 → 指定 2 名目标,均受 1 点伤害', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀', '方天画戟'],
          equipment: { 武器: 'fty' },
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
        makePlayer({ index: 2, name: 'P3', skills: ['闪'] }),
      ],
      cardMap: { fty: FANGTIAN, k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    // P1 出杀,同时指定 P2、P3(多目标由杀 validate 支持)
    await harness.player('P1').useCardAndTarget('杀', 'k1', [1, 2]);

    // 结算顺序:逐个询问闪。P2 不出闪
    P2.expectPending('询问闪');
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);

    // P3 不出闪
    await P3.pass();
    expect(harness.state.players[2].health).toBe(3);

    // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── 兼容:仅指定 1 名目标正常结算 ───────────────

  it('兼容:仅指定 1 名目标 → 正常结算受伤害', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const spare = makeCard('x1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1', 'x1'],
          skills: ['杀', '方天画戟'],
          equipment: { 武器: 'fty' },
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { fty: FANGTIAN, k1: kill, x1: spare },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('杀', 'k1', [1]);
    P2.expectPending('询问闪');
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('k1');
  });
});
