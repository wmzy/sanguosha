// 雌雄双股剑(武器,攻击范围 2):
//   你使用【杀】指定目标后,目标须弃 1 张手牌,然后你摸 1 张牌。
//   (源码简化:不判性别;目标无手牌时改为仅你摸 1 张牌。)
//
// 实现(雌雄双股剑.ts):after hook 挂「指定目标」——source=自己 + card 是杀时:
//   - 目标无手牌 → 自己摸 1
//   - 目标有手牌 → 目标弃 hand[0] + 自己摸 1
//
// 验证:
//   1. 正面:目标有手牌 → 目标弃 1 张 + 自己摸 1 张
//   2. 边界:目标无手牌 → 仅自己摸 1 张(不弃牌)
//   3. 负面:无雌雄双股剑 → 不触发(不弃牌不摸牌)
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

const CIxIONG: Card = {
  id: 'cx',
  name: '雌雄双股剑',
  suit: '♠',
  color: suitColor('♠'),
  rank: '5',
  type: '装备牌',
  subtype: '武器',
  range: 2,
};

describe('雌雄双股剑', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:目标有手牌 → 弃 1 + 自己摸 1 ─────────────────────

  it('正面:杀有手牌的目标 → 目标弃 hand[0] + 自己摸 1 张', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const targetCard = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀', '雌雄双股剑'],
          equipment: { 武器: 'cx' },
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { cx: CIxIONG, k1: kill, d1: targetCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('杀', 'k1', [1]);

    // 指定目标 after hook 已触发:d1 被弃,自己摸 1
    expect(harness.state.zones.discardPile).toContain('d1');
    expect(harness.state.players[1].hand).not.toContain('d1');
    // 自己用了杀(k1)又摸了 1 → 手牌数 1
    expect(harness.state.players[0].hand).toHaveLength(1);
    expect(harness.state.players[0].hand).not.toContain('k1');

    // 之后正常询问闪:P2 已无手牌 → 不出闪 → 受 1 伤
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 边界:目标无手牌 → 仅自己摸 1 ──────────────────────────

  it('边界:目标无手牌 → 仅自己摸 1 张(不弃牌)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀', '雌雄双股剑'],
          equipment: { 武器: 'cx' },
        }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'] }),
      ],
      cardMap: { cx: CIxIONG, k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('杀', 'k1', [1]);

    // 无手牌 → 不弃牌,但自己仍摸 1(k1 已用,摸 1 后手牌数 1)
    expect(harness.state.players[0].hand).toHaveLength(1);
    expect(harness.state.zones.discardPile).not.toContain('k1');

    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 负面:无雌雄双股剑 → 不触发 ────────────────────────────

  it('负面:无雌雄双股剑 → 杀后不弃牌不摸牌', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const targetCard = makeCard('d1', '闪', '♦', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { k1: kill, d1: targetCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await harness.player('P1').useCardAndTarget('杀', 'k1', [1]);

    // 无武器技:d1 未被弃,P1 未摸牌(手牌空)
    expect(harness.state.players[1].hand).toContain('d1');
    expect(harness.state.zones.discardPile).not.toContain('d1');
    expect(harness.state.players[0].hand).toHaveLength(0);

    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });
});
