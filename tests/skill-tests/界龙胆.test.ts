// 界龙胆(界赵云·四向转化技)测试:
//   杀↔闪(承袭标龙胆):
//     - 杀当闪(防御):被询问闪时,preceding=[界龙胆.transform{to:'闪'}] + 闪.respond
//     - 闪当杀(进攻):自己回合,preceding=[界龙胆.transform{to:'杀'}] + 杀.use
//   酒↔桃(界版新增):
//     - 酒当桃(回血):自己回合受伤时,preceding=[界龙胆.transform{to:'桃'}] + 桃.use
//     - 桃当酒(增伤):自己回合,preceding=[界龙胆.transform{to:'酒'}] + 酒.use → 下一张杀 +1
//   to 推导:headless 不传 to 时,后端按原卡名推导(兼容 availableActions)
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
    character: '界赵云',
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

describe('界龙胆', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 杀↔闪:闪当杀(进攻) ─────────────────────────────
  it('闪当杀:界赵云把闪当杀使用 → P2 扣血', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['界龙胆', '杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse(
      '界龙胆',
      { cardId: 'd1', to: '杀' },
      '杀',
      { cardId: 'd1#界龙胆', targets: [1] },
    );

    expect(harness.state.cardMap['d1#界龙胆'].name).toBe('杀');
    expect(harness.state.cardMap['d1#界龙胆'].shadowOf).toBe('d1');

    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  // ─── 杀↔闪:杀当闪(防御) ─────────────────────────────
  it('杀当闪:界赵云被杀时把杀当闪打出 → 不扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const kill2 = makeCard('k2', '杀', '♣', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['k2'], skills: ['界龙胆', '闪'] }),
      ],
      cardMap: { k1: kill, k2: kill2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P2.expectPending('询问闪');

    await P2.tryDispatch({
      skillId: '闪',
      actionType: 'respond',
      params: { cardId: 'k2#界龙胆' },
      preceding: [
        { skillId: '界龙胆', actionType: 'transform', params: { cardId: 'k2', to: '闪' } },
      ],
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('k2');
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── 酒↔桃:酒当桃(回血) ─────────────────────────────
  it('酒当桃:界赵云受伤时把酒当桃对自己使用 → 回 1 血', async () => {
    const wine = makeCard('w1', '酒', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['w1'],
          skills: ['界龙胆', '桃'],
          health: 2,
          maxHealth: 4,
        }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 酒→桃,对自己使用(桃.use selfTarget)
    await P1.transformThenUse(
      '界龙胆',
      { cardId: 'w1', to: '桃' },
      '桃',
      { cardId: 'w1#界龙胆', targets: [0] },
    );

    // 影子卡为桃
    expect(harness.state.cardMap['w1#界龙胆'].name).toBe('桃');
    expect(harness.state.cardMap['w1#界龙胆'].shadowOf).toBe('w1');
    // 回 1 血:2 → 3
    expect(harness.state.players[0].health).toBe(3);
    // 原卡(影子还原)进弃牌堆
    expect(harness.state.zones.discardPile).toContain('w1');
    expect(harness.state.players[0].hand).not.toContain('w1');
  });

  // ─── 酒↔桃:桃当酒(增伤) ─────────────────────────────
  it('桃当酒:界赵云把桃当酒使用 → 下一张杀伤害 +1', async () => {
    const peach = makeCard('t1', '桃', '♥', 'A');
    const slash = makeCard('s1', '杀', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['t1', 's1'],
          skills: ['界龙胆', '酒', '杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { t1: peach, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 桃→酒,对自己使用(酒.use selfTarget)
    await P1.transformThenUse(
      '界龙胆',
      { cardId: 't1', to: '酒' },
      '酒',
      { cardId: 't1#界龙胆', targets: [0] },
    );

    // 影子卡为酒,且已加 mark
    expect(harness.state.cardMap['t1#界龙胆'].name).toBe('酒');
    expect(
      harness.state.players[0].marks.some((m) => m.id === '酒/nextKillDamageBonus'),
    ).toBe(true);
    // 原卡进弃牌堆
    expect(harness.state.zones.discardPile).toContain('t1');

    // 出杀 → P2 不闪 → 受到 2 点伤害(1 + 酒增伤 1)
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P2.pass();
    expect(harness.state.players[1].health).toBe(2);
    // mark 已消费
    expect(
      harness.state.players[0].marks.some((m) => m.id === '酒/nextKillDamageBonus'),
    ).toBe(false);
  });

  // ─── to 推导:headless 不传 to,后端按原卡名推导 ────────────
  it('to 推导:不传 to,闪→杀 自动推导(兼容 headless)', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['界龙胆', '杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // preceding transform 不传 to → 后端按 d1(闪) 推导为 杀
    await P1.tryDispatch({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 'd1#界龙胆', targets: [1] },
      preceding: [
        { skillId: '界龙胆', actionType: 'transform', params: { cardId: 'd1' } },
      ],
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.cardMap['d1#界龙胆'].name).toBe('杀');
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  it('to 推导:不传 to,酒→桃 自动推导', async () => {
    const wine = makeCard('w1', '酒', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['w1'],
          skills: ['界龙胆', '桃'],
          health: 3,
          maxHealth: 4,
        }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // preceding transform 不传 to → 后端按 w1(酒) 推导为 桃
    await P1.tryDispatch({
      skillId: '桃',
      actionType: 'use',
      params: { cardId: 'w1#界龙胆', targets: [0] },
      preceding: [
        { skillId: '界龙胆', actionType: 'transform', params: { cardId: 'w1' } },
      ],
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.cardMap['w1#界龙胆'].name).toBe('桃');
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─── 负面:转化方向与原卡不符 ─────────────────────────────
  it('transform:to=杀 但原卡是杀 → 拒绝(只能将闪当杀)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['界龙胆'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界龙胆',
      actionType: 'transform',
      params: { cardId: 'k1', to: '杀' },
    });
  });

  it('transform:to=酒 但原卡是酒 → 拒绝(只能将桃当酒)', async () => {
    const wine = makeCard('w1', '酒', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['w1'], skills: ['界龙胆'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界龙胆',
      actionType: 'transform',
      params: { cardId: 'w1', to: '酒' },
    });
  });

  it('transform:to=桃 但原卡是杀 → 拒绝(跨组转化禁止)', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['界龙胆'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 杀 只能转 闪,不能跨组转 桃
    await P1.expectRejected({
      skillId: '界龙胆',
      actionType: 'transform',
      params: { cardId: 'k1', to: '桃' },
    });
  });

  // ─── 负面:不在手牌 ─────────────────────────────
  it('transform:牌不在手牌 → 拒绝', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界龙胆'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界龙胆',
      actionType: 'transform',
      params: { cardId: 'k1', to: '闪' },
    });
  });

  // ─── rollback:转化后主 action 失败 → 原卡还原 ──────────────────
  it('rollback:闪当杀但无目标 → 杀.use validate 失败,原卡还原', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['界龙胆', '杀'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 无 targets → 杀.use validate 失败 → rollback 界龙胆 transform
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: {
        cardId: 'd1#界龙胆',
        preceding: [
          { skillId: '界龙胆', actionType: 'transform', params: { cardId: 'd1', to: '杀' } },
        ],
      },
    });

    // 状态还原:d1 仍是闪,影子不存在,手牌仍是 d1
    expect(harness.state.cardMap['d1'].name).toBe('闪');
    expect(harness.state.cardMap['d1#界龙胆']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['d1']);
  });

  // ─── rollback:酒当桃但满血 → 桃.use validate 失败,原卡还原 ────
  it('rollback:酒当桃但满血 → 桃.use validate 失败,原卡还原', async () => {
    const wine = makeCard('w1', '酒', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['w1'],
          skills: ['界龙胆', '桃'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1 满血 → 桃.use validate 失败(桃只能对受伤角色使用) → rollback
    await P1.expectRejected({
      skillId: '桃',
      actionType: 'use',
      params: {
        cardId: 'w1#界龙胆',
        targets: [0],
        preceding: [
          { skillId: '界龙胆', actionType: 'transform', params: { cardId: 'w1', to: '桃' } },
        ],
      },
    });

    expect(harness.state.cardMap['w1'].name).toBe('酒');
    expect(harness.state.cardMap['w1#界龙胆']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['w1']);
  });
});
