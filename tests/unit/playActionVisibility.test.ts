import { describe, expect, it } from 'vitest';
import {
  canShowCancelSelectionButton,
  canShowEndTurnButton,
  isFreePlayWindow,
} from '../../src/client/utils/gameViewHelpers';

describe('isFreePlayWindow', () => {
  it('true only on own play phase without blocking pending', () => {
    expect(
      isFreePlayWindow({ isMyTurn: true, phase: '出牌', pending: { isBlocking: false } }),
    ).toBe(true);
    expect(isFreePlayWindow({ isMyTurn: true, phase: '出牌', pending: null })).toBe(true);
  });

  it('false when blocking pending (response / discard window)', () => {
    expect(
      isFreePlayWindow({ isMyTurn: true, phase: '出牌', pending: { isBlocking: true } }),
    ).toBe(false);
    expect(
      isFreePlayWindow({ isMyTurn: true, phase: '弃牌', pending: { isBlocking: true } }),
    ).toBe(false);
  });

  it('false when not own turn or not play phase', () => {
    expect(
      isFreePlayWindow({ isMyTurn: false, phase: '出牌', pending: { isBlocking: false } }),
    ).toBe(false);
    expect(
      isFreePlayWindow({ isMyTurn: true, phase: '弃牌', pending: null }),
    ).toBe(false);
    expect(
      isFreePlayWindow({ isMyTurn: true, phase: '摸牌', pending: null }),
    ).toBe(false);
  });
});

describe('canShowEndTurnButton', () => {
  it('matches free play window (align with availableActions)', () => {
    expect(
      canShowEndTurnButton({
        canOperate: true,
        isMyTurn: true,
        phase: '出牌',
        pending: { isBlocking: false },
      }),
    ).toBe(true);
    expect(
      canShowEndTurnButton({
        canOperate: true,
        isMyTurn: true,
        phase: '出牌',
        pending: { isBlocking: true },
      }),
    ).toBe(false);
    expect(
      canShowEndTurnButton({
        canOperate: true,
        isMyTurn: true,
        phase: '弃牌',
        pending: null,
      }),
    ).toBe(false);
    expect(
      canShowEndTurnButton({
        canOperate: false,
        isMyTurn: true,
        phase: '出牌',
        pending: null,
      }),
    ).toBe(false);
  });
});

describe('canShowCancelSelectionButton', () => {
  it('requires selected card and free play window', () => {
    expect(
      canShowCancelSelectionButton({
        selectedCardId: 'c1',
        isMyTurn: true,
        phase: '出牌',
        pending: { isBlocking: false },
      }),
    ).toBe(true);
    expect(
      canShowCancelSelectionButton({
        selectedCardId: null,
        isMyTurn: true,
        phase: '出牌',
        pending: { isBlocking: false },
      }),
    ).toBe(false);
    expect(
      canShowCancelSelectionButton({
        selectedCardId: 'c1',
        isMyTurn: true,
        phase: '出牌',
        pending: { isBlocking: true },
      }),
    ).toBe(false);
    expect(
      canShowCancelSelectionButton({
        selectedCardId: 'c1',
        isMyTurn: true,
        phase: '弃牌',
        pending: null,
      }),
    ).toBe(false);
  });
});
