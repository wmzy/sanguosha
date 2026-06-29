// 回归:回合管理 end/start 的 validate 拒绝非法时机(防止 pending 堆积死锁)
// 根因:弃牌阶段创建弃牌 pending 后 end execute 挂起,若再次 end 能通过 validate,
// 会 pause 旧 slot 跑新 execute 再建弃牌 pending,choiceQueue 堆积死锁。
// 修复:end/start 的 validate 基于游戏状态(自己回合 + 出牌/弃牌阶段 + 无 pending)正向判断合法性。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  dispatch as engineDispatch,
  registerSkillsFromState,
  resetForTest,
} from '../../src/engine/create-engine';
import { findActionEntry } from '../../src/engine/skill';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function buildState(overrides: Partial<GameState> = {}): GameState {
  const cards: Card[] = [];
  const hand: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = `c${i}`;
    cards.push({ id, name: '杀', suit: '♣', color: '黑', rank: '7', type: '基本牌' });
    hand.push(id);
  }
  const cardMap: Record<string, Card> = {};
  for (const c of cards) cardMap[c.id] = c;
  return createGameState({
    players: [
      {
        index: 0,
        name: 'P0',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand,
        equipment: {},
        skills: ['回合管理'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
      {
        index: 1,
        name: 'P1',
        character: '关羽',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: ['回合管理'],
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
    ],
    cardMap,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    ...overrides,
  });
}

const tick = () => new Promise((r) => setTimeout(r, 100));

describe('回合管理 validate 正向判断合法性', () => {
  let state: GameState;
  beforeEach(async () => {
    resetForTest();
    state = buildState();
    await registerSkillsFromState(state);
  });

  it('end:自己出牌阶段无 pending 时合法', () => {
    const entry = findActionEntry(state, '回合管理', 0, 'end')!;
    expect(entry.validate(state, {})).toBeNull();
  });

  it('end:弃牌 pending 存在时拒绝(防止重复 end 死锁)', () => {
    // 模拟弃牌 pending 挂起
    state.pendingSlots.set(0, {
      atom: {
        type: '请求回应',
        requestType: '__弃牌',
        target: 0,
        prompt: {
          type: 'useCard',
          title: '弃牌',
          cardFilter: { filter: () => true, min: 2, max: 2 },
        },
        timeout: 30,
      },
      resolve: () => {},
      pause: () => {},
      _fireTimeoutNow: undefined,
      deadline: 99,
      isTimeout: false,
      isBlocking: true,
    } as any);
    const entry = findActionEntry(state, '回合管理', 0, 'end')!;
    expect(entry.validate(state, {})).not.toBeNull();
  });

  it('end:非自己回合时拒绝', () => {
    state.currentPlayerIndex = 1;
    const entry = findActionEntry(state, '回合管理', 0, 'end')!;
    expect(entry.validate(state, {})).not.toBeNull();
  });

  it('end:非出牌/弃牌阶段时拒绝', () => {
    state.phase = '摸牌';
    const entry = findActionEntry(state, '回合管理', 0, 'end')!;
    expect(entry.validate(state, {})).not.toBeNull();
  });

  it('start:主公位、准备阶段、无 pending 时合法', () => {
    state.phase = '准备';
    const entry = findActionEntry(state, '回合管理', 0, 'start')!;
    expect(entry.validate(state, {})).toBeNull();
  });

  it('start:非主公位拒绝', () => {
    state.phase = '准备';
    const entry = findActionEntry(state, '回合管理', 1, 'start')!;
    expect(entry.validate(state, {})).not.toBeNull();
  });
});

describe('端到端:弃牌阶段重复 end 不死锁', () => {
  it('第一次 end 进入弃牌 pending; 第二次 end 被 validate 拒绝,不产生新 pending', async () => {
    resetForTest();
    const state = buildState();
    await registerSkillsFromState(state);

    engineDispatch(state, {
      skillId: '回合管理',
      actionType: 'end',
      ownerId: 0,
      params: {},
      baseSeq: state.seq,
    });
    await tick();

    // 弃牌 pending 已创建
    expect(state.pendingSlots.size).toBe(1);
    const slot = state.pendingSlots.get(0)!;
    expect((slot.atom as { requestType?: string }).requestType).toBe('__弃牌');

    // 第二次 end:validate 拒绝
    engineDispatch(state, {
      skillId: '回合管理',
      actionType: 'end',
      ownerId: 0,
      params: {},
      baseSeq: state.seq,
    });
    await tick();

    // 仍只有 1 个弃牌 pending
    expect(state.pendingSlots.size).toBe(1);
    expect((state.pendingSlots.get(0)!.atom as { requestType?: string }).requestType).toBe(
      '__弃牌',
    );
  });

  it('弃牌 pending 期间 respond 正常工作(不被误拒)', async () => {
    resetForTest();
    const state = buildState();
    await registerSkillsFromState(state);

    engineDispatch(state, {
      skillId: '回合管理',
      actionType: 'end',
      ownerId: 0,
      params: {},
      baseSeq: state.seq,
    });
    await tick();
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    engineDispatch(state, {
      skillId: '系统规则',
      actionType: 'respond',
      ownerId: 0,
      params: { cardIds: ['c0', 'c1'] },
      baseSeq: state.seq,
    });
    await tick();

    expect(state.players[0].hand).not.toContain('c0');
    expect(state.players[0].hand).not.toContain('c1');
    expect(state.players[0].hand.length).toBe(4);
  });
});
