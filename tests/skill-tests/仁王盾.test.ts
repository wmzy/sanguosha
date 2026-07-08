// 仁王盾(防具,锁定技):黑色【杀】对你无效。
//
// 实现(仁王盾.ts):before hook 挂「检测有效性」——target=自己 + 杀且 color==='黑'
//   → cancel。杀.execute 据 cancel 跳过该目标(不询问闪、不造成伤害、不触发被抵消)。
//
// 验证:
//   1. 正面:黑杀 → 无效(不询问闪、不扣血)
//   2. 负面:红杀(color==='红')→ 正常询问闪,不出闪则扣血
//   3. 负面:无仁王盾时黑杀 → 正常扣血
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

const RENWANG: Card = {
  id: 'rw',
  name: '仁王盾',
  suit: '♣',
  color: suitColor('♣'),
  rank: '2',
  type: '装备牌',
  subtype: '防具',
};

describe('仁王盾', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:黑杀无效 ───────────────────────────────────────

  it('正面:黑杀(黑桃)→ 无效,不询问闪不扣血', async () => {
    const blackKill = makeCard('k1', '杀', '♠', '7'); // 黑桃=黑色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['闪', '仁王盾'],
          equipment: { 防具: 'rw' },
        }),
      ],
      cardMap: { rw: RENWANG, k1: blackKill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P1').useCardAndTarget('杀', 'k1', [1]);

    // 黑杀被仁王盾 cancel:目标被跳过 → 无 pending(不询问闪)
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(4);
    // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── 负面:红杀正常询问闪 ─────────────────────────────────

  it('负面:红杀(红桃)→ 不被仁王盾挡,不出闪则扣血', async () => {
    const redKill = makeCard('k2', '杀', '♥', '8'); // 红桃=红色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k2'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['闪', '仁王盾'],
          equipment: { 防具: 'rw' },
        }),
      ],
      cardMap: { rw: RENWANG, k2: redKill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('杀', 'k2', [1]);

    // 红杀不被挡 → 正常询问闪
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪 → 扣血

    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 负面:无仁王盾时黑杀正常扣血 ─────────────────────────

  it('负面:无仁王盾 → 黑杀正常询问闪,不出闪则扣血', async () => {
    const blackKill = makeCard('k1', '杀', '♣', '7'); // 梅花=黑色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { k1: blackKill },
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
  });
});
