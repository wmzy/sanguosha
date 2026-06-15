// tests/skill-tests/乐不思蜀.test.ts
// 验证乐不思蜀延时锦囊:对目标判定区放入 + 判定阶段判定 + 跳过出牌阶段
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌'): Card {
  return { id, name, suit, rank, type };
}

function makePlayer(opts: { index: number; name: string; hand?: string[]; skills?: string[]; pendingTricks?: Array<{ name: string; source: number; card: Card }> }) {
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
    await applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });

    // 红桃 → 仅移除延时锦囊,不加跳过出牌标签
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    const hasSkipTag = harness.state.players[1].marks.some(m => m.id === 'tag:乐不思蜀/跳过出牌');
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

    await applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });

    // 黑桃 → 移除延时锦囊 + 加跳过出牌标签
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    const hasSkipTag = harness.state.players[1].marks.some(m => m.id === 'tag:乐不思蜀/跳过出牌');
    expect(hasSkipTag).toBe(true);
  });

  it('判定后 + 出牌阶段开始 → cancel 出牌阶段,标签清除', async () => {
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

    // 阶段开始 判定 → 触发 判定 → 加跳过标签
    await applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    const hasSkipTagBefore = harness.state.players[1].marks.some(m => m.id === 'tag:乐不思蜀/跳过出牌');
    expect(hasSkipTagBefore).toBe(true);

    // 模拟进入出牌阶段(跳过摸牌/弃牌流程,直接发 阶段开始 出牌)
    await applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '出牌' });

    // 出牌阶段被 cancel:state.phase 应已推进到 弃牌(因内部触发了 阶段结束 出牌)
    expect(harness.state.phase).toBe('弃牌');
    // 标签应已清除
    const hasSkipTagAfter = harness.state.players[1].marks.some(m => m.id === 'tag:乐不思蜀/跳过出牌');
    expect(hasSkipTagAfter).toBe(false);
  });
});