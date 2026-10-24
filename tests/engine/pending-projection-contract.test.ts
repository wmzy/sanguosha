import { describe, expect, it } from 'vitest';
import { applyAtom } from '../../src/engine/core/apply';
import { fireTimeout, buildView } from '../../src/engine/index';
import { eventsForViewer } from '../../src/engine/view/events-for-viewer';
import { getPendingDeadline } from '../../src/engine/view/buildView';
import { applyServerMessage } from '../../src/client/headless/viewMaintainer';
import { SHORT_DELAY_MS } from '../../src/engine/core/card-response-availability';
import { createGameState, type ActionPrompt, type GameState, type GameView } from '../../src/engine/types';
import { assertViewConsistency, SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function makeState(): GameState {
  return createGameState({
    players: [0, 1, 2].map((index) => ({
      index, name: `P${index}`, character: '', health: 4, maxHealth: 4, alive: index !== 2,
      hand: index === 0 ? ['red', 'black'] : index === 1 ? ['dodge'] : [], equipment: {},
      pendingTricks: [], skills: [], vars: {}, marks: [], tags: [],
    })),
    cardMap: {
      red: { id: 'red', name: '杀', suit: '♥', color: '红', rank: '5', type: '基本牌' },
      black: { id: 'black', name: '杀', suit: '♠', color: '黑', rank: '6', type: '基本牌' },
      dodge: { id: 'dodge', name: '闪', suit: '♦', color: '红', rank: '7', type: '基本牌' },
    },
  });
}

function client(state: GameState, viewer: number) {
  let view = json(buildView(state, viewer));
  let seq = state.seq;
  return {
    get view() { return view; },
    flush() {
      for (const envelope of eventsForViewer(state, viewer, seq)) {
        const result = applyServerMessage(view, seq, json({ type: 'event' as const, ...envelope }));
        view = result.view!;
        seq = result.lastSeq;
      }
      assertViewConsistency(view, state, viewer);
      return view;
    },
  };
}

async function closePending(state: GameState): Promise<void> {
  for (const slot of state.pendingSlots.values()) slot.pause();
  for (const slot of state.pendingSlots.values()) slot.resolve();
  state.pendingSlots.clear();
  await Promise.resolve();
}

describe('pending: production JSON/reconnect contract', () => {
  it('mandatory, blocking, candidates and actual timeout survive production reducer and reconnect', async () => {
    const state = makeState();
    state.config = { timeoutSec: 7 };
    const owner = client(state, 0);
    const observer = client(state, 1);
    const waiting = applyAtom(state, {
      type: '请求回应', requestType: '测试/弃置', target: 0, mandatory: true, timeout: 20,
      prompt: { type: 'useCard', title: '弃置红牌', cardFilter: { min: 1, max: 1, filter: (card) => card.color === '红' } },
    });
    try {
      await waitForStable(state);
      const pending = owner.flush().pending!;
      expect(pending).toMatchObject({ mandatory: true, isBlocking: true, responseMode: 'normal', totalMs: 7000 });
      expect(pending.prompt).toMatchObject({ cardFilter: { candidates: ['red'], min: 1, max: 1 } });
      expect(json(buildView(state, 0)).pending).toEqual(pending);
      expect(getPendingDeadline(state, 0)).toEqual({ target: 0, deadline: pending.deadline, totalMs: 7000 });
      const observed = observer.flush().pending!;
      expect(observed.prompt.type).toBe('confirm');
      expect(observed.atom).not.toHaveProperty('prompt');
      expect(JSON.stringify(observed)).not.toContain('red');
      await fireTimeout(state);
      await waiting;
      expect(owner.flush().pending).toBeNull();
      expect(observer.flush().pending).toBeNull();
    } finally { await closePending(state); }
  });

  it('silent mode uses the actual short timer in snapshots and JSON events', async () => {
    const state = makeState();
    state.config = { timeoutSec: 9 };
    const owner = client(state, 0);
    const waiting = applyAtom(state, { type: '询问闪', target: 0, source: 1 });
    try {
      await waitForStable(state);
      const pending = owner.flush().pending!;
      expect(pending.responseMode).toBe('silent');
      expect(pending.totalMs).toBe(SHORT_DELAY_MS);
      expect(getPendingDeadline(state, 0)?.totalMs).toBe(SHORT_DELAY_MS);
      expect(json(buildView(state, 0)).pending).toEqual(pending);
    } finally { await closePending(state); await waiting; }
  });

  it('paused owner falls back to broadcast; only alive participants receive private candidates', async () => {
    const state = makeState();
    const clients = [-1, 0, 1, 2].map((viewer) => client(state, viewer));
    const play = applyAtom(state, { type: '出牌窗口', player: 0, timeout: 20 });
    try {
      await waitForStable(state);
      clients.forEach((entry) => entry.flush());
      state.pendingSlots.get(0)!.pause();
      const broadcast = applyAtom(state, {
        type: '请求回应', target: -2, requestType: '无懈可击', timeout: 10,
        prompt: { type: 'useCard', title: '回应', cardFilter: { min: 1, max: 1, filter: (card) => card.color === '红' } },
      });
      await waitForStable(state);
      const views = clients.map((entry) => entry.flush());
      expect(views[0].pending).toBeNull();
      expect(views[3].pending).toBeNull();
      expect(views[1].pending?.target).toBe(-2);
      expect(views[1].pending?.prompt).toMatchObject({ cardFilter: { candidates: ['red'] } });
      expect(views[2].pending?.prompt).toMatchObject({ cardFilter: { candidates: ['dodge'] } });
      expect(getPendingDeadline(state, 0)).toEqual({ target: -2, deadline: views[1].pending?.deadline, totalMs: 10000 });
      expect(getPendingDeadline(state, -1)).toBeNull();
      expect(getPendingDeadline(state, 2)).toBeNull();
      await closePending(state);
      await broadcast;
    } finally { await closePending(state); await play; }
  });

  it('parallel character JSON envelopes contain only each owners private candidates', async () => {
    const state = makeState();
    state.players[2].alive = true;
    const clients = [-1, 0, 1, 2].map((viewer) => client(state, viewer));
    const waiting = applyAtom(state, {
      type: '并行选将', selections: [
        { target: 1, candidates: [{ name: '秘密甲', skills: ['甲技'] }] },
        { target: 2, candidates: [{ name: '秘密乙', skills: ['乙技'] }] },
      ],
    });
    try {
      await waitForStable(state);
      const ownWire = JSON.stringify(eventsForViewer(state, 1));
      expect(ownWire).toContain('秘密甲');
      expect(ownWire).not.toContain('秘密乙');
      expect(JSON.stringify(eventsForViewer(state, 0))).not.toContain('秘密');
      expect(JSON.stringify(eventsForViewer(state, -1))).not.toContain('秘密');
      const views = clients.map((entry) => entry.flush());
      expect(views[0].pending).toBeNull();
      expect(views[1].pending).toBeNull();
      expect(views[2].pending?.prompt).toMatchObject({ candidates: [{ name: '秘密甲', skills: ['甲技'] }] });
      expect(views[3].pending?.prompt).toMatchObject({ candidates: [{ name: '秘密乙', skills: ['乙技'] }] });
    } finally { await closePending(state); await waiting; }
  });

  it('harness uses JSON and catches actionable pending drift including broadcast participants', async () => {
    const state = makeState();
    const harness = new SkillTestHarness();
    await harness.setup(state);
    const waiting = applyAtom(state, { type: '请求回应', target: -2, requestType: '测试', mandatory: true,
      prompt: { type: 'choosePlayer', title: '选择角色', min: 1, max: 1, candidates: [0, 1] } });
    try {
      await waitForStable(state);
      harness.processAllEvents();
      const view = harness.player(1).processedView;
      expect(view.pending?.mandatory).toBe(true);
      expect(() => assertViewConsistency({ ...view, pending: { ...view.pending!, mandatory: false } }, state, 1)).toThrow('mandatory');
      const wrong = json(view) as GameView;
      wrong.pending!.prompt = { ...wrong.pending!.prompt, candidates: [] } as ActionPrompt;
      expect(() => assertViewConsistency(wrong, state, 1)).toThrow('candidates');
    } finally { await closePending(state); await waiting; }
  });
});
