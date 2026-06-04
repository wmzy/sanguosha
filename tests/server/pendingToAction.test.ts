import { describe, it, expect } from 'vitest';
import {
  pendingToAction,
  pendingToRespondAction,
  pendingToDiscardAction,
  pendingToSkillChoiceAction,
  pendingToSelectCardAction,
} from '../../server/protocol-adapter';
import type { PendingAction } from '../../engine/types';

const makePending = (type: PendingAction['type'], extra: Record<string, unknown> = {}): PendingAction => {
  const base = { id: 'p1', timeout: 10000, deadline: Date.now() + 10000, onTimeout: { type: 'endTurn', player: '刘备' } };
  switch (type) {
    case 'responseWindow':
      return { type: 'responseWindow', ...base, window: { type: 'killResponse', defender: '刘备', validCards: [], timeout: 10000, deadline: base.deadline }, ...extra } as PendingAction;
    case 'dyingWindow':
      return { type: 'dyingWindow', ...base, dyingPlayer: '刘备', currentSaverIndex: 0, savers: ['关羽'], ...extra } as PendingAction;
    case 'discardPhase':
      return { type: 'discardPhase', ...base, player: '刘备', min: 1, max: 3, ...extra } as PendingAction;
    case 'skillPrompt':
      return { type: 'skillPrompt', ...base, skillId: 'skill1', player: '刘备', execution: { phaseIndex: 0, ctx: { skillId: 'skill1', self: '刘备', localVars: {} }, plan: [] }, prompt: { text: '选择', options: [] }, ...extra } as PendingAction;
    case 'selectCard':
      return { type: 'selectCard', ...base, player: '刘备', target: '曹操', cardIds: ['c1', 'c2'], min: 1, max: 2, sourceCard: 'c0', mode: 'discard', ...extra } as PendingAction;
    default:
      return { type: 'playPhase', ...base, player: '刘备', ...extra } as PendingAction;
  }
};

describe('pendingToRespondAction', () => {
  it('将 string choice 转为 cardId', () => {
    const pending = makePending('responseWindow');
    const action = pendingToRespondAction(pending as any, '刘备', 'card-1');
    expect(action).toEqual({ type: 'respond', player: '刘备', cardId: 'card-1' });
  });

  it('非 string choice 时 cardId 为 undefined', () => {
    const pending = makePending('responseWindow');
    const action = pendingToRespondAction(pending as any, '刘备', null);
    expect(action).toEqual({ type: 'respond', player: '刘备', cardId: undefined });
  });
});

describe('pendingToDyingWindow (via pendingToAction)', () => {
  it('dyingWindow + string choice → respond with cardId', () => {
    const pending = makePending('dyingWindow');
    const action = pendingToAction(pending, '关羽', 'peach-1');
    expect(action).toEqual({ type: 'respond', player: '关羽', cardId: 'peach-1' });
  });
});

describe('pendingToDiscardAction', () => {
  it('将 string[] choice 转为 cardIds', () => {
    const pending = makePending('discardPhase');
    const action = pendingToDiscardAction(pending as any, '刘备', ['c1', 'c2']);
    expect(action).toEqual({ type: 'discard', player: '刘备', cardIds: ['c1', 'c2'] });
  });

  it('非 array choice 时 cardIds 为空数组', () => {
    const pending = makePending('discardPhase');
    const action = pendingToDiscardAction(pending as any, '刘备', undefined);
    expect(action).toEqual({ type: 'discard', player: '刘备', cardIds: [] });
  });
});

describe('pendingToSkillChoiceAction', () => {
  it('将任意 choice 透传为 skillChoice', () => {
    const pending = makePending('skillPrompt');
    const action = pendingToSkillChoiceAction(pending as any, '刘备', { option: 0 });
    expect(action).toEqual({ type: 'skillChoice', player: '刘备', choice: { option: 0 } });
  });

  it('null choice 透传', () => {
    const pending = makePending('skillPrompt');
    const action = pendingToSkillChoiceAction(pending as any, '刘备', null);
    expect(action).toEqual({ type: 'skillChoice', player: '刘备', choice: null });
  });
});

describe('pendingToSelectCardAction', () => {
  it('将 string[] choice 转为 cardIds', () => {
    const pending = makePending('selectCard');
    const action = pendingToSelectCardAction(pending as any, '刘备', ['c1', 'c2']);
    expect(action).toEqual({ type: 'respond', player: '刘备', cardIds: ['c1', 'c2'] });
  });

  it('单张 string choice 包装为单元素数组', () => {
    const pending = makePending('selectCard');
    const action = pendingToSelectCardAction(pending as any, '刘备', 'c1');
    expect(action).toEqual({ type: 'respond', player: '刘备', cardIds: ['c1'] });
  });

  it('非 string/array choice 时 cardIds 为空数组', () => {
    const pending = makePending('selectCard');
    const action = pendingToSelectCardAction(pending as any, '刘备', 42);
    expect(action).toEqual({ type: 'respond', player: '刘备', cardIds: [] });
  });
});

describe('pendingToAction (统一入口)', () => {
  it('responseWindow 路由到 respond action', () => {
    const pending = makePending('responseWindow');
    const action = pendingToAction(pending, '刘备', 'slash-1');
    expect(action?.type).toBe('respond');
  });

  it('未知 pending 类型返回 null (playPhase)', () => {
    const pending = makePending('playPhase');
    const action = pendingToAction(pending, '刘备', undefined);
    expect(action).toBeNull();
  });

  it('harvestSelection 返回 null', () => {
    const pending: PendingAction = {
      type: 'harvestSelection',
      id: 'p1',
      revealedCards: ['c1', 'c2'],
      currentPickerIndex: 0,
      pickOrder: ['刘备'],
      player: '刘备',
      timeout: 30000,
      deadline: Date.now() + 30000,
      onTimeout: { type: 'endTurn', player: '刘备' },
    };
    expect(pendingToAction(pending, '刘备', 'c1')).toBeNull();
  });
});
