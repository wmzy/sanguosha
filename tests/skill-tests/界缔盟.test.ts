// tests/skill-tests/界缔盟.test.ts
// 界缔盟(界鲁肃)测试:
//   出牌阶段限一次,令两名角色交换手牌(差不大于你的牌数),
//   出牌阶段结束时弃X张牌(X为手牌数差)。
//
// 验证:
//   1. 正面:diff=2 → 先交换(不立即弃),出牌阶段结束时弃2张
//   2. 前置条件:diff > 鲁肃牌数 → 不执行交换
//   3. diff=0 → 交换但无需弃牌
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
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界鲁肃',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: '吴',
    identity: '主公',
  };
}

describe('界缔盟', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:diff=2 → 先交换,出牌阶段结束时弃2张 ──────────

  it('P1(3张) vs P2(1张),diff=2:先交换,出牌阶段结束弃2张', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          hand: ['c1', 'c2', 'c3', 'c4'],
          skills: ['界缔盟', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a', 'p1b', 'p1c'],
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['p2a'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        c3: makeCard('c3', '桃', '♦'),
        c4: makeCard('c4', '酒', '♣'),
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        p1c: makeCard('p1c', '桃', '♥'),
        p2a: makeCard('p2a', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('鲁肃');

    // 发动界缔盟
    await P0.triggerAction('界缔盟', 'use');
    P0.expectPending('请求回应'); // 选目标
    await P0.respond('界缔盟', { targets: [1, 2] });

    // ★ 界版:先交换(不立即弃牌)
    // P1 原手牌 [p1a,p1b,p1c] → 交换后 = P2 原手牌 [p2a]
    expect(harness.state.players[1].hand).toEqual(['p2a']);
    // P2 原手牌 [p2a] → 交换后 = P1 原手牌 [p1a,p1b,p1c]
    expect(harness.state.players[2].hand).toEqual(['p1a', 'p1b', 'p1c']);
    // 鲁肃手牌未变(尚未弃牌)
    expect(harness.state.players[0].hand.length).toBe(4);
    // 记录待弃数 X=2
    expect(harness.state.localVars['界缔盟/待弃数']).toBe(2);

    // 结束出牌阶段 → 触发延迟弃牌
    await P0.triggerAction('回合管理', 'end', {});

    // 出现弃牌 pending(界缔盟延迟弃:弃2张)
    P0.processEvents();
    await P0.respond('界缔盟', { cardIds: ['c1', 'c2'] });

    // 鲁肃:4 - 2 = 2 张(≤ HP 3,无需正常弃牌)
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c2');
    // 弃牌堆含 c1, c2
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'c2']));
    // 待弃标记已清除
    expect(harness.state.localVars['界缔盟/待弃数']).toBeUndefined();
  });

  // ─── 2. 前置条件:diff > 鲁肃牌数 → 不执行 ─────────────────

  it('diff=4 > 鲁肃牌数2 → 不执行交换', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          hand: ['c1', 'c2'], // 仅2张牌
          skills: ['界缔盟', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a', 'p1b', 'p1c', 'p1d', 'p1e'], // 5张
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['p2a'], // 1张 → diff=4
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        p1c: makeCard('p1c', '桃', '♥'),
        p1d: makeCard('p1d', '酒', '♣'),
        p1e: makeCard('p1e', '杀', '♠'),
        p2a: makeCard('p2a', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('鲁肃');

    // 发动界缔盟
    await P0.triggerAction('界缔盟', 'use');
    P0.expectPending('请求回应'); // 选目标
    await P0.respond('界缔盟', { targets: [1, 2] });

    // diff=4 > 鲁肃牌数2 → 不执行交换
    // P1, P2 手牌不变
    expect(harness.state.players[1].hand).toEqual(['p1a', 'p1b', 'p1c', 'p1d', 'p1e']);
    expect(harness.state.players[2].hand).toEqual(['p2a']);
    // 鲁肃手牌不变
    expect(harness.state.players[0].hand.length).toBe(2);
    // 无待弃标记
    expect(harness.state.localVars['界缔盟/待弃数']).toBeUndefined();
  });

  // ─── 3. diff=0 → 交换但无需弃牌 ───────────────────────────

  it('P1(2张) vs P2(2张),diff=0:交换但无需弃牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          hand: ['c1', 'c2'],
          skills: ['界缔盟', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a', 'p1b'],
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['p2a', 'p2b'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        p2a: makeCard('p2a', '桃', '♥'),
        p2b: makeCard('p2b', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('鲁肃');

    await P0.triggerAction('界缔盟', 'use');
    P0.expectPending('请求回应');
    await P0.respond('界缔盟', { targets: [1, 2] });

    // 交换完成
    expect(harness.state.players[1].hand).toEqual(['p2a', 'p2b']);
    expect(harness.state.players[2].hand).toEqual(['p1a', 'p1b']);
    // diff=0 → 无待弃标记
    expect(harness.state.localVars['界缔盟/待弃数']).toBeUndefined();
    // 鲁肃手牌不变
    expect(harness.state.players[0].hand.length).toBe(2);
  });
});
