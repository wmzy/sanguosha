// 界毅重(界于禁·魏·锁定技)测试:
//   ① 体力值大于等于你的角色的黑色【杀】对你无效
//   ② 手牌数小于等于你的角色无法响应你的黑色【杀】
//
// 用例:
//   ①正面:高体力黑杀打我 → 无效(cancel 检测有效性,不询问闪、不扣血)
//   ①负面:低体力黑杀打我 → 正常询问闪,不出闪则扣血
//   ①负面:高体力红杀打我 → 正常询问闪(色不符)
//   ①边界:等体力黑杀打我 → 无效(>= 含等于)
//   ②正面:我用黑杀打低手牌角色 → 不询问闪,直接扣血
//   ②负面:我用黑杀打高手牌角色 → 正常询问闪
//   ②负面:我用红杀打低手牌角色 → 正常询问闪
//   ②边界:等手牌黑杀打目标 → 直接扣血(<= 含等于)
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
  equipment?: Record<string, string>;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界于禁',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
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

describe('界毅重', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── ① 正面:高体力黑杀打我 → 无效 ─────────────────────────

  it('①正面:P1(5血)用黑杀打 P0(4血,界毅重)→ 无效,不询问闪不扣血', async () => {
    const blackKill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界毅重', '闪'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k1'],
          skills: ['杀'],
          health: 5,
          maxHealth: 5,
        }),
      ],
      cardMap: { k1: blackKill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P1').useCardAndTarget('杀', 'k1', [0]);

    // ① 生效:cancel 检测有效性 → 无 pending、不扣血、杀入弃牌堆
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── ① 边界:等体力黑杀打我 → 无效(>= 含等于) ──────────────

  it('①边界:P1(4血=我)用黑杀打 P0(4血,界毅重)→ 无效', async () => {
    const blackKill = makeCard('k2', '杀', '♣', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界毅重', '闪'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k2'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { k2: blackKill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P1').useCardAndTarget('杀', 'k2', [0]);

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('k2');
  });

  // ─── ① 负面:低体力黑杀打我 → 正常询问闪 ─────────────────────

  it('①负面:P1(2血<我)用黑杀打 P0(4血,界毅重)→ 正常询问闪', async () => {
    const blackKill = makeCard('k3', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界毅重', '闪'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k3'],
          skills: ['杀'],
          health: 2,
          maxHealth: 4,
        }),
      ],
      cardMap: { k3: blackKill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await harness.player('P1').useCardAndTarget('杀', 'k3', [0]);
    P0.expectPending('询问闪'); // 体力条件不满足,正常询问
    await P0.pass();

    expect(harness.state.players[0].health).toBe(3); // 扣 1 血
  });

  // ─── ① 负面:高体力红杀打我 → 正常询问闪(色不符) ─────────

  it('①负面:P1(5血)用红杀打 P0(4血,界毅重)→ 正常询问闪', async () => {
    const redKill = makeCard('k4', '杀', '♥', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界毅重', '闪'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['k4'],
          skills: ['杀'],
          health: 5,
          maxHealth: 5,
        }),
      ],
      cardMap: { k4: redKill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await harness.player('P1').useCardAndTarget('杀', 'k4', [0]);
    P0.expectPending('询问闪');
    await P0.pass();

    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── ② 正面:我用黑杀打低手牌角色 → 直接命中 ───────────────

  it('②正面:P0(2手牌,界毅重)用黑杀打 P1(1手牌)→ 不询问闪,直接扣血', async () => {
    const blackKill = makeCard('b1', '杀', '♣', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['b1', 'x1'],
          skills: ['界毅重', '杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['x2'], // 1 张手牌
          skills: ['闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        b1: blackKill,
        x1: makeCard('x1', '闪', '♥', '2'),
        x2: makeCard('x2', '闪', '♦', '3'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').useCardAndTarget('杀', 'b1', [1]);

    // ② 生效:cancel 询问闪 → 无 pending,直接扣血
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('b1');
  });

  // ─── ② 边界:等手牌黑杀打目标 → 直接命中(<= 含等于) ───────

  it('②边界:P0(2手牌,界毅重)用黑杀打 P1(1手牌)→ 直接扣血(<= 含等于)', async () => {
    const blackKill = makeCard('b2', '杀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['b2', 'extra1'], // 2 张手牌
          skills: ['界毅重', '杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['y1'], // 出杀结算时 P0=1手牌, P1=1手牌
          skills: ['闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        b2: blackKill,
        extra1: makeCard('extra1', '闪', '♥', '4'),
        y1: makeCard('y1', '闪', '♥', '5'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await harness.player('P0').useCardAndTarget('杀', 'b2', [1]);

    // P0 出黑杀后剩 1 手牌,P1=1 手牌 → <= → 直接命中
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── ② 负面:我用黑杀打高手牌角色 → 正常询问闪 ───────────

  it('②负面:P0(1手牌,界毅重)用黑杀打 P1(3手牌)→ 正常询问闪', async () => {
    const blackKill = makeCard('b3', '杀', '♣', '6');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['b3'],
          skills: ['界毅重', '杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['q1', 'q2', 'q3'], // 3 张手牌
          skills: ['闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        b3: blackKill,
        q1: makeCard('q1', '闪', '♥', '2'),
        q2: makeCard('q2', '杀', '♠', '5'),
        q3: makeCard('q3', '桃', '♦', '8'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await harness.player('P0').useCardAndTarget('杀', 'b3', [1]);
    P1.expectPending('询问闪');
    await P1.pass();

    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── ② 负面:我用红杀打低手牌角色 → 正常询问闪(色不符) ───

  it('②负面:P0(2手牌,界毅重)用红杀打 P1(1手牌)→ 正常询问闪', async () => {
    const redKill = makeCard('r1', '杀', '♦', 'J');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['r1', 'z1'],
          skills: ['界毅重', '杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['z2'],
          skills: ['闪'],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {
        r1: redKill,
        z1: makeCard('z1', '闪', '♣', '4'),
        z2: makeCard('z2', '闪', '♥', '7'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await harness.player('P0').useCardAndTarget('杀', 'r1', [1]);
    P1.expectPending('询问闪'); // 红杀不受 ② 加成
    await P1.pass();

    expect(harness.state.players[1].health).toBe(3);
  });
});
