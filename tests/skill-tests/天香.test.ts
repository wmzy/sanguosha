// tests/skill-tests/天香.test.ts
// 天香(小乔·被动触发):当你受到伤害时，你可以弃置一张红桃手牌，防止此伤害并
// 选择一名其他角色，你选择令其：
//   1. 受到伤害来源的1点伤害并摸X张牌（X为其已损失体力值且至多为5）
//   2. 失去1点体力并获得你弃置的牌。
//
// 验证:
//   1. 选项①:弃红桃手牌防止伤害 → 目标受来源1点伤害 + 摸X(X=已损失体力,至多5)
//   2. 选项① X 上限为 5
//   3. 选项②:弃红桃手牌防止伤害 → 目标失去1点体力 + 获得弃置的牌
//   4. 红颜联动:小乔仅有黑桃手牌时仍可发动天香(黑桃视为红桃)
//   5. 触发条件不满足:无红桃/黑桃手牌 → 不触发,小乔正常受伤
//   6. 选择不发动:小乔拒绝天香 → 小乔正常受伤
//   7. 不能转移给自己(validate 拒绝)
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
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
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
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
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

describe('天香', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 选项①:弃红桃手牌防止伤害 → 目标受来源1伤害+摸X ──────
  it('选项①:弃红桃手牌 → 小乔不受伤,P2受来源1伤害+摸X张牌', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const heartCard = makeCard('h1', '闪', '♥', '5'); // 小乔弃的红桃手牌
    // 牌堆顶 3 张供 P2 摸(P2 受伤后已损失 3 体力 → 摸 3 张)
    const d1 = makeCard('d1', '桃', '♥', '3');
    const d2 = makeCard('d2', '杀', '♣', '4');
    const d3 = makeCard('d3', '闪', '♦', '6');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '小乔',
          hand: ['h1'],
          skills: ['天香', '红颜'],
          health: 3,
          maxHealth: 3,
        }),
        // P2 体力 2/4:受1伤后 1/4,已损失 3 → 摸 3 张
        makePlayer({ index: 2, name: 'P2', health: 2, maxHealth: 4, skills: [] }),
      ],
      cardMap: { k1: slash, h1: heartCard, d1, d2, d3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('小乔');

    // P0 杀 小乔
    await P0.useCardAndTarget('杀', 'k1', [1]);
    // 小乔不出闪 → 进入造成伤害 → 天香 before hook 触发
    await P1.pass();
    P1.expectPending('请求回应'); // 天香/confirm
    await P1.respond('天香', { choice: true });
    // 选红桃手牌 + 转移目标 P2
    P1.expectPending('请求回应'); // 天香/choose
    await P1.respond('天香', { cardId: 'h1', target: 2 });

    // 选项①:受来源1伤害+摸X → 确认(confirm)
    P1.expectPending('请求回应'); // 天香/option
    await P1.respond('天香', { choice: true });

    // 小乔未受伤(伤害被防止)
    expect(harness.state.players[1].health).toBe(3);
    // 小乔弃掉了红桃手牌
    expect(harness.state.players[1].hand).not.toContain('h1');
    // 红桃手牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('h1');
    // P2 受到来自 P0 的 1 点伤害:2 → 1(注意:固定 1 点,不是原伤害量)
    expect(harness.state.players[2].health).toBe(1);
    // P2 摸 X=3 张牌(已损失体力 = 4-1 = 3)
    expect(harness.state.players[2].hand.length).toBe(3);
    expect(harness.state.players[2].hand).toEqual(expect.arrayContaining(['d1', 'd2', 'd3']));
  });

  // ─── 2. 选项① X 上限为 5 ────────────────────────────────
  it('选项①:已损失体力超过 5 → P2 仅摸 5 张(X 至多为 5)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const heartCard = makeCard('h1', '闪', '♥', '5');
    // 牌堆顶 8 张(P2 满血 10/10,受伤后 9/10,已损失 1 → 摸 1;不触发上限)
    // 改为 P2 体力 4/10 → 受伤 3/10,已损失 7 → 摸 5(上限)
    const deck = Array.from({ length: 8 }, (_, i) =>
      makeCard(`d${i + 1}`, '杀', '♣', String(i + 1)),
    );
    const cardMap: Record<string, Card> = { k1: slash, h1: heartCard };
    for (const c of deck) cardMap[c.id] = c;

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '小乔',
          hand: ['h1'],
          skills: ['天香', '红颜'],
          health: 3,
          maxHealth: 3,
        }),
        // P2 体力 4/10:受1伤后 3/10,已损失 7 → 摸 5(上限 5)
        makePlayer({ index: 2, name: 'P2', health: 4, maxHealth: 10, skills: [] }),
      ],
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: deck.map((c) => c.id), discardPile: [], processing: [] };
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    await P1.respond('天香', { choice: true });
    await P1.respond('天香', { cardId: 'h1', target: 2 });
    // 选项①
    await P1.respond('天香', { choice: true });

    // P2 体力 4 → 3(固定 1 伤)
    expect(harness.state.players[2].health).toBe(3);
    // 摸 5 张(X 上限 5,已损失 7 但只摸 5)
    expect(harness.state.players[2].hand.length).toBe(5);
  });

  // ─── 3. 选项②:弃红桃手牌防止伤害 → 目标失1体力+获弃牌 ────────
  it('选项②:弃红桃手牌 → 小乔不受伤,P2失1体力+获得弃置的牌', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const heartCard = makeCard('h1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '小乔',
          hand: ['h1'],
          skills: ['天香', '红颜'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 2, name: 'P2', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: { k1: slash, h1: heartCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应'); // confirm
    await P1.respond('天香', { choice: true });
    P1.expectPending('请求回应'); // choose
    await P1.respond('天香', { cardId: 'h1', target: 2 });

    // 选项②:失去体力+获牌 → 取消(confirm=false)
    P1.expectPending('请求回应'); // option
    await P1.respond('天香', { choice: false });

    // 小乔未受伤
    expect(harness.state.players[1].health).toBe(3);
    // 红桃手牌被弃后又转移到 P2 手牌
    expect(harness.state.players[1].hand).not.toContain('h1');
    expect(harness.state.players[2].hand).toContain('h1');
    // h1 不在弃牌堆(被 P2 获得)
    expect(harness.state.zones.discardPile).not.toContain('h1');
    // P2 失去1点体力(非伤害):4 → 3
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 4. 红颜联动:黑桃手牌也能弃 ───────────────────────
  it('红颜联动:小乔仅有黑桃手牌 → 天香仍可发动(黑桃视为红桃)', async () => {
    const slash = makeCard('k1', '杀', '♣', '7');
    const spadeCard = makeCard('s1', '杀', '♠', '5'); // 黑桃手牌

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '小乔',
          hand: ['s1'],
          skills: ['天香', '红颜'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 2, name: 'P2', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: { k1: slash, s1: spadeCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    // 天香应触发(红颜使黑桃视为红桃)
    P1.expectPending('请求回应');
    await P1.respond('天香', { choice: true });
    P1.expectPending('请求回应');
    // 弃黑桃手牌(红颜下合法)+ 转移给 P2
    await P1.respond('天香', { cardId: 's1', target: 2 });
    // 选项①
    P1.expectPending('请求回应');
    await P1.respond('天香', { choice: true });

    // 小乔未受伤
    expect(harness.state.players[1].health).toBe(3);
    // 黑桃手牌被弃
    expect(harness.state.zones.discardPile).toContain('s1');
    // P2 受伤(固定 1 点)
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 5. 触发条件不满足:无红桃/黑桃手牌 ───────────────────────
  it('无红桃/黑桃手牌 → 天香不触发,小乔正常受伤', async () => {
    const slash = makeCard('k1', '杀', '♣', '7');
    const clubCard = makeCard('c1', '闪', '♣', '5'); // 梅花手牌(非红桃/黑桃)

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '小乔',
          hand: ['c1'],
          skills: ['天香', '红颜'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap: { k1: slash, c1: clubCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    // 无合法手牌 → 天香 before hook 不发起询问,直接受伤
    P1.expectNoPending();
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 6. 选择不发动天香 ───────────────────────
  it('选择不发动天香 → 小乔正常受伤', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const heartCard = makeCard('h1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '小乔',
          hand: ['h1'],
          skills: ['天香', '红颜'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap: { k1: slash, h1: heartCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    P1.expectPending('请求回应'); // 天香/confirm
    // 拒绝发动
    await P1.pass();

    // 小乔受伤
    expect(harness.state.players[1].health).toBe(2);
    // 手牌未弃
    expect(harness.state.players[1].hand).toContain('h1');
  });

  // ─── 7. 不能转移给自己(validate 拒绝) ───────────────────────
  it('respond 校验:选择自己为转移目标 → 被拒绝', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const heartCard = makeCard('h1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '小乔',
          hand: ['h1'],
          skills: ['天香', '红颜'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 2, name: 'P2', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: { k1: slash, h1: heartCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    await P1.respond('天香', { choice: true });
    P1.expectPending('请求回应'); // 天香/choose
    // 试图转移给自己 → validate 拒绝
    await P1.expectRejected({ skillId: '天香', actionType: 'respond', params: { cardId: 'h1', target: 1 } });
    // 仍是天香/choose pending(未被消耗),可正常转移给 P2
    await P1.respond('天香', { cardId: 'h1', target: 2 });
    P1.expectPending('请求回应'); // 天香/option
    // 选项①
    await P1.respond('天香', { choice: true });
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[2].health).toBe(3);
  });
});
