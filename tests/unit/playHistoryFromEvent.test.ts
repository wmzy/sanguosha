import { describe, expect, it } from 'vitest';
import { playHistoryMutationFromEvent } from '../../src/client/utils/playHistoryFromEvent';
import type { GameView, ViewEvent } from '../../src/engine/types';

function makeView(): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: '刘备',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
      {
        index: 1,
        name: '张角',
        character: '张角',
        health: 3,
        maxHealth: 3,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
    ],
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

describe('playHistoryMutationFromEvent', () => {
  it('打出 → 短标注「名出牌名」', () => {
    const m = playHistoryMutationFromEvent(
      {
        type: '打出',
        player: 1,
        cardId: 'c1',
        card: { name: '闪', suit: '♥', rank: '2' },
      } as ViewEvent,
      makeView(),
      1000,
    );
    expect(m?.kind).toBe('push');
    if (m?.kind !== 'push') return;
    expect(m.items[0].caption).toBe('张角出闪');
    expect(m.items[0].card.name).toBe('闪');
  });

  it('弃牌 → 短标注「名弃」', () => {
    const m = playHistoryMutationFromEvent(
      {
        type: '弃牌',
        player: 0,
        cardId: 'c2',
        card: { name: '杀', suit: '♠', rank: '7' },
      } as ViewEvent,
      makeView(),
      1000,
    );
    expect(m?.kind).toBe('push');
    if (m?.kind !== 'push') return;
    expect(m.items[0].caption).toBe('刘备弃');
  });

  it('指定目标 → 更新 cardId 标注为「源→目标」', () => {
    const m = playHistoryMutationFromEvent(
      {
        type: '指定目标',
        source: 0,
        target: 1,
        cardId: 'c3',
        cardName: '过河拆桥',
      } as ViewEvent,
      makeView(),
    );
    expect(m).toEqual({ kind: 'caption', cardId: 'c3', caption: '刘备→张角' });
  });
});
