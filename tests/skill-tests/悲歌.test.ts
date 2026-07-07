// 悲歌(蔡文姬·被动技)测试
//   一名角色受到杀伤害后,蔡文姬可弃一张牌令其判定,按花色执行效果。
//
// 验证:
//   1. ♠ → 伤害来源翻面(加 '悲歌/翻面' 标签)
//   2. ♥ → 受伤角色回复 1 点体力
//   3. ♦ → 受伤角色摸两张牌
//   4. ♣ → 伤害来源弃置两张牌
//   5. 蔡文姬选择不弃牌(pass)→ 悲歌不发动,无效果
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
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '蔡文姬',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
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

describe('悲歌', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 公共开局:P1(攻击方,本回合)出杀打 P0(蔡文姬,悲歌+断肠)。
  // P0 不闪 → 受 1 点杀伤害 → 悲歌询问 P0 弃牌。
  async function setupAndSlash(judgeCard: Card, extraDeck: Card[] = []) {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cost = makeCard('d1', '闪', '♦', '3'); // 蔡文姬弃置代价
    const cardMap: Record<string, Card> = { k1: slash, d1: cost, [judgeCard.id]: judgeCard };
    for (const c of extraDeck) cardMap[c.id] = c;
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '蔡文姬', hand: ['d1'], skills: ['悲歌', '断肠'] }),
        makePlayer({ index: 1, name: 'P1', character: '张飞', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap,
      zones: { deck: [judgeCard.id, ...extraDeck.map((c) => c.id)], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('蔡文姬');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass(); // 不出闪
    return { P0, P1 };
  }

  // ─── ♠ 来源翻面 ────────────────────────────
  it('♠:伤害来源翻面(加标签)', async () => {
    const judge = makeCard('j1', '杀', '♠', '5');
    const { P0 } = await setupAndSlash(judge);

    // 悲歌询问蔡文姬弃牌
    P0.expectPending('请求回应');
    await P0.respond('悲歌', { cardId: 'd1' });

    // ♠ → 来源 P1 翻面
    expect(harness.state.players[1].tags).toContain('悲歌/翻面');
    // 代价已弃
    expect(harness.state.players[0].hand).not.toContain('d1');
  });

  // ─── ♥ 受伤角色回血 ────────────────────────────
  it('♥:受伤角色回复 1 点体力', async () => {
    const judge = makeCard('j1', '杀', '♥', '5');
    const { P0 } = await setupAndSlash(judge);

    await P0.respond('悲歌', { cardId: 'd1' });

    // P0 受杀 1 伤(3→2),♥ 回血 → 3
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── ♦ 受伤角色摸两张 ────────────────────────────
  it('♦:受伤角色摸两张牌', async () => {
    const judge = makeCard('j1', '杀', '♦', '5');
    const m1 = makeCard('m1', '杀', '♣', '2');
    const m2 = makeCard('m2', '杀', '♣', '3');
    const { P0 } = await setupAndSlash(judge, [m1, m2]);

    // P0 弃代价 d1 后摸 2 张 → 手牌为 2 张新牌(d1 已进弃牌堆)
    await P0.respond('悲歌', { cardId: 'd1' });

    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).not.toContain('d1');
  });

  // ─── ♣ 来源弃两张牌 ────────────────────────────
  it('♣:伤害来源弃置两张牌', async () => {
    const judge = makeCard('j1', '杀', '♣', '5');
    const slash = makeCard('k1', '杀', '♠', '7');
    const cost = makeCard('d1', '闪', '♦', '3');
    const extra1 = makeCard('c1', '闪', '♦', '8');
    const extra2 = makeCard('c2', '桃', '♥', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '蔡文姬', hand: ['d1'], skills: ['悲歌', '断肠'] }),
        // P1 出杀后仍持有 c1 c2 → ♣ 弃两张
        makePlayer({ index: 1, name: 'P1', character: '张飞', hand: ['k1', 'c1', 'c2'], skills: ['杀'] }),
      ],
      cardMap: { k1: slash, d1: cost, j1: judge, c1: extra1, c2: extra2 },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('蔡文姬');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass();
    await P0.respond('悲歌', { cardId: 'd1' });

    // ♣ → 来源 P1 弃两张手牌(c1 c2),只剩空手
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
  });

  // ─── 不弃牌 → 悲歌不发动 ────────────────────────────
  it('不弃牌:悲歌不发动,受伤角色保持受伤', async () => {
    const judge = makeCard('j1', '杀', '♠', '5');
    const { P0 } = await setupAndSlash(judge);

    // 蔡文姬放弃(超时)
    await P0.pass();

    // 不发动:无翻面标签,P0 仍受伤(3→2),代价牌仍在手
    expect(harness.state.players[1].tags).not.toContain('悲歌/翻面');
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].hand).toContain('d1');
  });
});
