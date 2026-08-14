// tests/skill-tests/苦肉.test.ts
// 苦肉(黄盖·主动技)测试:
//   use:出牌阶段,失去1点体力,然后摸两张牌。
//   无次数限制,可多次发动;条件:体力值 > 0。
//
// 关键规则(描述备注):
//   - 失去体力不是受到伤害,因此不触发与伤害相关的技能(用 失去体力 atom,非 造成伤害)。
//   - 如果体力值降为0,进入濒死状态(求桃流程);被救回后继续摸牌,无人救援则阵亡、不再摸牌。
//
// 验证:
//   1. 正面:发动一次→体力-1,手牌+2
//   2. 正面:连续发动两次→体力-2,手牌+4(无次数限制)
//   3. 边界:体力为1时发动→体力归0,进入濒死(求桃 pending),此时未摸牌
//   4. 边界:体力为1时发动→濒死→自持桃救回→体力回升至1,继续摸2牌
//   5. 边界:体力为1发动→无人救援→阵亡,后续摸牌不再执行(if alive 守卫)
//   6. 负面:已死亡→不可发动(validate 拒绝:player is dead)
//   7. 负面:体力为0(濒死)→不可发动(validate 拒绝:体力不足)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
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
    character: opts.character ?? '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
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

describe('苦肉', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  function setup(health = 4) {
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', character: '黄盖', health, skills: ['苦肉'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4 }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    return harness.setup(state);
  }

  it('正面: 发动苦肉→体力-1,手牌+2', async () => {
    await setup(4);
    const P1 = harness.player('P1');
    const state = harness.state;

    const beforeHealth = state.players[0].health;
    const beforeHandLen = state.players[0].hand.length;

    await P1.triggerAction('苦肉', 'use');

    expect(state.players[0].health).toBe(beforeHealth - 1);
    expect(state.players[0].hand.length).toBe(beforeHandLen + 2);
  });

  it('正面: 连续发动两次→体力-2,手牌+4', async () => {
    await setup(4);
    const P1 = harness.player('P1');
    const state = harness.state;

    const beforeHealth = state.players[0].health;
    const beforeHandLen = state.players[0].hand.length;

    // 第一次
    await P1.triggerAction('苦肉', 'use');
    expect(state.players[0].health).toBe(beforeHealth - 1);
    expect(state.players[0].hand.length).toBe(beforeHandLen + 2);

    // 第二次
    await P1.triggerAction('苦肉', 'use');
    expect(state.players[0].health).toBe(beforeHealth - 2);
    expect(state.players[0].hand.length).toBe(beforeHandLen + 4);
  });

  it('边界: 体力为1时发动→体力归0,进入濒死(求桃),此时未摸牌', async () => {
    const peach = makeCard('peach', '桃', '♥', '5');
    const state = createGameState({
      players: [
        // P1(黄盖)体力 1、无手牌
        makePlayer({ index: 0, name: 'P1', character: '黄盖', health: 1, skills: ['苦肉'] }),
        // P2 持一张桃:濒死求桃问到 P2 时创建 slot(P1 无手牌被 skip)
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, hand: ['peach'], skills: ['桃'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: { peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    const beforeHandLen = state.players[0].hand.length;

    await P1.triggerAction('苦肉', 'use');

    // 体力归0 → 进入濒死状态(alive 仍为 true,等待求桃)
    expect(state.players[0].health).toBe(0);
    expect(state.players[0].alive).toBe(true);
    // 触发了濒死/求桃流程
    expect(state.pendingSlots.size).toBeGreaterThan(0);
    const slotAtom = [...state.pendingSlots.values()][0].atom as {
      type?: string;
      requestType?: string;
    };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('桃/求桃');
    // 摸牌排在 失去体力(濒死) 之后,被求桃 pending 阻塞,尚未执行
    expect(state.players[0].hand.length).toBe(beforeHandLen);
  });

  it('边界: 体力为1发动→濒死→自持桃救回→体力回升至1,继续摸2牌', async () => {
    const peach = makeCard('peach', '桃', '♥', '5');
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '黄盖',
          health: 1,
          maxHealth: 4,
          hand: ['peach'],
          skills: ['苦肉', '桃'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4 }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: { peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 发动苦肉:体力 1→0,进入濒死,求桃 pending 目标为 P1 自身
    await P1.triggerAction('苦肉', 'use');
    expect(state.players[0].health).toBe(0);

    // P1 自持桃,出桃救援
    await P1.respond('桃', { cardId: 'peach' });

    // 救回后体力回升至 1,且苦肉继续执行摸 2 张牌
    expect(state.players[0].health).toBe(1);
    expect(state.players[0].hand.length).toBe(2);
    // 桃已用掉,进入弃牌堆
    expect(state.zones.discardPile).toContain('peach');
  });

  it('边界: 体力为1发动→无人救援→阵亡,后续不再摸牌', async () => {
    const state = createGameState({
      players: [
        // P1(黄盖)体力 1、无手牌
        makePlayer({ index: 0, name: 'P1', character: '黄盖', health: 1, skills: ['苦肉'] }),
        // P2 无手牌:濒死求桃时无牌可出(响应可用性 skip),无人救援
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4 }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 发动苦肉:体力 1→0 进入濒死,P1/P2 均无桃救援 → 阵亡
    await P1.triggerAction('苦肉', 'use');

    // 无人救援 → 角色阵亡(alive=false)
    expect(state.players[0].health).toBe(0);
    expect(state.players[0].alive).toBe(false);
    // 阵亡后苦肉后续摸牌不再执行(if alive 守卫)
    expect(state.players[0].hand.length).toBe(0);
  });

  it('负面: 已死亡→不可发动(validate 拒绝:player is dead)', async () => {
    const state = createGameState({
      players: [
        // P1 直接以阵亡态开局(alive=false);若 setup 后再直接改 state,
        // 会造成 buildView/processedView 不同步,故在此处直接构造
        makePlayer({ index: 0, name: 'P1', character: '黄盖', health: 4, alive: false, skills: ['苦肉'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4 }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 已阵亡 → validate 拒绝:player is dead
    await P1.expectRejected({ skillId: '苦肉', actionType: 'use', params: {} });
  });

  it('负面: 体力为0(濒死)→不可发动(validate 拒绝:体力不足)', async () => {
    await setup(0);
    const P1 = harness.player('P1');

    // 体力为0但仍存活(濒死态)→ validate 拒绝:体力不足,无法发动苦肉
    await P1.expectRejected({ skillId: '苦肉', actionType: 'use', params: {} });
  });
});
