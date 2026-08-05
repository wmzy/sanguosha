// 护甲(自定义锁定技):当你受到【杀】造成的伤害时,若此杀为黑色,伤害 -1。
//
// 实现:before hook 挂「造成伤害」——target=自己 + 杀且 color==='黑' → amount-1
//
// 验证:
//   1. 正面:黑色杀 → 伤害 -1(1→0,不扣血)
//   2. 负面:红色杀 → 正常扣 1 血(护甲不触发)
//   3. 负面:无护甲 → 黑色杀正常扣 1 血
//   4. 边界:黑色非杀伤害(火攻)不受护甲影响(护甲只认「杀」)
//   5. 边界:有护甲时出闪仍可正常抵消杀(护甲不干扰闪)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import { runDamageFlow } from '../../src/engine/damage-flow';
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
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
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

describe('护甲', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:黑色杀伤害 -1 ───────────────────────────────────

  it('正面:黑色杀(黑桃)→ 伤害 -1,不扣血', async () => {
    const blackSlash = makeCard('k1', '杀', '♠', '7'); // 黑桃=黑色
    const shan = makeCard('s1', '闪', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['s1'], skills: ['闪', '护甲'] }),
      ],
      cardMap: { k1: blackSlash, s1: shan },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P2.expectPending('询问闪');
    await P2.pass(); // 不出闪

    // 黑色杀伤害 -1:1→0,不扣血
    expect(harness.state.players[1].health).toBe(4);
    // 杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── 负面:红色杀不受护甲影响 ───────────────────────────────

  it('负面:红色杀(红桃)→ 正常扣 1 血(护甲不触发)', async () => {
    const redSlash = makeCard('k2', '杀', '♥', '8'); // 红桃=红色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k2'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪', '护甲'] }),
      ],
      cardMap: { k2: redSlash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k2', [1]);
    await P2.pass();

    // 红色杀:护甲不触发,正常扣 1 血
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 负面:无护甲时黑色杀正常扣血 ───────────────────────────

  it('负面:无护甲 → 黑色杀正常扣 1 血', async () => {
    const blackSlash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }), // 无护甲
      ],
      cardMap: { k1: blackSlash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.pass();

    // 无护甲:黑色杀正常扣 1 血
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 边界:护甲只对「杀」生效,非杀伤害不减伤 ────────────────

  it('边界:黑色非杀牌(火攻)造成伤害 → 护甲不触发,正常扣 1 血', async () => {
    // 黑色非杀牌:color='黑' 能通过颜色判断,但 name 不含「杀」→ 护甲 return 不减伤
    const blackTrick: Card = {
      id: 'f1',
      name: '火攻',
      suit: '♠',
      color: suitColor('♠'),
      rank: '5',
      type: '锦囊牌',
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪', '护甲'] }),
      ],
      cardMap: { f1: blackTrick },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接走伤害结算(来源牌为黑色火攻,非杀),不经出牌流程
    void runDamageFlow(harness.state, 0, 1, 1, 'f1');
    await waitForStable(harness.state);

    // 护甲只对「杀」减伤:火攻非杀 → 正常扣 1 血
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 边界:护甲不干扰闪,出闪仍可抵消 ────────────────────────

  it('边界:有护甲时出闪仍可正常抵消杀', async () => {
    const blackSlash = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('s1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['s1'], skills: ['闪', '护甲'] }),
      ],
      cardMap: { k1: blackSlash, s1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    await P2.respond('闪', { cardId: 's1' }); // 出闪抵消

    // 出闪抵消:不扣血(护甲未触发,闪已抵消)
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['k1', 's1']));
  });
});
