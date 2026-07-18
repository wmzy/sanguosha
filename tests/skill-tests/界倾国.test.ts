// tests/skill-tests/界倾国.test.ts
// 界倾国(界甄姬·转化技):你可以将一张黑色手牌当【闪】使用或打出。
//
// 官方(逐字):"你可以将一张黑色手牌当【闪】使用或打出。" —— 限定"手牌"。
//
// 验证:
//   1. 正面:黑色手牌(♠/♣) transform + 闪.respond → 创建影子闪,杀被抵消
//   2. 负面:黑色装备区牌 transform 被拒(官方仅限手牌,界甄姬实现不再含装备区)
//   3. 负面:红牌(♥/♦) transform 被拒(不是黑色)
//   4. 负面:不在手牌的卡 transform 被拒
//   5. defineAction 声明:transform action 存在,activeWhen 只看手牌黑色牌
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
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界甄姬',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界倾国', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界倾国', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:黑色手牌 transform + 闪.respond ─────────────────────────────

  it('黑桃手牌当闪 → 创建影子闪,杀被抵消', async () => {
    const black = makeCard('c1', '杀', '♠', 'A'); // 黑桃(黑色)
    const slash = makeCard('s1', '杀', '♥', '5'); // P2 的杀(红色)
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['界倾国', '闪'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['s1'],
          skills: ['杀'],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1: black, s1: slash },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('杀', 's1', [0]);
    P1.expectPending('询问闪');

    await P1.tryDispatch({
      skillId: '闪',
      actionType: 'respond',
      params: { cardId: 'c1#倾国' },
      preceding: [{ skillId: '界倾国', actionType: 'transform', params: { cardId: 'c1' } }],
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.cardMap['c1#倾国']).toBeDefined();
    expect(harness.state.cardMap['c1#倾国'].name).toBe('闪');
    expect(harness.state.cardMap['c1#倾国'].shadowOf).toBe('c1');
    expect(harness.state.players[0].health).toBe(3); // 闪抵消,P1 不扣血
  });

  it('梅花(♣)手牌当闪 → 同样成功', async () => {
    const black = makeCard('c2', '桃', '♣', '7'); // 梅花(黑色)
    const slash = makeCard('s1', '杀', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c2'], skills: ['界倾国', '闪'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['s1'],
          skills: ['杀'],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { c2: black, s1: slash },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('杀', 's1', [0]);
    P1.expectPending('询问闪');

    await P1.tryDispatch({
      skillId: '闪',
      actionType: 'respond',
      params: { cardId: 'c2#倾国' },
      preceding: [{ skillId: '界倾国', actionType: 'transform', params: { cardId: 'c2' } }],
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.cardMap['c2#倾国'].name).toBe('闪');
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 负面:黑色装备区牌 transform 被拒(官方仅限手牌) ─────────────

  it('黑色装备区牌 transform → 拒绝(界倾国仅限手牌)', async () => {
    const blackEquip = makeCard('e1', '仁王盾', '♠', '2', '装备牌'); // 黑色装备
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [],
          equipment: { 防具: 'e1' },
          skills: ['界倾国'],
        }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: { e1: blackEquip },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 装备区黑色牌不在手牌 → transform 被拒(官方限定"手牌")
    await P1.expectRejected({
      skillId: '界倾国',
      actionType: 'transform',
      params: { cardId: 'e1' },
    });
    // 装备未被卸下
    expect(harness.state.players[0].equipment.防具).toBe('e1');
  });

  // ─── 负面:红牌 transform 被拒 ─────────────────────────────

  it('红桃(♥)手牌 transform → 拒绝(不是黑色)', async () => {
    const red = makeCard('h1', '桃', '♥', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1'], skills: ['界倾国'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: { h1: red },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界倾国',
      actionType: 'transform',
      params: { cardId: 'h1' },
    });
  });

  it('方块(♦)手牌 transform → 拒绝(不是黑色)', async () => {
    const red = makeCard('d1', '桃', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['界倾国'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: { d1: red },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界倾国',
      actionType: 'transform',
      params: { cardId: 'd1' },
    });
  });

  it('不在手牌的卡 transform → 拒绝', async () => {
    const black = makeCard('c9', '杀', '♠', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界倾国'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: { c9: black },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界倾国',
      actionType: 'transform',
      params: { cardId: 'c9' },
    });
  });

  // ─── defineAction 声明验证 ─────────────────────────

  it('availableActions:界倾国 声明 transform action', async () => {
    const black = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['界倾国'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: { c1: black },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const actions = P1.availableActions().filter((a) => a.skillId === '界倾国');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.find((a) => a.actionType === 'transform')).toBeDefined();
  });
});
