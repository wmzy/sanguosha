// tests/skill-tests/丈八蛇矛.test.ts
import { frameCards } from '../../src/engine/create-engine';
// 丈八蛇矛(武器,攻击范围 3)·转化技:你可以将 2 张手牌当【杀】使用或打出。
//
// 模型:preceding=[丈八蛇矛.transform cardIds=[id1,id2]] + 主 action=杀.use
//   (杀 cardId = `${id1}#${id2}#丈八蛇矛`,影子卡)
//
// 验证:
//   1. 正面:2 张手牌 transformThenUse 杀 → 创建影子杀,P2 扣血
//   2. 正面:验证 cardMap 有影子卡(2张 → 1张 杀)
//   3. 负面:1 张牌 → 拒绝
//   4. 负面:同一张牌 → 拒绝
//   5. 负面:未装备丈八蛇矛 → 拒绝
//   6. rollback:杀.use 失败(无目标)→ 两张原卡还原,影子卡删除
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
  return { id, name, suit, rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['杀', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

const ZHANGBA = makeCard('zb', '丈八蛇矛', '♠', 'Q', '装备牌');

describe('丈八蛇矛', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:transform + use 杀 ─────────────────────────────

  it('transformThenUse:2 张手牌当杀 → 创建影子杀,P2 扣血', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    const c2 = makeCard('c2', '桃', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], skills: ['丈八蛇矛', '杀', '闪'], equipment: { 武器: 'zb' } }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: ['闪'] }),
      ],
      cardMap: { zb: ZHANGBA, c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 转化:2 张手牌当杀。影子杀 id = c1#c2#丈八蛇矛
    await P1.transformThenUse(
      '丈八蛇矛',
      { cardIds: ['c1', 'c2'] },
      '杀',
      { cardId: 'c1#c2#丈八蛇矛', targets: [1] },
    );

    // 影子卡应已建立,并作为杀牌进了处理区(transform 执行后紧接着杀.use)
    expect(harness.state.cardMap['c1#c2#丈八蛇矛']).toBeDefined();
    expect(harness.state.cardMap['c1#c2#丈八蛇矛'].name).toBe('杀');
    // 两张原卡从手牌移除(已被 transform 合并成影子卡)
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c2');
    // 影子杀在处理区(杀牌已被杀.use 移到处理区)
    expect(frameCards(harness.state)).toContain('c1#c2#丈八蛇矛');

    // P2 不闪 → 扣血
    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
    // view 级断言
    P2.processEvents();
    P2.expectView(v => {
      expect(v.players[1].health).toBe(3);
      expect(v.pending).toBeNull();
    });
  });

  // ─── 负面:transform 校验 ─────────────────────────────

  it('transform:1 张牌 → 拒绝(需要 2 张)', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['丈八蛇矛'], equipment: { 武器: 'zb' } }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { zb: ZHANGBA, c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '丈八蛇矛', actionType: 'transform', params: { cardIds: ['c1'] },
    });
  });

  it('transform:同一张牌 → 拒绝', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1'], skills: ['丈八蛇矛'], equipment: { 武器: 'zb' } }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { zb: ZHANGBA, c1 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '丈八蛇矛', actionType: 'transform', params: { cardIds: ['c1', 'c1'] },
    });
  });

  it('transform:未装备丈八蛇矛 → 拒绝', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    const c2 = makeCard('c2', '桃', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], skills: ['丈八蛇矛'] }), // 无装备
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '丈八蛇矛', actionType: 'transform', params: { cardIds: ['c1', 'c2'] },
    });
  });

  // ─── rollback ─────────────────────────────

  it('transform rollback:杀.use 失败(无目标)→ 两张原卡还原,影子卡删除', async () => {
    const c1 = makeCard('c1', '闪', '♠', '2');
    const c2 = makeCard('c2', '桃', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2'], skills: ['丈八蛇矛', '杀'], equipment: { 武器: 'zb' } }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪'] }),
      ],
      cardMap: { zb: ZHANGBA, c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 没有 targets,杀 validate 拒绝 → rollback 丈八蛇矛 transform
    await P1.expectRejected({
      skillId: '杀', actionType: 'use', params: { cardId: 'c1#c2#丈八蛇矛' },
      preceding: [{ skillId: '丈八蛇矛', actionType: 'transform', params: { cardIds: ['c1', 'c2'] } }],
    });

    // 状态应当完全还原:c1/c2 在手牌,影子卡不应存在
    expect(harness.state.cardMap['c1#c2#丈八蛇矛']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(harness.state.players[0].hand).toHaveLength(2);
  });
});
