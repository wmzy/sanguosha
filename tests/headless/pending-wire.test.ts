import { describe, expect, it } from 'vitest';
import { applyServerMessage } from '../../src/client/headless/viewMaintainer';
import { eventsForViewer } from '../../src/engine/view/events-for-viewer';
import { createGameState, type GameView } from '../../src/engine/types';

function view(): GameView {
  return { viewer: 0, currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    players: [{ index: 0, name: 'P0', character: '刘备', health: 4, maxHealth: 4, alive: true, equipment: {}, skills: [], handCount: 0, marks: [] }],
    cardMap: {}, pending: null, deadline: null, deadlineTotalMs: 0, log: [], settlementStack: [] };
}

describe('pending wire boundary', () => {
  it('applies JSON pending metadata without creating playback events and explicitly clears null', () => {
    const baseline = view();
    const first = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const pending = { type: 'awaits' as const, atom: { type: '请求回应', target: 0, requestType: 'x' } as any,
      prompt: { type: 'confirm' as const, title: 'x' }, target: 0, isBlocking: true,
      mandatory: true, responseMode: 'normal' as const, deadline: 2000, totalMs: 1000 };
    const shown = applyServerMessage(first.view, 0, JSON.parse(JSON.stringify({ type: 'event', seq: 1, timestamp: 1, pending })));
    expect(shown.view?.pending).toMatchObject({ mandatory: true, totalMs: 1000 });
    expect(shown.newEvents).toEqual([]);
    const cleared = applyServerMessage(shown.view, 1, { type: 'event', seq: 2, timestamp: 2, pending: null });
    expect(cleared.view?.pending).toBeNull();
    expect(cleared.view?.deadline).toBeNull();
  });

  it('emits pending metadata for an observer even when atom view is private/hidden', () => {
    const state = createGameState({ players: [0, 1].map((index) => ({ index, name: `P${index}`, character: '', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, pendingTricks: [], skills: [], vars: {}, marks: [], tags: [] })), cardMap: {} });
    const entry = { kind: 'notify' as const, seq: 1, timestamp: 0, skillId: '', eventType: 'pendingChanged', data: {}, views: new Map(), pendingViews: { '1': null } };
    state.atomHistory.push(entry);
    const wire = eventsForViewer(state, 1);
    expect(wire).toHaveLength(1);
    expect(wire[0].pending).toBeNull();
    expect(wire[0].view).toBeUndefined();
    expect(JSON.stringify(wire[0])).not.toContain('秘密');
  });
});
