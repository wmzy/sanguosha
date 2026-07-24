// 界酒池(界董卓·转化技)测试(界限突破版):
// 核心差异(相对标酒池 src/engine/skills/酒池.ts):
//   1. 黑桃手牌当酒(同标版)
//   2. 显式"无次数限制"(引擎标版酒.use 已无限制,等价)
//   3. NEW: 使用酒杀造成伤害后,本回合崩坏失效
//      机制:after-hook on '去标记' 检测 酒/nextKillDamageBonus mark 被消耗
//      → 设 turn.vars['崩坏/disabled']=true
//
// 用例:
//   1. transform execute:黑桃手牌 → 影子酒创建(cardMap 含 shadowOf 指针)
//   2. transform validate:红桃手牌 → 拒绝
//   3. transform validate:非自己回合 → 拒绝
//   4. 端到端:酒杀造成伤害 → turn.vars['崩坏/disabled']=true
//   5. 端到端:无酒增伤的普通伤害 → var 不设置
//   6. 端到端:酒增伤但伤害由他人造成 → var 不设置(mark 不在 owner 身上)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { runDamageFlow } from '../../src/engine/damage-flow';
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
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  faction?: '魏' | '蜀' | '吴' | '群';
  identity?: '主公' | '忠臣' | '反贼' | '内奸';
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界董卓',
    health: opts.health ?? 8,
    maxHealth: opts.maxHealth ?? 8,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction ?? '群',
    identity: opts.identity ?? '反贼',
  };
}

describe('界酒池', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. transform execute:黑桃手牌 → 影子酒 ──────────────
  it('transform:黑桃手牌 → 创建影子酒(shadowOf 指向原卡)', async () => {
    const spadeCard = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界酒池', '酒'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { s1: spadeCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.transformThenUse(
      '界酒池',
      { cardId: 's1' },
      '酒',
      { cardId: 's1#界酒池' },
    );

    // 酒.use 已执行,标记已加。验证酒 mark 存在(说明影子酒被酒.use 接受)
    const hasWineMark = harness.state.players[0].marks.some(
      (m) => m.id === '酒/nextKillDamageBonus',
    );
    expect(hasWineMark).toBe(true);
  });

  // ─── 2. transform validate:非黑桃 → 拒绝 ─────────────────
  it('transform:红桃手牌 → 拒绝', async () => {
    const heartCard = makeCard('h1', '杀', '♥', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['h1'],
          skills: ['界酒池', '酒'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { h1: heartCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '酒',
      actionType: 'use',
      params: { cardId: 'h1#界酒池' },
      preceding: [
        { skillId: '界酒池', actionType: 'transform', params: { cardId: 'h1' } },
      ],
    });
  });

  // ─── 3. transform validate:非自己回合 → 拒绝 ───────────────
  it('transform:非自己回合 → 拒绝', async () => {
    const spadeCard = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界酒池', '酒'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { s1: spadeCard },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '酒',
      actionType: 'use',
      params: { cardId: 's1#界酒池' },
      preceding: [
        { skillId: '界酒池', actionType: 'transform', params: { cardId: 's1' } },
      ],
    });
  });

  // ─── 4. 端到端:酒杀造成伤害 → 崩坏/disabled=true ─────────
  it('酒增伤生效后 → turn.vars[崩坏/disabled] = true', async () => {
    const spadeCard = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界酒池', '酒'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { s1: spadeCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 步骤1:界酒池转化 + 酒.use → 加 mark
    await P0.transformThenUse(
      '界酒池',
      { cardId: 's1' },
      '酒',
      { cardId: 's1#界酒池' },
    );

    // 验证 mark 已加
    const hasMarkBefore = harness.state.players[0].marks.some(
      (m) => m.id === '酒/nextKillDamageBonus',
    );
    expect(hasMarkBefore).toBe(true);

    // var 未设置
    expect(harness.state.turn.vars['崩坏/disabled']).toBeUndefined();

    // 步骤2:P0 造成 1 点伤害(模拟杀命中)。酒 before-hook 会消费 mark + 增伤 +1
    await runDamageFlow(harness.state, 0, 1, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    // 验证:酒 mark 已被消费
    const hasMarkAfter = harness.state.players[0].marks.some(
      (m) => m.id === '酒/nextKillDamageBonus',
    );
    expect(hasMarkAfter).toBe(false);
    // 验证:崩坏/disabled 已设置
    expect(harness.state.turn.vars['崩坏/disabled']).toBe(true);
    // 验证:P1 受到 2 点伤害(1 base + 1 酒增伤)
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 5. 无酒增伤的普通伤害 → var 不设置 ─────────────────
  it('无酒增伤的普通伤害 → turn.vars[崩坏/disabled] 不设置', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界酒池', '酒'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 无 mark,直接造成伤害
    await runDamageFlow(harness.state, 0, 1, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    // var 不应被设置(无 去标记 事件)
    expect(harness.state.turn.vars['崩坏/disabled']).toBeUndefined();
    // P1 受 1 伤(无增伤)
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 6. 酒增伤但伤害由他人造成 → var 不设置 ─────────────
  it('他人造成伤害(P0 有酒 mark 但非 source)→ var 不设置', async () => {
    const spadeCard = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界酒池', '酒'],
        }),
        makePlayer({ index: 1, name: 'P1', skills: [], health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P2', skills: [], health: 4, maxHealth: 4 }),
      ],
      cardMap: { s1: spadeCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P0 用酒(加 mark)
    await P0.transformThenUse(
      '界酒池',
      { cardId: 's1' },
      '酒',
      { cardId: 's1#界酒池' },
    );

    // P2 造成伤害给 P1(P0 不是 source,酒 mark 不会被消费)
    await runDamageFlow(harness.state, 2, 1, 1);
    await harness.waitForStable();
    harness.processAllEvents();

    // var 不应被设置
    expect(harness.state.turn.vars['崩坏/disabled']).toBeUndefined();
    // P0 的酒 mark 仍在
    const hasMark = harness.state.players[0].marks.some(
      (m) => m.id === '酒/nextKillDamageBonus',
    );
    expect(hasMark).toBe(true);
  });
});
