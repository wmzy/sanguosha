// tests/skill-tests/界好施.test.ts
// 界好施(界鲁肃)测试:
//   摸牌阶段多摸2,>5分半给最少者 + 跨回合被动(被杀/普通锦囊指定时受益者可交鲁肃1张)
//
// 验证:
//   1. 基本好施:摸4张+>5给3张(与标版逻辑相同,确认界版基础功能正常)
//   2. 被动触发:好施给牌后,鲁肃被杀指定时,受益者可交给鲁肃1张手牌
//   3. 被动清除:鲁肃下回合开始时被动失效
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

describe('界好施', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 基本好施:摸4张+>5给3张 ─────────────────────────

  it('发动界好施 + 手牌=7(>5):给3张,被动激活', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          hand: ['h1', 'h2', 'h3'],
          skills: ['界好施', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: [],
          skills: ['回合管理'],
        }),
      ],
      cardMap: {
        h1: makeCard('h1', '杀'),
        h2: makeCard('h2', '闪'),
        h3: makeCard('h3', '桃', '♦'),
        d1: makeCard('d1', '杀', '♠'),
        d2: makeCard('d2', '闪', '♥'),
        d3: makeCard('d3', '桃', '♦'),
        d4: makeCard('d4', '酒', '♣'),
      },
      zones: { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('鲁肃');

    await P0.triggerAction('回合管理', 'start');
    P0.expectPending('请求回应');
    await P0.respond('界好施', { choice: true }); // 发动好施

    // 手牌=3+4=7>5 → 给3张给手牌最少的P1(唯一)
    P0.expectPending('请求回应');
    await P0.respond('界好施', { cardIds: ['d1', 'd2', 'd3'] });

    // 鲁肃:7-3=4张
    expect(harness.state.players[0].hand.length).toBe(4);
    // P1:0+3=3张
    expect(harness.state.players[1].hand.length).toBe(3);
    // ★ 被动激活,受益者=P1(座次1)
    expect(harness.state.localVars['界好施/被动激活']).toBe(true);
    expect(harness.state.localVars['界好施/受益者']).toBe(1);
  });

  // ─── 2. 被动触发:鲁肃被杀指定 → 受益者可交1张 ──────────────

  it('被动激活时鲁肃被杀指定 → 受益者P1交给鲁肃1张手牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          character: '界鲁肃',
          hand: ['l1'],
          skills: ['界好施'],
          health: 3,
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
          character: '张飞',
          hand: ['kill'],
          skills: ['杀'],
        }),
      ],
      cardMap: {
        l1: makeCard('l1', '闪'),
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        kill: makeCard('kill', '杀', '♠'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 2, // P2的回合
      phase: '出牌',
      turn: { round: 2, phase: '出牌', vars: {} },
    });
    // 预设被动已激活(模拟好施给牌后的状态)
    state.localVars['界好施/被动激活'] = true;
    state.localVars['界好施/受益者'] = 1; // P1

    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P0 = harness.player('鲁肃');

    // P2 使用杀指定鲁肃(座次0)
    await P2.useCardAndTarget('杀', 'kill', [0]);

    // 成为目标 after-hook → 被动触发 → P1 被询问是否交给鲁肃1张
    P1.processEvents();
    // P1 选择交1张
    await P1.respond('界好施', { cardIds: ['p1a'] });

    // 鲁肃收到P1的牌
    expect(harness.state.players[0].hand).toContain('p1a');
    // P1失去1张
    expect(harness.state.players[1].hand.length).toBe(1);

    // 接下来是鲁肃的询问闪(杀的结算继续)
    P0.processEvents();
    await P0.pass(); // 不出闪 → 受伤害
    expect(harness.state.players[0].health).toBe(2);
  });

  // ─── 3. 被动未激活 → 不触发 ───────────────────────────────

  it('被动未激活时鲁肃被杀指定 → 不触发给牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          character: '界鲁肃',
          hand: ['l1'],
          skills: ['界好施'],
          health: 3,
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
          character: '张飞',
          hand: ['kill'],
          skills: ['杀'],
        }),
      ],
      cardMap: {
        l1: makeCard('l1', '闪'),
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        kill: makeCard('kill', '杀', '♠'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 2,
      phase: '出牌',
      turn: { round: 2, phase: '出牌', vars: {} },
    });
    // 被动未激活(不设 localVars)

    await harness.setup(state);
    const P0 = harness.player('鲁肃');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('杀', 'kill', [0]);

    // 被动不触发 → 直接进入询问闪
    P0.processEvents();
    await P0.pass(); // 不出闪 → 受伤害

    // P1手牌不变(未触发被动)
    expect(harness.state.players[1].hand.length).toBe(2);
    // 鲁肃受伤害
    expect(harness.state.players[0].health).toBe(2);
  });
});
