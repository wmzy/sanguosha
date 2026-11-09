import { afterEach, describe, expect, it } from 'vitest';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import { resolveDecision } from '../../src/arena/decision';
import { createObservation } from '../../src/arena/observation';
import { buildView } from '../../src/engine/view/buildView';
import { createGameState, suitColor } from '../../src/engine/types';
import type { Card, GameState, PendingView, PlayerState } from '../../src/engine/types';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';

afterEach(() => clearRegistry());

function makeCard(id: string, name: string): Card {
  return { id, name, suit: '♠', color: suitColor('♠'), rank: 'A', type: '基本牌' };
}

function makePlayer(index: number, options: Partial<PlayerState> = {}): PlayerState {
  return {
    index,
    name: `P${index}`,
    character: `武将${index}`,
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [],
    equipment: {},
    pendingTricks: [],
    skills: [],
    vars: {},
    marks: [],
    tags: [],
    ...options,
  };
}

function makeState(skill: '仁德' | '制衡'): GameState {
  const cards = {
    hand1: makeCard('hand1', '杀'),
    hand2: makeCard('hand2', '桃'),
    opponent: makeCard('opponent', '闪'),
    weapon: { ...makeCard('weapon', '诸葛连弩'), type: '装备牌' as const, subtype: '武器' },
  };
  return createGameState({
    players: [
      makePlayer(0, { skills: [skill], hand: ['hand1', 'hand2'], equipment: skill === '制衡' ? { 武器: 'weapon' } : {} }),
      makePlayer(1, { hand: ['opponent'] }),
      makePlayer(2),
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

async function observeActions(state: GameState) {
  const hgc = new HeadlessGameClient('http://localhost');
  (hgc as unknown as { _seatIndex: number; _view: ReturnType<typeof buildView> | null })._seatIndex = 0;
  await hgc.loadSkillActions(state.players[0].skills, 0);
  const view = buildView(state, 0);
  (hgc as unknown as { _seatIndex: number; _view: ReturnType<typeof buildView> | null })._view = view;
  return { hgc, observation: createObservation(view, state.seq, hgc.getAvailableActions()) };
}

describe('arena distribute action defaults', () => {
  it('仁德 gets a legal default allocation and accepts an AI override', async () => {
    const state = makeState('仁德');
    const harness = new SkillTestHarness();
    await harness.setup(state);
    const { hgc, observation } = await observeActions(state);
    const active = hgc.getAvailableActions().find((action) => action.message.skillId === '仁德' && action.message.actionType === 'use');
    expect(active).toBeDefined();
    const menu = observation.actions.find((action) => action.message.skillId === '仁德' && action.message.actionType === 'use');
    expect(menu?.selection).toMatchObject({ mode: 'allocate', cardIds: ['hand1', 'hand2'], targets: [1, 2] });
    expect(menu?.message.params.allocation).toEqual([{ target: 1, cardIds: ['hand1'] }]);
    expect(menu?.message.params.targets).toBeUndefined();
    expect(menu?.selection?.cardIds).not.toContain('opponent');

    const message = resolveDecision(observation, {
      decisionId: observation.decisionId,
      actionId: menu!.actionId,
      params: { allocation: [{ target: 2, cardIds: ['hand2'] }] },
    });
    expect(message.params.allocation).toEqual([{ target: 2, cardIds: ['hand2'] }]);
    expect(await harness.player(0).tryDispatch({ skillId: message.skillId, actionType: message.actionType, params: message.params })).toBe(true);
  });

  it('制衡 gets only own hand/equipment candidates and accepts an overridden selection', async () => {
    const state = makeState('制衡');
    const harness = new SkillTestHarness();
    await harness.setup(state);
    const { observation } = await observeActions(state);
    const menu = observation.actions.find((action) => action.message.skillId === '制衡' && action.message.actionType === 'use');
    expect(menu?.selection).toMatchObject({ mode: 'select', cardIds: ['hand1', 'hand2', 'weapon'] });
    expect(menu?.message.params.cardIds).toEqual(['hand1']);
    expect(menu?.selection?.cardIds).not.toContain('opponent');

    const message = resolveDecision(observation, {
      decisionId: observation.decisionId,
      actionId: menu!.actionId,
      params: { cardIds: ['weapon'] },
    });
    expect(message.params.cardIds).toEqual(['weapon']);
    expect(await harness.player(0).tryDispatch({ skillId: message.skillId, actionType: message.actionType, params: message.params })).toBe(true);
  });

  it('遗计 uses the private two-card prompt and exposes a full legal default allocation', () => {
    const state = makeState('仁德');
    const view = buildView(state, 0);
    view.pending = {
      type: 'awaits',
      atom: {
        type: '请求回应',
        target: 0,
        requestType: '遗计/distribute',
        prompt: { type: 'distribute', title: '遗计分配', cardIds: ['hand1', 'hand2'], minPerTarget: 1, maxPerTarget: 2 },
      } as PendingView['atom'],
      prompt: { type: 'distribute', title: '遗计分配', cardIds: ['hand1', 'hand2'], minPerTarget: 1, maxPerTarget: 2 },
      target: 0,
      isBlocking: true,
    };
    const action = {
      description: '分配遗计牌',
      message: { skillId: '遗计', actionType: 'respond', ownerId: 0, params: { allocation: [] }, baseSeq: 0 },
      validTargets: [],
      category: 'distribute' as const,
    };
    const observation = createObservation(view, 4, [action]);
    const menu = observation.actions[0];
    expect(menu.selection).toMatchObject({
      mode: 'allocate', cardIds: ['hand1', 'hand2'], targets: [0, 1, 2], minTotal: 2, maxPerTarget: 2,
    });
    expect(menu.message.params.allocation).toEqual([{ target: 0, cardIds: ['hand1', 'hand2'] }]);
    const message = resolveDecision(observation, { actionId: menu.actionId });
    expect(message.params.allocation).toEqual([{ target: 0, cardIds: ['hand1', 'hand2'] }]);
  });
});
