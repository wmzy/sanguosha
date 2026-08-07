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
  async function useSetupAndSlash(judgeCard: Card, extraDeck: Card[] = []) {
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

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass(); // 不出闪
    return { P0, P1 };
  }

  // ─── ♠ 来源翻面 ────────────────────────────
  it('♠:伤害来源翻面(加标签)', async () => {
    const judge = makeCard('j1', '杀', '♠', '5');
    const { P0 } = await useSetupAndSlash(judge);

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
    const { P0 } = await useSetupAndSlash(judge);

    await P0.respond('悲歌', { cardId: 'd1' });

    // P0 受杀 1 伤(3→2),♥ 回血 → 3
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── ♦ 受伤角色摸两张 ────────────────────────────
  it('♦:受伤角色摸两张牌', async () => {
    const judge = makeCard('j1', '杀', '♦', '5');
    const m1 = makeCard('m1', '杀', '♣', '2');
    const m2 = makeCard('m2', '杀', '♣', '3');
    const { P0 } = await useSetupAndSlash(judge, [m1, m2]);

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

  // ─── 目标合法性:对非蔡文姬的受伤角色发动 ────────────────────
  // 触发对象是「任一角色」受杀伤害(不限于蔡文姬本人);判定与效果均作用于受伤角色。
  // 此前四个用例蔡文姬既是拥有者又是受伤者(退化场景),无法区分效果作用于
  // 「受伤角色」还是「拥有者」——本用例补齐该关键边界。
  it('队友受杀伤害:悲歌发动,效果(♦)作用于受伤角色而非蔡文姬', async () => {
    const judge = makeCard('j1', '杀', '♦', '5');
    const slash = makeCard('k1', '杀', '♠', '7');
    const cost = makeCard('d1', '闪', '♦', '3'); // 蔡文姬弃置代价
    const s1 = makeCard('s1', '闪', '♥', '6'); // P2 持有,使其有出闪选择(贴近真实对局)
    const m1 = makeCard('m1', '杀', '♣', '2');
    const m2 = makeCard('m2', '杀', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '蔡文姬', hand: ['d1'], skills: ['悲歌', '断肠'] }),
        makePlayer({ index: 1, name: 'P1', character: '张飞', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 2, name: 'P2', hand: ['s1'] }),
      ],
      cardMap: { k1: slash, d1: cost, s1, j1: judge, m1, m2 },
      zones: { deck: ['j1', 'm1', 'm2'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('蔡文姬');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [2]);
    await P2.pass(); // P2 选择不出闪 → 受 1 点杀伤害

    // 悲歌(拥有者 P0)询问弃牌 —— 证明触发不限于蔡文姬本人受伤
    P0.expectPending('请求回应');
    await P0.respond('悲歌', { cardId: 'd1' });

    // ♦ → 受伤角色 P2 摸两张(手牌 3 张 = 原 s1 + m1/m2);蔡文姬仅弃代价、不摸牌
    // (效果作用于受伤角色而非拥有者;摸牌顺序不保证字典序,故用长度+包含断言)
    expect(harness.state.players[2].hand.length).toBe(3);
    expect(harness.state.players[2].hand).toContain('m1');
    expect(harness.state.players[2].hand).toContain('m2');
    expect(harness.state.players[0].hand).toEqual([]);
  });

  // ─── 蔡文姬无手牌 → 代价不足,不询问不发动 ────────────────────
  // 负面拒绝路径:拥有者无手牌可弃时,主 hook 提前 return,连弃牌询问都不创建。
  // 与「不弃牌(主动放弃)」走不同的早退分支。
  it('无手牌:蔡文姬无牌可弃,悲歌不询问、不发动', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '蔡文姬', hand: [], skills: ['悲歌', '断肠'] }),
        makePlayer({ index: 1, name: 'P1', character: '张飞', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: slash },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const _P0 = harness.player('蔡文姬');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    // P0 无手牌 → 无法出闪,自动受 1 点杀伤害;owner 又无牌可弃 → 悲歌不询问

    // 无手牌 → 悲歌 early-return:不为蔡文姬创建弃牌询问
    expect(harness.state.pendingSlots.has(0)).toBe(false);
    // 仍受了伤(3→2),且无任何效果(未回血/未摸牌)
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].hand).toEqual([]);
  });

  // ─── 不弃牌 → 悲歌不发动 ────────────────────────────
  it('不弃牌:悲歌不发动,受伤角色保持受伤', async () => {
    const judge = makeCard('j1', '杀', '♠', '5');
    const { P0 } = await useSetupAndSlash(judge);

    // 蔡文姬放弃(超时)
    await P0.pass();

    // 不发动:无翻面标签,P0 仍受伤(3→2),代价牌仍在手
    expect(harness.state.players[1].tags).not.toContain('悲歌/翻面');
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].hand).toContain('d1');
  });
});
