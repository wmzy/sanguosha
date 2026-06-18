// tests/skill-tests/武圣.test.ts
// 武圣(关羽·转化技)技能测试:
//   transform:把一张红色手牌当【杀】(新建影子杀,手牌中原卡 id 替换为影子 id)。
//   配合 preceding + 杀.use 完整流程:transformThenUse API。
//
// 验证:
//   1. 正面:红牌(♥/♦) transformThenUse 杀 → 创建影子杀,P2 扣血
//   2. 正面:验证 cardMap 有影子卡(原卡 → 杀)
//   3. 负面:黑牌 transform 被拒(不是红色)
//   4. 负面:非自己回合 transform 被拒
//   5. 负面:不在手牌的卡 transform 被拒
//   6. 负面:transform + 黑牌作为杀使用 → 杀 validate 看到原卡,失败(rollback)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
  return { id, name, suit, rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '关羽',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['武圣'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
  };
}

describe('武圣', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:transform + use 杀 ─────────────────────────────

  it('transformThenUse:红桃牌当杀 → 创建影子杀 + 杀成功', async () => {
    const red = makeCard('c1', '桃', '♥', 'A'); // 红桃
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['武圣', '杀', '闪'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { c1: red },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 转化:红桃当杀(useSkill='杀', 杀 id='c1#武圣')
    await P1.transformThenUse(
      '武圣',
      { cardId: 'c1' },
      '杀',
      { cardId: 'c1#武圣', targets: [1] },
    );

    // 影子卡应已建立
    expect(harness.state.cardMap['c1#武圣']).toBeDefined();
    expect(harness.state.cardMap['c1#武圣'].name).toBe('杀');
    expect(harness.state.cardMap['c1#武圣'].shadowOf).toBe('c1');
    // P2 不闪 → 扣血
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
    // 杀进入弃牌堆(实际是原卡 c1 — 因为影子最终还原)
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  it('transformThenUse:方块(♦)红牌当杀 → 同样成功', async () => {
    const red = makeCard('d1', '桃', '♦', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['武圣', '杀', '闪'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { d1: red },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse(
      '武圣',
      { cardId: 'd1' },
      '杀',
      { cardId: 'd1#武圣', targets: [1] },
    );

    expect(harness.state.cardMap['d1#武圣'].name).toBe('杀');
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 负面:transform ─────────────────────────────

  it('transform:黑桃(♠) → 拒绝(不是红色)', async () => {
    const black = makeCard('s1', '桃', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'], skills: ['武圣'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { s1: black },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 黑桃不是红色 → 武圣 transform 拒绝
    await P1.expectRejected({ skillId: '武圣', actionType: 'transform', params: { cardId: 's1' } });
  });

  it('transform:梅花(♣) → 拒绝(不是红色)', async () => {
    const club = makeCard('c2', '桃', '♣', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c2'], skills: ['武圣'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { c2: club },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '武圣', actionType: 'transform', params: { cardId: 'c2' } });
  });

  it('transform:非自己回合 → 拒绝', async () => {
    const red = makeCard('c1', '桃', '♥', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['武圣'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { c1: red },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '武圣', actionType: 'transform', params: { cardId: 'c1' } });
  });

  it('transform:不在手牌的卡 → 拒绝', async () => {
    const red = makeCard('c1', '桃', '♥', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['武圣'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { c1: red },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '武圣', actionType: 'transform', params: { cardId: 'c1' } });
  });

  it('transform rollback:转化后 use 杀失败(无目标)→ 原卡还原', async () => {
    // 验证 preceding rollback 机制:武圣 transform 创建影子卡,
    // 主 action 杀.use 失败时,武圣 的 rollback 删影子卡 + 手牌还原。
    const red = makeCard('c1', '桃', '♥', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['武圣', '杀', '闪'], health: 4, maxHealth: 4 }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { c1: red },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 没有 targets,杀 validate 拒绝 → rollback 武圣 transform
    // 实际上没有 targets 应当也是被拒绝
    await P1.expectRejected({ skillId: '杀', actionType: 'use', params: {
      cardId: 'c1#武圣',
      preceding: [{ skillId: '武圣', actionType: 'transform', params: { cardId: 'c1' } }],
    } });

    // 状态应当完全还原:c1 仍是桃,手牌仍是 c1,影子卡不应存在
    expect(harness.state.cardMap['c1'].name).toBe('桃');
    expect(harness.state.cardMap['c1#武圣']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['c1']);
  });
});
