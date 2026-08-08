// 集智(黄月英·被动技):每当你使用一张非延时锦囊牌时,你可以摸一张牌。
//
// 验证:
//   1. 触发(处理区路径):用【无中生有】→ 集智 confirm → 确认 → 额外摸 1 张
//      (集智 1 + 无中生有 2 = 3 张,起手 1 张打出 → 终局手牌 3)
//   2. 触发(无懈可击路径):打出【无懈可击】(经 respond 出牌)→ 集智 confirm → 摸 1
//      —— 覆盖实现挂「移动牌」(而非结算帧入栈)的核心动机:
//         无懈可击是 respond 不 pushFrame,但会移动牌,故须挂在「移动牌」才能命中
//   3. confirm=false → 集智不摸牌,仅无中生有摸 2 张
//   4. 负面:使用基本牌(杀)不触发集智(类型过滤)
//   5. 负面:使用延时锦囊(乐不思蜀)不触发集智(非延时过滤)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
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

describe('集智', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('触发:用无中生有 → 集智 confirm → 确认 → 额外摸 1 张(共 3 张)', async () => {
    const wz = makeCard('wz1', '无中生有', '♥', '7');
    // 牌堆 3 张:集智摸 1 + 无中生有摸 2
    const d1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const d2 = makeCard('d2', '闪', '♥', '6', '基本牌');
    const d3 = makeCard('d3', '杀', '♣', '8', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wz1'], skills: ['集智', '无中生有'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { wz1: wz, d1, d2, d3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 使用无中生有 → 锦囊进处理区 → 集智 afterHook → 集智 confirm 窗口
    await P1.useCardAndTarget('无中生有', 'wz1', [0]);
    P1.expectPending('请求回应');
    // 确认发动集智
    await P1.respond('集智', { choice: true });
    // 无中生有继续 → 询问无懈可击 → 无人打出
    await P1.pass();

    // 集智摸 1 + 无中生有摸 2 = 3 张(起手 wz1 已打出)
    expect(harness.state.players[0].hand.length).toBe(3);
    // 牌堆 3 张全数摸完
    expect(harness.state.zones.deck).toEqual([]);
    // 无中生有进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wz1');
  });

  // 验证「无懈可击」触发路径:无懈可击经 respond 出牌(手牌→弃牌堆),
  // 集智挂「移动牌」正是为此覆盖它(无懈可击不 pushFrame 但会移动牌)。
  // 场景:P2 出无中生有 → 无懈广播窗口 → P1(集智 owner)打出无懈 → 集智命中
  it('触发:打出无懈可击(经 respond 出牌)→ 集智 confirm → 确认 → 摸 1 张', async () => {
    const wz = makeCard('wz1', '无中生有', '♥', '7');
    const wx = makeCard('wx1', '无懈可击', '♠', 'J');
    const d1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const state: GameState = createGameState({
      players: [
        // P1(集智 owner)持无懈可击:将在 P2 出锦囊时打出
        makePlayer({ index: 0, name: 'P1', hand: ['wx1'], skills: ['集智', '无懈可击'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['wz1'], skills: ['无中生有'] }),
      ],
      cardMap: { wz1: wz, wx1: wx, d1 },
      currentPlayerIndex: 1, // P2 的回合,由 P2 出无中生有
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P2 出无中生有 → 无懈可击广播窗口(P2 非 owner,不触发 P1 的集智)
    await P2.useCardAndTarget('无中生有', 'wz1', [1]);
    // P1 打出无懈可击 → 移出 P1 手牌 → 集智 afterHook 命中(无懈可击 ∈ 非延时锦囊)
    await P1.respond('无懈可击', { cardId: 'wx1' });
    P1.expectPending('请求回应'); // 集智 confirm 窗口
    await P1.respond('集智', { choice: true });

    // 消耗反无懈广播窗口(无人再打出);上限 3 次防止异常悬挂
    for (let i = 0; i < 3 && harness.state.pendingSlots.size > 0; i++) {
      await P1.pass();
    }

    // 集智摸 1 张:wx1 已出,摸到 d1
    expect(harness.state.players[0].hand).toEqual(['d1']);
    expect(harness.state.zones.deck).toEqual([]);
    // 无懈可击入弃牌堆(→弃牌堆 路径被集智正确捕获)
    expect(harness.state.zones.discardPile).toContain('wx1');
  });

  it('触发:集智 confirm=false → 不摸牌,仅无中生有摸 2 张', async () => {
    const wz = makeCard('wz1', '无中生有', '♥', '7');
    const d1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const d2 = makeCard('d2', '闪', '♥', '6', '基本牌');
    const d3 = makeCard('d3', '杀', '♣', '8', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wz1'], skills: ['集智', '无中生有'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { wz1: wz, d1, d2, d3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('无中生有', 'wz1', [0]);
    P1.expectPending('请求回应');
    // 不发动集智
    await P1.respond('集智', { choice: false });
    await P1.pass(); // 无懈窗口

    // 仅无中生有摸 2 张(从牌堆顶摸走 d3、d2,剩余 d1)
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.deck).toEqual(['d1']);
  });

  it('负面:使用基本牌(杀)不触发集智', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'], skills: ['集智', '杀'] }),
        // P2 带一张闪:询问闪走 normal(验证是询问闪而非集智 confirm)
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { s1: slash, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 's1', [1]);
    // 杀的目标被询问闪,而非集智 confirm(基本牌不触发集智)
    P2.expectPending('询问闪');
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // 验证 diffText 核心断言:集智覆盖「非延时」锦囊 → 延时锦囊(乐不思蜀)不触发
  it('负面:使用延时锦囊(乐不思蜀)不触发集智(非延时过滤)', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const deckCard = makeCard('d1', '杀', '♠', '5', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['l1'], skills: ['集智', '乐不思蜀'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { l1: card, d1: deckCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('乐不思蜀', 'use', { cardId: 'l1', target: 1 });

    // 乐不思蜀放置成功(延时锦囊生效)
    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
    // 集智未触发:牌堆未被摸(P1 手牌从 1→0,无额外摸牌)
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.zones.deck).toEqual(['d1']);
    // 无集智 confirm 窗口
    expect(harness.state.pendingSlots.get(0)).toBeUndefined();
  });
});
