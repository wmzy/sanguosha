// 界悲歌(界蔡文姬·被动技)测试
//   一名角色受到杀伤害后,界蔡文姬可令其判定;可(可选)弃一张牌触发奖励:
//     ♥ 受伤角色回复 1 点体力
//     ♦ 受伤角色摸两张牌
//     ♣ 伤害来源弃置两张牌
//     ♠ 伤害来源翻面
//   弃置牌与判定牌:花色相同 → 获得判定牌;点数相同 → 获得弃置牌。
//
// 与标版区别:
//   - 标版必须先弃一张牌(代价)再判;界版判定是免费的,弃牌为可选增益。
//   - 界版新增花色/点数比较奖励。
//
// 验证:
//   1. 发动 + 不弃牌:仅按花色执行主效果(无奖励)
//   2. 发动 + 弃牌 + 花色相同:获得判定牌
//   3. 发动 + 弃牌 + 点数相同:获得弃置牌
//   4. 不发动:无效果
//   5. ♠ → 伤害来源翻面
//   6. 没手牌:不询问发动
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
    character: opts.character ?? '界蔡文姬',
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

describe('界悲歌', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 公共开局:P1(攻击方,本回合)出杀打 P0(界蔡文姬,界悲歌+断肠)。
  // P0 不闪 → 受 1 点杀伤害 → 界悲歌询问 P0 是否发动。
  // judgeCard 为牌堆顶的判定牌;extraDeck 为后续牌(供 ♦ 摸牌等)。
  async function useSetupAndSlash(judgeCard: Card, extraDeck: Card[] = []) {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cost = makeCard('d1', '闪', '♦', '3'); // 界蔡文姬可选弃置牌
    const cardMap: Record<string, Card> = { k1: slash, d1: cost, [judgeCard.id]: judgeCard };
    for (const c of extraDeck) cardMap[c.id] = c;
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界蔡文姬', hand: ['d1'], skills: ['界悲歌', '断肠'] }),
        makePlayer({ index: 1, name: 'P1', character: '张飞', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap,
      zones: { deck: [judgeCard.id, ...extraDeck.map((c) => c.id)], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界蔡文姬');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass(); // 不出闪
    return { P0, P1, state };
  }

  // ─── 1. 发动 + 不弃牌:仅按花色执行主效果(♥ 回血,无奖励) ────
  it('发动+不弃牌:♥ 回血,无奖励牌入手', async () => {
    const judge = makeCard('j1', '杀', '♥', '5');
    const { P0 } = await useSetupAndSlash(judge);

    // 1) 询问是否发动
    P0.expectPending('请求回应');
    await P0.respond('界悲歌', { choice: true });

    // 2) 询问是否弃牌 → 不弃(pass)
    P0.expectPending('请求回应');
    await P0.pass();

    // P0 受杀 1 伤(3→2),♥ 回血 → 3
    expect(harness.state.players[0].health).toBe(3);
    // 不弃牌:手牌 d1 仍在
    expect(harness.state.players[0].hand).toContain('d1');
    // 判定牌 j1 进弃牌堆,未获
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 2. 发动 + 弃牌 + 花色相同:获得判定牌 ────
  it('弃牌+花色相同:获得判定牌', async () => {
    // 判定牌 ♥5,弃置 ♥8(同花色)
    const judge = makeCard('j1', '杀', '♥', '5');
    const cost = makeCard('d1', '闪', '♥', '8');
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界蔡文姬', hand: ['d1'], skills: ['界悲歌', '断肠'] }),
        makePlayer({ index: 1, name: 'P1', character: '张飞', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: slash, d1: cost, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界蔡文姬');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass(); // 不出闪

    // 发动 + 弃 d1
    await P0.respond('界悲歌', { choice: true });
    P0.expectPending('请求回应');
    await P0.respond('界悲歌', { cardId: 'd1' });

    // ♥ 主效果:P0 受杀 1 伤(3→2),♥ 回血 → 3
    expect(harness.state.players[0].health).toBe(3);
    // 弃置牌 d1 进弃牌堆
    expect(harness.state.zones.discardPile).toContain('d1');
    // 花色相同 → 获得判定牌 j1(从弃牌堆移到手牌)
    expect(harness.state.players[0].hand).toContain('j1');
    expect(harness.state.zones.discardPile).not.toContain('j1');
    // 弃置牌 d1 仍在弃牌堆(点数 8≠5,未触发点数奖励)
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  // ─── 3. 发动 + 弃牌 + 点数相同:获得弃置牌 ────
  it('弃牌+点数相同:获得弃置牌', async () => {
    // 判定牌 ♠5,弃置 ♦5(同点数,异花色)
    const judge = makeCard('j1', '杀', '♠', '5');
    const cost = makeCard('d1', '闪', '♦', '5');
    const slash = makeCard('k1', '杀', '♣', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界蔡文姬', hand: ['d1'], skills: ['界悲歌', '断肠'] }),
        makePlayer({ index: 1, name: 'P1', character: '张飞', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: slash, d1: cost, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界蔡文姬');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass(); // 不出闪

    await P0.respond('界悲歌', { choice: true });
    await P0.respond('界悲歌', { cardId: 'd1' });

    // ♠ 主效果:来源 P1 翻面(加 界悲歌/翻面 标签)
    expect(harness.state.players[1].tags).toContain('界悲歌/翻面');
    // 点数相同 → 获得弃置牌 d1(从弃牌堆回到手牌)
    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.zones.discardPile).not.toContain('d1');
    // 花色不同 → 判定牌 j1 仍在弃牌堆
    expect(harness.state.zones.discardPile).toContain('j1');
    expect(harness.state.players[0].hand).not.toContain('j1');
  });

  // ─── 4. 不发动:无效果 ────
  it('不发动:无效果,受伤角色保持受伤', async () => {
    const judge = makeCard('j1', '杀', '♥', '5');
    const { P0 } = await useSetupAndSlash(judge);

    // 询问发动 → choice=false
    P0.expectPending('请求回应');
    await P0.respond('界悲歌', { choice: false });

    // 不发动:无回血(P0 仍 2),无弃牌
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].hand).toContain('d1');
    // 判定牌未翻(仍在牌堆顶)
    expect(harness.state.zones.deck).toContain('j1');
  });

  // ─── 5. ♠ → 伤害来源翻面 ────
  it('♠:伤害来源翻面(加标签)', async () => {
    const judge = makeCard('j1', '杀', '♠', '5');
    const { P0 } = await useSetupAndSlash(judge);

    await P0.respond('界悲歌', { choice: true });
    await P0.pass(); // 不弃牌

    // ♠ → 来源 P1 翻面
    expect(harness.state.players[1].tags).toContain('界悲歌/翻面');
  });

  // ─── 6. 没手牌:不询问发动 ────
  it('无手牌:不询问发动(直接无效果)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♥', '5');
    const state: GameState = createGameState({
      players: [
        // P0 无手牌
        makePlayer({ index: 0, name: '界蔡文姬', hand: [], skills: ['界悲歌', '断肠'] }),
        makePlayer({ index: 1, name: 'P1', character: '张飞', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: slash, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界蔡文姬');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass(); // 不出闪

    // 无手牌 → 不询问发动,无 pending
    P0.expectNoPending();
    // P0 受伤(3→2),未触发回血
    expect(harness.state.players[0].health).toBe(2);
    // 判定牌仍在牌堆
    expect(harness.state.zones.deck).toContain('j1');
  });

  // ─── 7. ♦ → 受伤角色摸两张 ────
  it('♦:受伤角色摸两张牌', async () => {
    const judge = makeCard('j1', '杀', '♦', '5');
    const m1 = makeCard('m1', '杀', '♣', '2');
    const m2 = makeCard('m2', '杀', '♣', '3');
    const { P0 } = await useSetupAndSlash(judge, [m1, m2]);

    await P0.respond('界悲歌', { choice: true });
    await P0.pass(); // 不弃牌

    // ♦ → P0 摸两张(j1 已入弃牌堆;m1 m2 入手)
    expect(harness.state.players[0].hand.length).toBe(3); // d1 + m1 + m2
    expect(harness.state.players[0].hand).toContain('m1');
    expect(harness.state.players[0].hand).toContain('m2');
  });

  // ─── 8. ♣ → 伤害来源弃两张牌 ────
  it('♣:伤害来源弃置两张牌', async () => {
    const judge = makeCard('j1', '杀', '♣', '5');
    const slash = makeCard('k1', '杀', '♠', '7');
    const cost = makeCard('d1', '闪', '♦', '3');
    const extra1 = makeCard('c1', '闪', '♦', '8');
    const extra2 = makeCard('c2', '桃', '♥', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界蔡文姬', hand: ['d1'], skills: ['界悲歌', '断肠'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '张飞',
          hand: ['k1', 'c1', 'c2'],
          skills: ['杀'],
        }),
      ],
      cardMap: { k1: slash, d1: cost, j1: judge, c1: extra1, c2: extra2 },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界蔡文姬');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass(); // 不出闪
    await P0.respond('界悲歌', { choice: true });
    await P0.pass(); // 不弃牌

    // ♣ → 来源 P1 弃两张手牌(c1 c2)
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
  });

  // ─── 9. 花色与点数都相同:同时获得判定牌和弃置牌 ────
  it('花色+点数都相同:同时获得判定牌和弃置牌', async () => {
    // 判定牌 ♥5,弃置 ♥5(花色+点数都同)——但这不可能(同一张牌不能既在牌堆又在手牌);
    // 用同点数同花色的另一张:♥5 的判定 + ♥5 的弃置牌(不同 id)
    const judge = makeCard('j1', '杀', '♥', '5');
    const cost = makeCard('d1', '桃', '♥', '5'); // 同花色同点数,异 id
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '界蔡文姬', hand: ['d1'], skills: ['界悲歌', '断肠'] }),
        makePlayer({ index: 1, name: 'P1', character: '张飞', hand: ['k1'], skills: ['杀'] }),
      ],
      cardMap: { k1: slash, d1: cost, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('界蔡文姬');
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass();
    await P0.respond('界悲歌', { choice: true });
    await P0.respond('界悲歌', { cardId: 'd1' });

    // ♥ 主效果:P0 回血(3→2→3)
    expect(harness.state.players[0].health).toBe(3);
    // 花色相同 → 获得判定牌 j1
    expect(harness.state.players[0].hand).toContain('j1');
    // 点数相同 → 获得弃置牌 d1
    expect(harness.state.players[0].hand).toContain('d1');
    // 两张都入手:手牌数 = 2(j1 + d1)
    expect(harness.state.players[0].hand.length).toBe(2);
    // 弃牌堆为空(两张都被拿走)
    expect(harness.state.zones.discardPile).not.toContain('j1');
    expect(harness.state.zones.discardPile).not.toContain('d1');
  });
});
