import { describe, it, expect } from 'vitest';
import { isValidAction, getAvailableActions } from './actions';
import { makeView } from './helpers';
import type { CardInfo } from '@engine/view/types';
import type { PendingAction } from '@engine/types';

function card(id: string, name: string, type?: string): CardInfo {
  return { id, name, type: (type ?? '基本牌') as CardInfo['type'], subtype: name as CardInfo['subtype'], suit: '♠', rank: 'A', description: '' };
}

// ─── isValidAction ─────────────────────────────────────────

describe('isValidAction', () => {
  it('出牌阶段出杀有效', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '杀')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
      turn: { phase: '出牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const result = isValidAction(view, { type: 'playCard', player: 'P1', cardId: 'c1', target: 'P2' });
    expect(result).toEqual({ valid: true });
  });

  it('出不在手牌中的牌无效', () => {
    const view = makeView({
      self: {
        hand: [],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
      turn: { phase: '出牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const result = isValidAction(view, { type: 'playCard', player: 'P1', cardId: 'c99', target: 'P2' });
    expect(result).toEqual({ valid: false, reason: '手牌中没有此牌' });
  });

  it('非出牌阶段出杀无效', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '杀')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
      turn: { phase: '弃牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const result = isValidAction(view, { type: 'playCard', player: 'P1', cardId: 'c1', target: 'P2' });
    expect(result).toEqual({ valid: false, reason: '当前不是出牌阶段' });
  });

  it('响应窗口出闪有效', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '闪')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const result = isValidAction(view, { type: 'respond', player: 'P1', cardId: 'c1' });
    expect(result).toEqual({ valid: true });
  });

  it('响应时出不在手牌中的牌无效', () => {
    const view = makeView({
      self: {
        hand: [],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const result = isValidAction(view, { type: 'respond', player: 'P1', cardId: 'c1' });
    expect(result).toEqual({ valid: false, reason: '手牌中没有此牌' });
  });

  it('满血出桃无效', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '桃')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const result = isValidAction(view, { type: 'playCard', player: 'P1', cardId: 'c1', target: 'P1' });
    expect(result).toEqual({ valid: false, reason: '体力已满' });
  });

  it('受伤时出桃有效', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '桃')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 2, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const result = isValidAction(view, { type: 'playCard', player: 'P1', cardId: 'c1', target: 'P1' });
    expect(result).toEqual({ valid: true });
  });

  it('出牌阶段结束回合有效', () => {
    const view = makeView({
      turn: { phase: '出牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const result = isValidAction(view, { type: 'endTurn', player: 'P1' });
    expect(result).toEqual({ valid: true });
  });

  it('非出牌阶段结束回合无效', () => {
    const view = makeView({
      turn: { phase: '弃牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const result = isValidAction(view, { type: 'endTurn', player: 'P1' });
    expect(result).toEqual({ valid: false, reason: '当前不是出牌阶段' });
  });

  it('手中有桃时响应濒死有效', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '桃')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const result = isValidAction(view, { type: 'respond', player: 'P1', cardId: 'c1' });
    expect(result).toEqual({ valid: true });
  });

  it('使用技能始终有效（服务端决定）', () => {
    const view = makeView();
    const result = isValidAction(view, { type: 'useSkill', player: 'P1', skillId: '青囊', target: 'P1' });
    expect(result).toEqual({ valid: true });
  });

  it('弃牌中包含不在手牌的卡牌无效', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '杀')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const result = isValidAction(view, { type: 'discard', player: 'P1', cardIds: ['c1', 'c99'] });
    expect(result).toEqual({ valid: false, reason: '弃牌中包含不在手牌的卡牌' });
  });

  it('弃手牌中的牌有效', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '杀'), card('c2', '闪')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const result = isValidAction(view, { type: 'discard', player: 'P1', cardIds: ['c1', 'c2'] });
    expect(result).toEqual({ valid: true });
  });

  it('出过河拆桥需要目标', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '过河拆桥', '锦囊牌')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
      turn: { phase: '出牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const noTarget = isValidAction(view, { type: 'playCard', player: 'P1', cardId: 'c1' });
    expect(noTarget).toEqual({ valid: false, reason: '需要指定目标' });

    const withTarget = isValidAction(view, { type: 'playCard', player: 'P1', cardId: 'c1', target: 'P2' });
    expect(withTarget).toEqual({ valid: true });
  });

  it('闪不能主动使用', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '闪')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
      turn: { phase: '出牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const result = isValidAction(view, { type: 'playCard', player: 'P1', cardId: 'c1', target: 'P2' });
    expect(result).toEqual({ valid: false, reason: '闪不能主动使用' });
  });
});

// ─── getAvailableActions ───────────────────────────────────

describe('getAvailableActions', () => {
  it('出牌阶段返回出牌动作', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '杀'), card('c2', '桃')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 2, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
      others: { P2: { handCount: 3, equipment: { weapon: null, armor: null, mount: null }, health: 4, maxHealth: 4, pendingTrickCount: 0, alive: true } },
      turn: { phase: '出牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const actions = getAvailableActions(view, null);
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(actions.some(a => a.sourceId === 'c1')).toBe(true);
    expect(actions.some(a => a.sourceId === 'c2')).toBe(true);
  });

  it('responseWindow 返回响应动作', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '闪'), card('c2', '杀')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const pending: PendingAction = {
      id: 'test-pending',
      type: 'responseWindow',
      window: { type: 'killResponse', defender: 'P1', validCards: ['c1'], timeout: 15000, deadline: Date.now() + 15000 },
      timeout: 15000,
      deadline: Date.now() + 15000,
      onTimeout: { type: 'respond', player: 'P1' },
    };
    const actions = getAvailableActions(view, pending);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('respond');
    expect(actions[0].validTargets).toEqual(['c1']);
  });

  it('discardPhase 返回弃牌动作', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '杀'), card('c2', '闪'), card('c3', '桃')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const pending: PendingAction = {
      id: 'test-pending',
      type: 'discardPhase',
      player: 'P1',
      min: 2,
      max: 2,
      timeout: 30000,
      deadline: Date.now() + 30000,
      onTimeout: { type: 'discard', player: 'P1', cardIds: ['c1', 'c2'] },
    };
    const actions = getAvailableActions(view, pending);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('discard');
    expect(actions[0].validTargets).toEqual(['c1', 'c2', 'c3']);
    expect(actions[0].required).toBe(true);
  });

  it('pending 为 null 且非出牌阶段返回空', () => {
    const view = makeView({
      turn: { phase: '弃牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const actions = getAvailableActions(view, null);
    expect(actions).toEqual([]);
  });

  it('dyingWindow 手中有桃返回响应动作', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '桃'), card('c2', '杀')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const pending: PendingAction = {
      id: 'test-pending',
      type: 'dyingWindow',
      dyingPlayer: 'P2',
      currentSaverIndex: 0,
      savers: ['P1'],
      timeout: 20000,
      deadline: Date.now() + 20000,
      onTimeout: { type: 'respond', player: 'P1' },
    };
    const actions = getAvailableActions(view, pending);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('respond');
    expect(actions[0].validTargets).toEqual(['c1']);
  });

  it('dyingWindow 手中无桃返回空', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '杀')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const pending: PendingAction = {
      id: 'test-pending',
      type: 'dyingWindow',
      dyingPlayer: 'P2',
      currentSaverIndex: 0,
      savers: ['P1'],
      timeout: 20000,
      deadline: Date.now() + 20000,
      onTimeout: { type: 'respond', player: 'P1' },
    };
    const actions = getAvailableActions(view, pending);
    expect(actions).toEqual([]);
  });

  it('锦囊无目标牌不需要 validTargets', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '无中生有', '锦囊牌')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
      turn: { phase: '出牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const actions = getAvailableActions(view, null);
    expect(actions).toHaveLength(1);
    expect(actions[0].validTargets).toEqual([]);
  });

  it('决斗 responseWindow 返回杀', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '杀'), card('c2', '闪')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
    });
    const pending: PendingAction = {
      id: 'test-pending',
      type: 'responseWindow',
      window: { type: 'duelResponse', defender: 'P1', validCards: ['c1'], timeout: 15000, deadline: Date.now() + 15000 },
      timeout: 15000,
      deadline: Date.now() + 15000,
      onTimeout: { type: 'respond', player: 'P1' },
    };
    const actions = getAvailableActions(view, pending);
    expect(actions).toHaveLength(1);
    expect(actions[0].validTargets).toEqual(['c1']);
  });

  it('装备牌不出现在需要目标的动作中', () => {
    const view = makeView({
      self: {
        hand: [card('c1', '诸葛连弩', '装备牌')],
        equipment: { weapon: null, armor: null, mount: null },
        health: 4, maxHealth: 4, pendingTricks: [], tags: [], vars: {}, alive: true,
      },
      turn: { phase: '出牌', currentPlayer: 'P1', killsPlayed: 0 },
    });
    const actions = getAvailableActions(view, null);
    expect(actions).toHaveLength(1);
    expect(actions[0].validTargets).toEqual([]);
  });
});
