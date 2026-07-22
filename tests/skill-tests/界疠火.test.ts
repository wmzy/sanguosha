// 界疠火(界程普·吴·主动技)测试
//   你使用的非火【杀】可以改为火【杀】使用,此牌结算后,若其造成伤害,
//   你弃置一张牌或失去1体力。你使用的火【杀】可以多指定一个目标。
//
// 官方来源:三国杀 OL 界限突破 hero/620。
//
// 验证:
//   1. transformThenUse:普通杀当火杀 → 影子卡 damageType='火焰' + 杀成功扣血
//   2. transformThenUse:雷杀当火杀 → 同样成功(界版含雷杀)
//   3. transform 被拒:火杀不能转化(已经是火杀)
//   4. transform 被拒:非杀不能转化
//   5. transform 被拒:非自己回合
//   6. 代价:转化杀造成伤害 → 询问弃1牌 → 选弃 → 弃置 1 张牌
//   7. 代价:转化杀造成伤害 → 询问弃1牌 → 超时(放弃)→ 失去 1 体力
//   8. 代价:转化杀被闪避(无伤害)→ 不触发代价
//   9. 代价:owner 无手牌 → 直接失去 1 体力
//  10. 多目标:转化火杀选 2 目标 → 两个目标都扣血
//  11. 原始火杀(非转化):造成伤害不触发代价(代价仅限疠火转化杀)
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
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  damageType?: '普通' | '火焰' | '雷电',
): Card {
  const c: Card = { id, name, suit, color: suitColor(suit), rank, type };
  if (damageType) c.damageType = damageType;
  return c;
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  faction?: '魏' | '蜀' | '吴' | '群';
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界程普',
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
    faction: opts.faction ?? '吴',
  };
}

describe('界疠火', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. transformThenUse:普通杀当火杀 ─────────────────────

  it('transformThenUse:普通杀当火杀 → 影子卡 damageType=火焰 + 扣血', async () => {
    const slash = makeCard('s1', '杀', '♠', '7'); // 普通杀
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'c0'],
          skills: ['界疠火', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { s1: slash, c0: makeCard('c0', '闪', '♣', '2') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.transformThenUse('界疠火', { cardId: 's1' }, '杀', {
      cardId: 's1#疠火',
      targets: [1],
    });

    // 影子卡应已建立且 damageType=火焰
    expect(harness.state.cardMap['s1#疠火']).toBeDefined();
    expect(harness.state.cardMap['s1#疠火'].damageType).toBe('火焰');
    expect(harness.state.cardMap['s1#疠火'].shadowOf).toBe('s1');

    // P1 不闪 → 扣血(火焰伤害)
    await P1.pass();

    // 转化杀造成伤害 → 触发代价询问(弃1牌或失去1体力)
    // P0 选弃1张牌 → 进入选牌询问
    await P0.respond('界疠火', { cardId: 'c0' });

    expect(harness.state.players[1].health).toBe(3); // P1 扣 1 血
    // P0 弃了 c0(代价)
    expect(harness.state.players[0].hand).not.toContain('c0');
    expect(harness.state.zones.discardPile).toContain('c0');
    expect(harness.state.players[0].health).toBe(4); // 未失体力
  });

  // ─── 2. transformThenUse:雷杀当火杀 ─────────────────────

  it('transformThenUse:雷杀当火杀 → 成功(界版含雷杀)', async () => {
    const lightningSlash = makeCard('ls1', '杀', '♠', '8', '基本牌', '雷电');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['ls1', 'c0'],
          skills: ['界疠火', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { ls1: lightningSlash, c0: makeCard('c0', '闪', '♣', '2') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.transformThenUse('界疠火', { cardId: 'ls1' }, '杀', {
      cardId: 'ls1#疠火',
      targets: [1],
    });

    expect(harness.state.cardMap['ls1#疠火'].damageType).toBe('火焰');
    await P1.pass();
    // 触发代价
    await P0.respond('界疠火', { cardId: 'c0' });
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 3. transform 被拒:火杀 ─────────────────────

  it('transform:火杀 → 拒绝(已经是火杀)', async () => {
    const fireSlash = makeCard('fs1', '杀', '♥', '7', '基本牌', '火焰');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['fs1'],
          skills: ['界疠火', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { fs1: fireSlash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界疠火',
      actionType: 'transform',
      params: { cardId: 'fs1' },
    });
  });

  // ─── 4. transform 被拒:非杀 ─────────────────────

  it('transform:闪 → 拒绝(不是杀)', async () => {
    const dodge = makeCard('d1', '闪', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['d1'],
          skills: ['界疠火', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界疠火',
      actionType: 'transform',
      params: { cardId: 'd1' },
    });
  });

  // ─── 5. transform 被拒:非自己回合 ─────────────────────

  it('transform:非自己回合 → 拒绝', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界疠火', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界疠火',
      actionType: 'transform',
      params: { cardId: 's1' },
    });
  });

  // ─── 7. 代价:超时(放弃)→ 失去 1 体力 ─────────────────────

  it('代价:转化杀造成伤害 → 超时(放弃弃牌)→ 失去 1 体力', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'c0'],
          skills: ['界疠火', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { s1: slash, c0: makeCard('c0', '闪', '♣', '2') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.transformThenUse('界疠火', { cardId: 's1' }, '杀', {
      cardId: 's1#疠火',
      targets: [1],
    });
    await P1.pass();
    // P0 在代价询问中 pass(超时=放弃弃牌)→ 失去 1 体力
    await P0.pass();

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].health).toBe(3); // 失去 1 体力
    expect(harness.state.players[0].hand).toContain('c0'); // 未弃牌
  });

  // ─── 8. 代价:被闪避(无伤害)→ 不触发代价 ─────────────────────

  it('代价:转化杀被闪避 → 不触发代价', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'c0'],
          skills: ['界疠火', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { s1: slash, c0: makeCard('c0', '闪', '♣', '3'), d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.transformThenUse('界疠火', { cardId: 's1' }, '杀', {
      cardId: 's1#疠火',
      targets: [1],
    });
    // P1 出闪抵消
    await P1.respond('闪', { cardId: 'd1' });

    expect(harness.state.players[1].health).toBe(4); // 未扣血
    expect(harness.state.players[0].health).toBe(4); // 未失体力
    expect(harness.state.players[0].hand).toContain('c0'); // 未弃牌
    // 无代价 pending(已经收尾)
    expect(harness.state.pendingSlots.size).toBeLessThanOrEqual(1);
  });

  // ─── 9. 代价:owner 无手牌 → 直接失去 1 体力 ─────────────────────

  it('代价:owner 无手牌(仅转化杀)→ 直接失去 1 体力', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'], // 转化后手牌为空
          skills: ['界疠火', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.transformThenUse('界疠火', { cardId: 's1' }, '杀', {
      cardId: 's1#疠火',
      targets: [1],
    });
    await P1.pass();
    // owner 无手牌 → 直接失去 1 体力,无询问
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[0].health).toBe(3); // 失去 1 体力
  });

  // ─── 10. 多目标:转化火杀选 2 目标 ─────────────────────

  it('多目标:转化火杀选 2 目标 → 两目标都扣血(代价仅 1 次)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 'c0'],
          skills: ['界疠火', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['闪'] }),
      ],
      cardMap: { s1: slash, c0: makeCard('c0', '闪', '♣', '2') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P0.transformThenUse('界疠火', { cardId: 's1' }, '杀', {
      cardId: 's1#疠火',
      targets: [1, 2], // 两个目标
    });

    // 两目标都不闪 → 都扣血
    await P1.pass();
    await P2.pass();

    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[2].health).toBe(3);

    // 代价询问(只触发 1 次,因为杀收尾只 1 次)
    await P0.respond('界疠火', { cardId: 'c0' });
    expect(harness.state.players[0].hand).not.toContain('c0');
  });

  // ─── 11. 原始火杀(非转化):造成伤害不触发代价 ─────────────────────

  it('原始火杀:造成伤害不触发疠火代价', async () => {
    const fireSlash = makeCard('fs1', '杀', '♥', '7', '基本牌', '火焰');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['fs1', 'c0'],
          skills: ['界疠火', '杀', '闪'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { fs1: fireSlash, c0: makeCard('c0', '闪', '♣', '2') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 直接出原始火杀(不转化)
    await P0.useCardAndTarget('杀', 'fs1', [1]);
    await P1.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3); // 火焰伤害扣血
    expect(harness.state.players[0].health).toBe(4); // 不触发代价
    expect(harness.state.players[0].hand).toContain('c0'); // 未弃牌
  });
});
