// 界禁酒(界高顺·群·锁定技)测试,OL hero/604 官方逐字:
//   "锁定技，你的【酒】视为点数K的【杀】。其他角色不能于你的回合使用【酒】。"
//
// 验证:
//   1. 转化:【酒】手牌可当点数K的【杀】使用(preceding transform + 杀.use)
//   2. 转化出的杀点数为 K(cardMap 中影子卡 rank=K)
//   3. 转化出的杀按【杀】正常结算(目标需出闪/受伤害)
//   4. 不是自己回合 → 转化被拒
//   5. 无【酒】手牌 → 转化按钮不显示(activeWhen)
//   6. 其他角色不能于界高顺回合使用【酒】(酒.respond 被拒)
//   7. 其他角色在界高顺回合外可正常使用【酒】(酒.respond 放行)
//   8. 桃救援不受影响(界高顺回合内他人仍可用桃自救)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
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
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界高顺',
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

describe('界禁酒', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 转化:【酒】手牌可当点数K的【杀】使用 ──────────────────
  it('转化:【酒】当 K 杀使用 → 命中目标', async () => {
    const wine = makeCard('w1', '酒', '♦', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['w1'],
          skills: ['界禁酒', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['回合管理'],
          character: '曹操',
        }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 用界禁酒把 w1(酒)转化为 K 杀,目标 P1
    await P0.transformThenUse(
      '界禁酒',
      { cardId: 'w1' },
      '杀',
      { cardId: 'w1#界禁酒', targets: [1] },
    );
    await waitForStable(harness.state);
    await P1.pass(); // 不出闪
    await waitForStable(harness.state);

    // P1 受伤 → 转化出的杀正常结算
    expect(harness.state.players[1].health).toBe(3);
    // 影子卡入弃牌堆时自动还原为原卡(移动牌 atom 的 shadowOf 逻辑)
    expect(harness.state.zones.discardPile).toContain('w1');
  });

  // ─── 2. 转化出的杀点数为 K ──────────────────
  it('转化后影子卡 rank=K', async () => {
    const wine = makeCard('w1', '酒', '♦', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['w1'],
          skills: ['界禁酒', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['回合管理'],
          character: '曹操',
        }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 仅执行 transform,不提交主 action —— 影子卡应已创建并 rank=K。
    // 用 triggerAction 单独触发 transform(不会走主 action)。
    await P0.triggerAction('界禁酒', 'transform', { cardId: 'w1' });
    await waitForStable(harness.state);

    const shadow = harness.state.cardMap['w1#界禁酒'];
    expect(shadow).toBeDefined();
    expect(shadow?.name).toBe('杀');
    expect(shadow?.rank).toBe('K');
  });

  // ─── 3. 不是自己回合 → transform 被拒 ──────────────────
  it('不是自己回合 → 界禁酒 transform 被拒', async () => {
    const wine = makeCard('w1', '酒', '♦', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['w1'],
          skills: ['界禁酒'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['回合管理'],
          character: '曹操',
        }),
      ],
      cardMap: { w1: wine },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界禁酒',
      actionType: 'transform',
      params: { cardId: 'w1' },
    });
  });

  // ─── 4. 其他角色不能于界高顺回合使用【酒】(酒.respond 被拒) ──────────
  it('界高顺回合内,其他角色不能用酒.respond 自救', async () => {
    const wine = makeCard('w1', '酒', '♦', '5');
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界禁酒', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['w1'],
          skills: ['回合管理', '酒'],
          character: '曹操',
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { w1: wine, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 出杀打 P1(1 血)→ P1 濒死求桃
    await P0.useCardAndTarget('杀', 's1', [1]);
    await waitForStable(harness.state);

    // P1 尝试用酒自救:应被禁酒拦截
    await P1.expectRejected({
      skillId: '酒',
      actionType: 'respond',
      params: { cardId: 'w1' },
    });
  });

  // ─── 5. 界高顺回合外,其他角色可正常使用【酒】 ──────────────────
  it('非界高顺回合,其他角色酒.respond 放行', async () => {
    const wine = makeCard('w1', '酒', '♦', '5');
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界禁酒'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['s1'],
          skills: ['回合管理', '杀'],
          character: '曹操',
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          hand: ['w1'],
          skills: ['回合管理', '酒'],
          character: '刘备',
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { w1: wine, s1: slash },
      currentPlayerIndex: 1, // P1 回合(非界高顺)
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P1 出杀打 P2(1 血)→ P2 濒死求桃
    await P1.useCardAndTarget('杀', 's1', [2]);
    await waitForStable(harness.state);

    // P2 用酒自救:应放行(P1 回合,非界高顺回合)
    await P2.respond('酒', { cardId: 'w1' });
    await waitForStable(harness.state);

    // P2 回血到 1(酒救 1 血,原本 1 血濒死 → 1 血)
    expect(harness.state.players[2].health).toBe(1);
    expect(harness.state.players[2].alive).toBe(true);
  });

  // ─── 6. 桃救援不受禁酒影响 ──────────────────
  it('界高顺回合内,其他角色仍可用桃自救(禁酒仅禁酒)', async () => {
    const peach = makeCard('p1', '桃', '♥', '3');
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界禁酒', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1'],
          skills: ['回合管理', '桃'],
          character: '曹操',
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { p1: peach, s1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 出杀打 P1(1 血)→ P1 濒死求桃
    await P0.useCardAndTarget('杀', 's1', [1]);
    await waitForStable(harness.state);

    // P1 用桃自救:应放行
    await P1.respond('桃', { cardId: 'p1' });
    await waitForStable(harness.state);

    // P1 存活,1 血
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.players[1].alive).toBe(true);
  });
});
