// LEGACY TEST: references deleted v2 modules - skipped
import { describe, it, expect } from 'vitest';
// import {
//   pendingToAction,
//   pendingToRespondAction,
//   pendingToDiscardAction,
//   pendingToSkillChoiceAction,
//   pendingToSelectCardAction,
// } from '../../src/server/protocol-adapter';
// // LEGACY: removed (v2 module deleted)
import type { PendingAction } from '../../src/engine/types';

const makePending = (type: PendingAction['type'], extra: Record<string, unknown> = {}): PendingAction => {
  const base = { id: 'p1', timeout: 10000, deadline: Date.now() + 10000, onTimeout: { type: '结束回合', player: '刘备' } };
  switch (type) {
    case '响应窗口':
      return { type: '响应窗口', ...base, window: { type: 'killResponse', defender: '刘备', validCards: [], timeout: 10000, deadline: base.deadline }, ...extra } as PendingAction;
    case '濒死窗口':
      return { type: '濒死窗口', ...base, dyingPlayer: '刘备', currentSaverIndex: 0, savers: ['关羽'], ...extra } as PendingAction;
    case '弃牌阶段':
      return { type: '弃牌阶段', ...base, player: '刘备', min: 1, max: 3, ...extra } as PendingAction;
    case '技能选择':
      return { type: '技能选择', ...base, skillId: 'skill1', player: '刘备', execution: { phaseIndex: 0, ctx: { skillId: 'skill1', self: '刘备', localVars: {} }, plan: [] }, prompt: { text: '选择', options: [] }, ...extra } as PendingAction;
    case '选择牌':
      return { type: '选择牌', ...base, player: '刘备', target: '曹操', cardIds: ['c1', 'c2'], min: 1, max: 2, sourceCard: 'c0', mode: '弃置', ...extra } as PendingAction;
    default:
      return { type: '出牌阶段', ...base, player: '刘备', ...extra } as PendingAction;
  }
};

describe.skip('pendingToRespondAction', () => {
  it('将 string choice 转为 cardId', () => {
    const pending = makePending('响应窗口');
    const action = pendingToRespondAction(pending as any, '刘备', 'card-1');
    expect(action).toEqual({ type: '打出', player: '刘备', cardId: 'card-1' });
  });

  it('非 string choice 时 cardId 为 undefined', () => {
    const pending = makePending('响应窗口');
    const action = pendingToRespondAction(pending as any, '刘备', null);
    expect(action).toEqual({ type: '打出', player: '刘备', cardId: undefined });
  });
});

describe.skip('pendingToDyingWindow (via pendingToAction)', () => {
  it('dyingWindow + string choice → respond with cardId', () => {
    const pending = makePending('濒死窗口');
    const action = pendingToAction(pending, '关羽', 'peach-1');
    expect(action).toEqual({ type: '打出', player: '关羽', cardId: 'peach-1' });
  });
});

describe.skip('pendingToDiscardAction', () => {
  it('将 string[] choice 转为 cardIds', () => {
    const pending = makePending('弃牌阶段');
    const action = pendingToDiscardAction(pending as any, '刘备', ['c1', 'c2']);
    expect(action).toEqual({ type: '弃置', player: '刘备', cardIds: ['c1', 'c2'] });
  });

  it('非 array choice 时 cardIds 为空数组', () => {
    const pending = makePending('弃牌阶段');
    const action = pendingToDiscardAction(pending as any, '刘备', undefined);
    expect(action).toEqual({ type: '弃置', player: '刘备', cardIds: [] });
  });
});

describe.skip('pendingToSkillChoiceAction', () => {
  it('将任意 choice 透传为 skillChoice', () => {
    const pending = makePending('技能选择');
    const action = pendingToSkillChoiceAction(pending as any, '刘备', { option: 0 });
    expect(action).toEqual({ type: '技能选择', player: '刘备', choice: { option: 0 } });
  });

  it('null choice 透传', () => {
    const pending = makePending('技能选择');
    const action = pendingToSkillChoiceAction(pending as any, '刘备', null);
    expect(action).toEqual({ type: '技能选择', player: '刘备', choice: null });
  });
});

describe.skip('pendingToSelectCardAction', () => {
  it('将 string[] choice 转为 cardIds', () => {
    const pending = makePending('选择牌');
    const action = pendingToSelectCardAction(pending as any, '刘备', ['c1', 'c2']);
    expect(action).toEqual({ type: '打出', player: '刘备', cardIds: ['c1', 'c2'] });
  });

  it('单张 string choice 包装为单元素数组', () => {
    const pending = makePending('选择牌');
    const action = pendingToSelectCardAction(pending as any, '刘备', 'c1');
    expect(action).toEqual({ type: '打出', player: '刘备', cardIds: ['c1'] });
  });

  it('非 string/array choice 时 cardIds 为空数组', () => {
    const pending = makePending('选择牌');
    const action = pendingToSelectCardAction(pending as any, '刘备', 42);
    expect(action).toEqual({ type: '打出', player: '刘备', cardIds: [] });
  });
});

describe.skip('pendingToAction (统一入口)', () => {
  it('responseWindow 路由到 respond action', () => {
    const pending = makePending('响应窗口');
    const action = pendingToAction(pending, '刘备', 'slash-1');
    expect(action?.type).toBe('打出');
  });

  it('未知 pending 类型返回 null (playPhase)', () => {
    const pending = makePending('出牌阶段');
    const action = pendingToAction(pending, '刘备', undefined);
    expect(action).toBeNull();
  });

  it('harvestSelection 返回 null', () => {
    const pending: PendingAction = {
      type: '收获选牌',
      id: 'p1',
      revealedCards: ['c1', 'c2'],
      currentPickerIndex: 0,
      pickOrder: ['刘备'],
      player: '刘备',
      timeout: 30000,
      deadline: Date.now() + 30000,
      onTimeout: { type: '结束回合', player: '刘备' },
    };
    expect(pendingToAction(pending, '刘备', 'c1')).toBeNull();
  });
});
