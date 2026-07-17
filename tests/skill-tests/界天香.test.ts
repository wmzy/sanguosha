// tests/skill-tests/界天香.test.ts
// 界天香(界小乔·被动触发):当你受到伤害时，你可以弃置一张红桃牌防止之并选择一项，
//   令一名其他角色：1.受到伤害来源的1点伤害并摸X张牌（X为其已损失体力值且至多为5）；
//   2.失去1点体力并获得你弃置的牌。
//
// 官方来源:三国杀 OL 界限突破 hero/457。
//
// 验证:
//   1. 选项①:弃红桃手牌防止伤害 → 目标受来源1点伤害 + 摸X(X=已损失体力,至多5)
//   2. 选项②:弃红桃手牌防止伤害 → 目标失去1点体力 + 获得弃置的牌
//   3. 装备区弃牌(界版核心差异):红桃装备可弃
//   4. 红颜联动:黑桃手牌视为红桃,可弃
//   5. 触发条件不满足:无红桃/黑桃牌 → 不触发,界小乔正常受伤
//   6. 不能选择自己(validate 拒绝)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, EquipSlot, GameState, PlayerState } from '../../src/engine/types';

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
  equipment?: Partial<Record<EquipSlot, string>>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界小乔',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界天香', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 选项①:弃红桃手牌防止伤害 → 目标受1伤害+摸X ──────────
  it('选项①:弃红桃手牌 → 界小乔不受伤,P2受来源1伤害+摸X', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const heartCard = makeCard('h1', '闪', '♥', '5');
    // P2 maxHealth=4,health=4 → 受1伤后 3/4,已损失1 → 摸1
    const d1 = makeCard('d1', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '界小乔',
          hand: ['h1'],
          skills: ['界天香', '界红颜'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 2, name: 'P2', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: { k1: slash, h1: heartCard, d1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('界小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // 不出闪 → 进入造成伤害 → 界天香 before hook 触发

    // 1) 询问是否发动
    P1.expectPending('请求回应');
    await P1.respond('界天香', { choice: true });

    // 2) 选红桃手牌 + 目标 P2
    P1.expectPending('请求回应');
    await P1.respond('界天香', { cardId: 'h1', target: 2 });

    // 3) 选项①:受来源1伤害+摸X → 确认(confirm)
    P1.expectPending('请求回应');
    await P1.respond('界天香', { choice: true });

    // 界小乔未受伤(伤害被防止)
    expect(harness.state.players[1].health).toBe(3);
    // 红桃手牌被弃
    expect(harness.state.players[1].hand).not.toContain('h1');
    expect(harness.state.zones.discardPile).toContain('h1');
    // P2 受到来自 P0 的 1 点伤害:4 → 3
    expect(harness.state.players[2].health).toBe(3);
    // P2 摸 X=1 张(maxHealth-health=4-3=1)
    expect(harness.state.players[2].hand.length).toBe(1);
    expect(harness.state.players[2].hand).toContain('d1');
  });

  // ─── 2. 选项②:弃红桃手牌防止伤害 → 目标失1体力+获弃牌 ────────
  it('选项②:弃红桃手牌 → 界小乔不受伤,P2失1体力+获得弃置的牌', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const heartCard = makeCard('h1', '闪', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '界小乔',
          hand: ['h1'],
          skills: ['界天香', '界红颜'],
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
    const P1 = harness.player('界小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('界天香', { choice: true });

    P1.expectPending('请求回应');
    await P1.respond('界天香', { cardId: 'h1', target: 2 });

    // 选项②:失去体力+获牌 → 取消(confirm=false)
    P1.expectPending('请求回应');
    await P1.respond('界天香', { choice: false });

    // 界小乔未受伤
    expect(harness.state.players[1].health).toBe(3);
    // 红桃牌被弃后又转移到 P2 手牌
    expect(harness.state.players[1].hand).not.toContain('h1');
    expect(harness.state.players[2].hand).toContain('h1');
    // h1 不在弃牌堆(被 P2 获得)
    expect(harness.state.zones.discardPile).not.toContain('h1');
    // P2 失去1点体力(非伤害):4 → 3
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 3. 装备区弃牌(界版核心差异)──────────────────────────
  it('界小乔无红桃手牌、仅有红桃装备 → 弃装备发动界天香', async () => {
    const slash = makeCard('k1', '杀', '♣', '7');
    const clubHand = makeCard('c1', '闪', '♣', '5');
    const heartEquip = makeCard('eq1', '白银狮子', '♥', 'A', '装备牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '界小乔',
          hand: ['c1'],
          skills: ['界天香', '界红颜'],
          health: 3,
          maxHealth: 3,
          equipment: { 防具: 'eq1' },
        }),
        makePlayer({ index: 2, name: 'P2', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: { k1: slash, c1: clubHand, eq1: heartEquip },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('界小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('界天香', { choice: true });

    P1.expectPending('请求回应');
    await P1.respond('界天香', { cardId: 'eq1', target: 2 });

    // 选项②(失去体力+获牌)
    P1.expectPending('请求回应');
    await P1.respond('界天香', { choice: false });

    // 界小乔未受伤
    expect(harness.state.players[1].health).toBe(3);
    // 红桃装备被弃(从装备区移除)
    expect(harness.state.players[1].equipment['防具']).toBeUndefined();
    // P2 获得弃置的装备牌
    expect(harness.state.players[2].hand).toContain('eq1');
  });

  // ─── 4. 红颜联动:黑桃手牌视为红桃 ────────────────────────
  it('红颜联动:界小乔仅有黑桃手牌 → 视为红桃,可发动界天香', async () => {
    const slash = makeCard('k1', '杀', '♣', '7');
    const spadeHand = makeCard('s1', '闪', '♠', '5'); // 黑桃(界红颜下视为红桃)
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '界小乔',
          hand: ['s1'],
          skills: ['界天香', '界红颜'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({ index: 2, name: 'P2', health: 4, maxHealth: 4, skills: [] }),
      ],
      cardMap: { k1: slash, s1: spadeHand },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('界小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('界天香', { choice: true });

    P1.expectPending('请求回应');
    // 弃黑桃手牌(界红颜下合法)+ 目标 P2
    await P1.respond('界天香', { cardId: 's1', target: 2 });

    P1.expectPending('请求回应');
    await P1.respond('界天香', { choice: true }); // 选项①

    // 界小乔未受伤
    expect(harness.state.players[1].health).toBe(3);
    // 黑桃手牌被弃
    expect(harness.state.players[1].hand).not.toContain('s1');
    // P2 受1伤害
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 5. 触发条件不满足:无红桃/黑桃牌 ────────────────────────
  it('手牌和装备区均无红桃/黑桃牌 → 界天香不触发,界小乔正常受伤', async () => {
    const slash = makeCard('k1', '杀', '♣', '7');
    const clubCard = makeCard('c1', '闪', '♣', '5'); // 梅花(非红桃/黑桃)
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '界小乔',
          hand: ['c1'],
          skills: ['界天香', '界红颜'],
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
    const P1 = harness.player('界小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    // 无合法牌 → 界天香 before hook 不发起询问,直接受伤
    P1.expectNoPending();
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 6. 不能选择自己(validate 拒绝) ────────────────────────
  it('respond 校验:选择自己为目标 → 被拒绝', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const heartCard = makeCard('h1', '闪', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: '界小乔',
          hand: ['h1'],
          skills: ['界天香', '界红颜'],
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
    const P1 = harness.player('界小乔');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    await P1.respond('界天香', { choice: true });
    P1.expectPending('请求回应'); // choose
    // 试图选自己为目标 → validate 拒绝
    await P1.expectRejected({
      skillId: '界天香',
      actionType: 'respond',
      params: { cardId: 'h1', target: 1 },
    });
    // 仍是 choose pending,可正常选 P2
    await P1.respond('界天香', { cardId: 'h1', target: 2 });
    P1.expectPending('请求回应'); // option
    await P1.respond('界天香', { choice: true }); // 选项①
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[2].health).toBe(3);
  });
});
