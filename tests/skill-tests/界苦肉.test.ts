// tests/skill-tests/界苦肉.test.ts
// 苦肉(界黄盖·主动技,OL hero/307)测试:
//   use:出牌阶段限一次,你可以弃置一张牌,然后失去1点体力。(摸牌在诈降)
//
// 界版核心差异(相对标苦肉):
//   1. 标苦肉:失去1点体力→摸2张,无次数限制。
//   2. 界苦肉:弃1张牌(手牌/装备)→失去1点体力(不摸牌),出牌阶段限一次。
//      摸3张由诈降在"失去体力后"触发(见诈降.test.ts)。
//
// 验证:
//   1. 正面:发动→弃1张牌进弃牌堆,体力-1;诈降被触发(摸3,hand +3-net)
//   2. 每回合限一次:第二次被拒
//   3. 代价校验:无cardIds/空/2张/牌不在场 → 拒绝
//   4. 装备可弃:弃装备区卡→发动成功
//   5. 边界:体力1发动→失去体力归0→诈降先摸3→濒死求桃pending(hand已+3)
//   6. 边界:体力1→濒死→自持桃救回→体力回升至1
//   7. 负面:已死亡→拒绝
//   8. 副作用:发动后诈降激活(turn.vars['诈降/active']===0)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, Faction, Json } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♠' || suit === '♣' ? '黑' : '红', rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  vars?: Record<string, Json>;
  faction?: Faction;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界黄盖',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界苦肉', '诈降'],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction ?? '吴',
  };
}

const DECK_IDS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];

function seedDeckCards(state: ReturnType<typeof createGameState>) {
  for (const id of DECK_IDS) {
    state.cardMap[id] = makeCard(id, '杀', '♠');
  }
}

describe('界苦肉', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  function setup(health = 4, hand: string[] = ['c1']) {
    const cardMap: Record<string, Card> = { c1: makeCard('c1', '杀', '♠') };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health,
          hand,
          skills: ['界苦肉', '诈降'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: [] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    return harness.setup(state);
  }

  it('正面: 发动苦肉→弃1张牌进弃牌堆,体力-1,诈降摸3(hand净增)', async () => {
    await setup(4, ['c1']);
    const P1 = harness.player('P1');
    const state = harness.state;

    await P1.triggerAction('界苦肉', 'use', { cardIds: ['c1'] });

    // 体力 4→3(失去1点体力)
    expect(state.players[0].health).toBe(3);
    // c1 进弃牌堆(代价)
    expect(state.zones.discardPile).toContain('c1');
    // 诈降被触发:失去体力后摸3张(从牌堆顶 d6/d5/d4),hand = -c1 + 3 = 3
    expect(state.players[0].hand.length).toBe(3);
    expect(state.players[0].hand).toEqual(['d6', 'd5', 'd4']);
    // 诈降激活(出牌阶段失去体力)
    expect(state.turn.vars['诈降/active']).toBe(0);
  });

  it('每回合限一次: 第二次发动被拒(状态不变)', async () => {
    await setup(4, ['c1']);
    const P1 = harness.player('P1');
    const state = harness.state;

    await P1.triggerAction('界苦肉', 'use', { cardIds: ['c1'] });
    const healthAfterFirst = state.players[0].health;
    const handAfterFirst = state.players[0].hand.length;
    expect(healthAfterFirst).toBe(3);
    expect(handAfterFirst).toBe(3);

    // 第二次:本回合已用过 → 拒绝
    await P1.expectRejected({
      skillId: '界苦肉',
      actionType: 'use',
      params: { cardIds: ['d6'] },
    });
    expect(state.players[0].health).toBe(healthAfterFirst);
    expect(state.players[0].hand.length).toBe(handAfterFirst);
  });

  it('代价校验: 无cardIds / 空 / 2张 / 牌不在场 → 拒绝', async () => {
    await setup(4, ['c1']);
    const P1 = harness.player('P1');
    const state = harness.state;

    // 无 cardIds
    await P1.expectRejected({ skillId: '界苦肉', actionType: 'use', params: {} });
    // 空数组
    await P1.expectRejected({
      skillId: '界苦肉',
      actionType: 'use',
      params: { cardIds: [] },
    });
    // 两张牌(只能弃一张)
    state.players[0].hand = ['c1', 'c2'];
    state.cardMap['c2'] = makeCard('c2', '杀', '♠');
    await P1.expectRejected({
      skillId: '界苦肉',
      actionType: 'use',
      params: { cardIds: ['c1', 'c2'] },
    });
    // 牌不在手牌或装备区
    await P1.expectRejected({
      skillId: '界苦肉',
      actionType: 'use',
      params: { cardIds: ['nonexistent'] },
    });
    // 状态未变:体力仍 4
    expect(state.players[0].health).toBe(4);
  });

  it('装备可弃: 弃装备区卡→发动成功(装备清空,诈降摸3)', async () => {
    const cardMap: Record<string, Card> = {
      w1: makeCard('w1', '普通武器', '♠', 'A', '装备牌'),
    };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health: 4,
          hand: [],
          equipment: { 武器: 'w1' },
          skills: ['界苦肉', '诈降'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: [] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('界苦肉', 'use', { cardIds: ['w1'] });

    // 装备区清空,w1 进弃牌堆
    expect(state.players[0].equipment['武器']).toBeUndefined();
    expect(state.zones.discardPile).toContain('w1');
    // 体力 4→3,诈降摸3
    expect(state.players[0].health).toBe(3);
    expect(state.players[0].hand.length).toBe(3);
  });

  it('边界: 体力1发动→失去体力归0→诈降先摸3→濒死求桃pending', async () => {
    await setup(1, ['c1']);
    const P1 = harness.player('P1');
    const state = harness.state;

    await P1.triggerAction('界苦肉', 'use', { cardIds: ['c1'] });

    // 体力归0,alive 仍 true(等待求桃)
    expect(state.players[0].health).toBe(0);
    expect(state.players[0].alive).toBe(true);
    // 诈降摸3 先于濒死执行:hand 已 +3(d6/d5/d4),c1 已弃
    expect(state.players[0].hand).toEqual(['d6', 'd5', 'd4']);
    // 濒死求桃 pending 已设
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const slotAtom = [...state.pendingSlots.values()][0].atom as {
      type?: string;
      requestType?: string;
    };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('桃/求桃');
  });

  it('边界: 体力1→濒死→自持桃救回→体力回升至1', async () => {
    const peach = makeCard('peach', '桃', '♥', '5');
    const cardMap: Record<string, Card> = {
      c1: makeCard('c1', '杀', '♠'),
      peach,
    };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '界黄盖',
          health: 1,
          maxHealth: 4,
          hand: ['c1', 'peach'],
          skills: ['界苦肉', '诈降', '桃'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: [] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 苦肉:弃 c1 → 失去体力归0 → 诈降摸3 → 濒死求桃
    await P1.triggerAction('界苦肉', 'use', { cardIds: ['c1'] });
    expect(state.players[0].health).toBe(0);

    // P1 出桃自救
    await P1.respond('桃', { cardId: 'peach' });

    // 救回:体力回升至1;hand = 诈降摸的3张(d6/d5/d4),peach 已用
    expect(state.players[0].health).toBe(1);
    expect(state.players[0].hand).toEqual(['d6', 'd5', 'd4']);
    expect(state.zones.discardPile).toContain('peach');
    expect(state.zones.discardPile).toContain('c1');
  });

  it('负面: 已死亡→不可发动(validate 拒绝)', async () => {
    await setup(0, ['c1']);
    const P1 = harness.player('P1');
    const state = harness.state;

    state.players[0].alive = false;

    await P1.expectRejected({
      skillId: '界苦肉',
      actionType: 'use',
      params: { cardIds: ['c1'] },
    });
  });

  it('副作用: 发动后诈降激活(失去体力触发诈降,出牌阶段)', async () => {
    await setup(4, ['c1']);
    const P1 = harness.player('P1');
    const state = harness.state;

    expect(state.turn.vars['诈降/active']).toBeUndefined();

    await P1.triggerAction('界苦肉', 'use', { cardIds: ['c1'] });

    expect(state.turn.vars['诈降/active']).toBe(0);
  });
});
