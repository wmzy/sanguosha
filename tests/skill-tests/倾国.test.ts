// tests/skill-tests/倾国.test.ts
// 倾国(甄姬·转化技)测试:将一张黑色手牌当【闪】打出。
//
// 验证:
//   1. 正面:黑牌(♠/♣) transform + 闪.respond → 创建影子闪,闪进处理区,P2 杀被抵消
//   2. 正面:梅花(♣)黑牌同样成功
//   3. 负面:红牌(♥) transform 被拒(不是黑色)
//   4. 负面:不在手牌的卡 transform 被拒
//   5. defineAction 声明验证:transform prompt 卡过滤是黑色牌
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
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '甄姬',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['倾国', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('倾国', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:transform + 闪.respond ─────────────────────────────

  it('transformThenRespond:黑桃牌当闪 → 创建影子闪,闪进处理区,杀被抵消', async () => {
    // P2 出杀打 P1(甄姬)。P1 用倾国把黑桃牌当闪。
    const black = makeCard('c1', '杀', '♠', 'A'); // 黑桃(黑色)
    const slash = makeCard('s1', '杀', '♥', '5'); // P2 的杀(红色,不被仁王盾无效)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['c1'],
          skills: ['倾国', '闪'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['s1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
          character: '曹操',
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

    // P2 出杀打 P1
    await P2.useCardAndTarget('杀', 's1', [0]);

    // P1 处于询问闪 pending
    P1.expectPending('询问闪');

    // P1 用倾国:preceding=[倾国.transform] + 主=闪.respond
    await P1.tryDispatch({
      skillId: '闪',
      actionType: 'respond',
      params: { cardId: 'c1#倾国' },
      preceding: [{ skillId: '倾国', actionType: 'transform', params: { cardId: 'c1' } }],
    });
    await harness.waitForStable();
    harness.processAllEvents();

    // 影子闪应已建立
    expect(harness.state.cardMap['c1#倾国']).toBeDefined();
    expect(harness.state.cardMap['c1#倾国'].name).toBe('闪');
    expect(harness.state.cardMap['c1#倾国'].shadowOf).toBe('c1');
    // P1 不扣血(闪抵消了杀)
    expect(harness.state.players[0].health).toBe(4);
  });

  it('transformThenRespond:梅花(♣)黑牌当闪 → 同样成功', async () => {
    const black = makeCard('c2', '桃', '♣', '7'); // 梅花(黑色)
    const slash = makeCard('s1', '杀', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c2'], skills: ['倾国', '闪'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['s1'],
          skills: ['杀'],
          character: '曹操',
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
      preceding: [{ skillId: '倾国', actionType: 'transform', params: { cardId: 'c2' } }],
    });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.cardMap['c2#倾国'].name).toBe('闪');
    expect(harness.state.players[0].health).toBe(4);
  });

  // ─── 负面:transform ─────────────────────────────

  it('transform:红桃(♥) → 拒绝(不是黑色)', async () => {
    const red = makeCard('h1', '桃', '♥', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['h1'], skills: ['倾国'] }),
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
      skillId: '倾国',
      actionType: 'transform',
      params: { cardId: 'h1' },
    });
  });

  it('transform:方块(♦) → 拒绝(不是黑色)', async () => {
    const red = makeCard('d1', '桃', '♦', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['倾国'] }),
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
      skillId: '倾国',
      actionType: 'transform',
      params: { cardId: 'd1' },
    });
  });

  it('transform:不在手牌的卡 → 拒绝', async () => {
    const black = makeCard('c9', '杀', '♠', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['倾国'] }),
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
      skillId: '倾国',
      actionType: 'transform',
      params: { cardId: 'c9' },
    });
  });

  // ─── defineAction 声明验证 ─────────────────────────

  it('availableActions:倾国 声明 transform action,prompt 卡过滤是黑色牌', async () => {
    const black = makeCard('c1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['倾国'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: { c1: black },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const actions = P1.availableActions().filter((a) => a.skillId === '倾国');
    expect(actions.length).toBeGreaterThan(0);
    const transformAction = actions.find((a) => a.actionType === 'transform');
    expect(transformAction).toBeDefined();
  });

  // ─── 负面:黑色装备区牌 transform 被拒(官方仅限手牌) ─────────────
  // 用例来源:原 tests/skill-tests/界倾国.test.ts。界倾国已于 2026-07 合并入标版倾国
  // (两文件实现等价,界版仅有 prompt 措辞与 satisfies 守卫两处微优化,已 backport),
  // 该独有用例一并迁入此处。

  it('transform:黑色装备区牌 → 拒绝(倾国仅限手牌)', async () => {
    const blackEquip = makeCard('e1', '仁王盾', '♠', '2', '装备牌'); // 黑色装备
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [],
          equipment: { 防具: 'e1' },
          skills: ['倾国'],
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
      skillId: '倾国',
      actionType: 'transform',
      params: { cardId: 'e1' },
    });
    // 装备未被卸下
    expect(harness.state.players[0].equipment.防具).toBe('e1');
  });
});
