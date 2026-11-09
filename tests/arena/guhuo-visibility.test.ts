import { beforeEach, describe, expect, it } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import { createGameState } from '../../src/engine/types';
import type { Card, PlayerState } from '../../src/engine/types';
import { buildView } from '../../src/engine/view/buildView';
import { eventsForViewer } from '../../src/engine/view/events-for-viewer';
import { createObservation } from '../../src/arena/observation';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import { clearRegistry } from '../../src/client/skillActionRegistry';
import '../../src/engine/atoms';

function player(index: number, skill: string): PlayerState {
  return { index, name: index === 0 ? '于吉' : `P${index}`, character: index === 0 ? '于吉' : `P${index}`,
    health: 3, maxHealth: 3, alive: true, hand: index === 0 ? ['secret-real-dodge'] : [],
    equipment: {}, pendingTricks: [], skills: index === 0 ? [skill] : [], vars: {}, marks: [], tags: [],
  };
}

describe('蛊惑 AI 质疑阶段', () => {
  beforeEach(() => clearRegistry());
  for (const skill of ['蛊惑', '界蛊惑']) {
    it(`${skill}: 质疑者能选择信或不信，但模型输入不含扣牌真实 ID`, async () => {
      const secret: Card = { id: 'secret-real-dodge', name: '闪', suit: '♠', color: '黑', rank: '8', type: '基本牌' };
      const state = createGameState({ players: [0, 1, 2].map((i) => player(i, skill)), cardMap: { [secret.id]: secret },
        phase: '出牌', currentPlayerIndex: 0, turn: { round: 1, phase: '出牌', vars: {} } });
      const harness = new SkillTestHarness();
      await harness.setup(state);
      await harness.player(0).triggerAction(skill, 'use:杀', { cardId: secret.id, target: 1 });
      const view = buildView(state, 2);
      const hgc = new HeadlessGameClient('http://localhost');
      Object.assign(hgc, { _view: view, _seatIndex: 2 });
      await hgc.loadSkillActions([skill], 0);
      const actions = hgc.getAvailableActions();
      const choices = actions.filter((a) => a.message.skillId === skill).map((a) => a.message.params.choice);
      expect(choices).toContain(true);
      expect(choices).toContain(false);
      const events = eventsForViewer(state, 2).flatMap((envelope) => envelope.view ? [envelope.view] : []);
      const observation = createObservation(view, state.seq, actions, [], events);
      expect(JSON.stringify(observation)).not.toContain(secret.id);
      expect(view.settlementStack.some((frame) => frame.params.cardId === secret.id)).toBe(false);
    });
  }
});
