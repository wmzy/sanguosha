// tests/skill-tests/乐不思蜀.test.ts
// 验证乐不思蜀延时锦囊:对目标判定区放入 + 判定阶段判定 + 跳过出牌阶段
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, fireTimeoutAndWait, waitForStable } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
import { 判定 as 判定Atom } from '../../src/engine/atoms/判定';
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
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  pendingTricks?: Array<{ name: string; source: number; card: Card }>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    judgeZone: [],
    tags: [],
  };
}

describe('乐不思蜀', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('use action:对目标放置 乐不思蜀 延时锦囊', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['l1'], skills: ['乐不思蜀', '回合管理'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: { l1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.triggerAction('乐不思蜀', 'use', { cardId: 'l1', target: 1 });

    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
    expect(harness.state.players[1].pendingTricks[0].source).toBe(0);
    expect(harness.state.zones.discardPile).toContain('l1');
  });

  it('判定为红桃:移除延时锦囊,不加跳过标签', async () => {
    // 牌堆顶设为红桃 → 判定牌为 ♥ → 乐不思蜀无效
    const card = makeCard('l1', '乐不思蜀', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['乐不思蜀', '回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card, j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    // 把判定牌放到牌堆顶(牌堆数组头部 = 顶)
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    // 触发 阶段开始 判定 之前先注册 P2 的技能实例(loadFrontend 已做)
    // 模拟 P2 的回合进入判定阶段:发 阶段开始 判定 atom
    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

    // 红桃 → 仅移除延时锦囊,不加跳过出牌标签
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    const hasSkipTag = harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌');
    expect(hasSkipTag).toBe(false);
  });

  it('判定为黑桃:加跳过出牌标签,移除延时锦囊', async () => {
    // 牌堆顶设为黑桃 → 判定牌为 ♠ → 乐不思蜀生效
    const card = makeCard('l1', '乐不思蜀', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['乐不思蜀', '回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card, j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

    // 黑桃 → 移除延时锦囊 + 加跳过出牌标签
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    const hasSkipTag = harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌');
    expect(hasSkipTag).toBe(true);
  });

  it('判定后 + 出牌阶段开始 → cancel 出牌阶段,标签清除', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    // P2 手牌 5 张 > 体力 4:出牌被跳过后弃牌阶段产生 discard pending(阻塞级联),
    // 便于在弃牌阶段断言中间状态(弃牌完成后才自动推进到回合结束)
    const d1 = makeCard('d1', '杀', '♠', '8', '基本牌');
    const d2 = makeCard('d2', '杀', '♠', '9', '基本牌');
    const d3 = makeCard('d3', '杀', '♠', '2', '基本牌');
    const d4 = makeCard('d4', '杀', '♣', '3', '基本牌');
    const d5 = makeCard('d5', '杀', '♣', '4', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [d1.id, d2.id, d3.id, d4.id, d5.id],
          skills: ['乐不思蜀', '回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card, j1: judgeCard, d1, d2, d3, d4, d5 },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    // 阶段开始 判定 → 触发 判定 → 加跳过标签
    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口
    const hasSkipTagBefore = harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌');
    expect(hasSkipTagBefore).toBe(true);

    // 进入出牌阶段 → SKIP_TAG 命中 → 出牌被 cancel → 弃牌阶段(discard pending 阻塞)
    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '出牌' });
    await waitForStable(harness.state);

    // 出牌阶段被 cancel:state.phase 应已推进到 弃牌(因内部触发了 阶段结束 出牌)
    expect(harness.state.phase).toBe('弃牌');
    // 标签应已清除
    const hasSkipTagAfter = harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌');
    expect(hasSkipTagAfter).toBe(false);
  });

  it('判定事件携带待判定牌牌面(延时锦囊判定)', () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card, j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };

    // toViewEvents 在 apply 之前调用:牌堆顶为判定结果,判定区延时锦囊为待判定牌
    const split = 判定Atom.toViewEvents(state, { player: 1, judgeType: '乐不思蜀' })!;
    const view = split.othersView!;
    expect(view.card).toMatchObject({ name: '判定牌', suit: '♥', rank: '5' });
    expect(view.pendingCard).toMatchObject({ name: '乐不思蜀', suit: '♠', rank: 'A' });
  });

  it('技能判定(判定区无同名牌)不携带待判定牌', () => {
    const judgeCard = makeCard('j1', '判定牌', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: { j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };

    const split = 判定Atom.toViewEvents(state, { player: 1, judgeType: '八卦阵' })!;
    const view = split.othersView!;
    expect(view.card).toMatchObject({ name: '判定牌', suit: '♥', rank: '5' });
    expect(view.pendingCard).toBeUndefined();
  });

  // 与闪电对照：乐不思蜀被无懈可击抵消 → 弃置（移除），不传递给下家、不判定、不加跳过标签。
  // 延时锦囊默认无 onCancelled，钩子走「移除延时锦囊」分支；仅闪电声明 onCancelled 以传递。
  it('判定前打出无懈可击 → 乐不思蜀被抵消,移除不传递不判定', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // 若判定将生效（跳过出牌）
    const nullifCard = makeCard('wx1', '无懈可击', '♠', 'J');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['wx1'],
          skills: ['无懈可击', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['乐不思蜀', '回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card, j1: judgeCard, wx1: nullifCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await harness.player('P1').respond('无懈可击', { cardId: 'wx1' });
    await waitForStable(harness.state); // 反无懈窗口
    if (harness.state.pendingSlots.size > 0) {
      await fireTimeoutAndWait(harness.state); // 消耗反无懈窗口
    }

    // 乐不思蜀被抵消：从判定区移除（弃置），未判定、未加跳过标签
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    expect(harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌')).toBe(false);
    // 判定牌未被翻动（仍在牌堆）
    expect(harness.state.zones.deck).toContain('j1');
    // 无传递给 P1（默认行为是弃置，非闪电式传递）
    expect(harness.state.players[0].pendingTricks.length).toBe(0);
    // 无懈牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wx1');
  });
});
