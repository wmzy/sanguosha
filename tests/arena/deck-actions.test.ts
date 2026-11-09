import { describe, expect, it } from 'vitest';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import { applyAtom } from '../../src/engine/core/apply';
import { buildView } from '../../src/engine/view/buildView';
import { createGameState, suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';

function makeCard(id: string): Card {
  return { id, name: '杀', suit: '♠', color: suitColor('♠'), rank: 'A', type: '基本牌' };
}

function makePlayer(index: number, skills: string[] = []): PlayerState {
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
    skills,
    vars: {},
    marks: [],
    tags: [],
  };
}

const cases = [
  { skill: '观星', requestType: '观星/arrange', phase: '准备' as const, observed: ['d3', 'd4', 'd5'] },
  { skill: '界观星', requestType: '界观星/arrange', phase: '准备' as const, observed: ['d3', 'd4', 'd5'] },
  { skill: '界恂恂', requestType: '界恂恂/arrange', phase: '摸牌' as const, observed: ['d2', 'd3', 'd4', 'd5'] },
];

function makeState(skill: string): GameState {
  const ids = ['d1', 'd2', 'd3', 'd4', 'd5'];
  return createGameState({
    players: [makePlayer(0, [skill]), makePlayer(1), makePlayer(2)],
    cardMap: Object.fromEntries(ids.map((id) => [id, makeCard(id)])),
    zones: { deck: ids, discardPile: [], processing: [] },
  });
}

async function prepareArrangePending(harness: SkillTestHarness, skill: string, phase: '准备' | '摸牌') {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase });
  await harness.waitForStable();
  await harness.player(0).respond(skill, { choice: true });
  await harness.waitForStable();
}

describe('HeadlessGameClient deck arrange actions', () => {
  for (const testCase of cases) {
    it(`${testCase.requestType} produces an engine-accepted top/bottom action`, async () => {
      const state = makeState(testCase.skill);
      const harness = new SkillTestHarness();
      await harness.setup(state);
      await prepareArrangePending(harness, testCase.skill, testCase.phase);

      const owner = new HeadlessGameClient('http://localhost');
      (owner as unknown as { _seatIndex: number })._seatIndex = 0;
      (owner as unknown as { _view: ReturnType<typeof buildView> | null })._view = buildView(state, 0);
      const action = owner.getAvailableActions().find((candidate) => candidate.category === 'distribute');
      expect(action).toBeDefined();
      expect(action!.message.params).toHaveProperty('top');
      expect(action!.message.params).toHaveProperty('bottom');

      const top = action!.message.params.top as string[];
      const bottom = action!.message.params.bottom as string[];
      const requiredTop = testCase.skill === '界恂恂' ? Math.min(2, testCase.observed.length) : testCase.observed.length;
      expect(top).toEqual([...testCase.observed].reverse().slice(0, requiredTop));
      expect(top).toHaveLength(requiredTop);
      expect([...top, ...bottom].sort()).toEqual([...testCase.observed].sort());

      // AI may replace the suggested split/order; submit a different legal choice.
      action!.message.params = {
        top: testCase.observed.slice(-requiredTop),
        bottom: testCase.observed.slice(0, testCase.observed.length - requiredTop),
      };
      // Submit the overridden response through the real engine dispatcher.
      expect(await harness.player(0).tryDispatch({
        skillId: action!.message.skillId,
        actionType: action!.message.actionType,
        params: action!.message.params,
      })).toBe(true);
    });
  }

  it('does not offer the private arrange action to another seat', async () => {
    const state = makeState('界恂恂');
    const harness = new SkillTestHarness();
    await harness.setup(state);
    await prepareArrangePending(harness, '界恂恂', '摸牌');

    const other = new HeadlessGameClient('http://localhost');
    (other as unknown as { _seatIndex: number })._seatIndex = 1;
    (other as unknown as { _view: ReturnType<typeof buildView> | null })._view = buildView(state, 1);
    expect(other.getAvailableActions().some((action) => action.category === 'distribute')).toBe(false);
  });
});
