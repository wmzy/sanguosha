import { describe, expect, it } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function card(id: string, name: string, type: Card['type'] = '基本牌'): Card {
  return { id, name, type, suit: '♠', color: '黑', rank: '7' };
}

function player(index: number, name: string, skill: string, hand: string[] = []): GameState['players'][number] {
  return {
    index, name, character: name, faction: '群', health: 3, maxHealth: 3, alive: true,
    hand, equipment: {}, skills: skill ? [skill] : [], vars: {}, marks: [], pendingTricks: [], tags: [], judgeZone: [],
  };
}

describe.each(['蛊惑', '界蛊惑'])('%s ordinary card declarations', (skill) => {
  it('uses an ordinary trick through CardEffect and keeps the discarded physical id out of public events', async () => {
    const harness = new SkillTestHarness();
    await harness.setup(createGameState({
      players: [
        player(0, skill === '蛊惑' ? '于吉' : '界于吉', skill, ['physical-card']),
        player(1, 'P1', ''),
        player(2, 'P2', ''),
      ],
      cardMap: {
        'physical-card': card('physical-card', '闪'),
        deck1: card('deck1', '杀'), deck2: card('deck2', '桃'),
      },
      zones: { deck: ['deck1', 'deck2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    }));

    await harness.player(0).triggerAction(skill, 'use:无中生有', { cardId: 'physical-card' });
    await harness.player(2).respond(skill, { choice: false });
    await harness.player(1).respond(skill, { choice: false });
    await harness.player(2).pass();
    await harness.player(1).pass();
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toHaveLength(2);
    expect(harness.state.zones.discardPile).toContain('physical-card');
    const publicEvents = JSON.stringify(harness.state.atomHistory
      .filter((entry) => entry.kind === 'atom')
      .map((entry) => entry.viewEvents.othersView));
    expect(publicEvents).not.toContain('physical-card');
    expect(publicEvents).not.toContain('#蛊惑');
    expect(publicEvents).not.toContain('#界蛊惑');
  });

  it('declared ordinary trick exposes the normal response action for virtual nullification', async () => {
    const harness = new SkillTestHarness();
    await harness.setup(createGameState({
      players: [
        player(0, skill === '蛊惑' ? '于吉' : '界于吉', skill, ['yuji-card']),
        player(1, 'P1', skill, ['response-card']),
        player(2, 'P2', ''),
      ],
      cardMap: {
        'yuji-card': card('yuji-card', '杀'),
        'response-card': card('response-card', '桃'),
        deck1: card('deck1', '杀'), deck2: card('deck2', '闪'),
      },
      zones: { deck: ['deck1', 'deck2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    }));

    await harness.player(0).triggerAction(skill, 'use:无中生有', { cardId: 'yuji-card' });
    await harness.player(2).respond(skill, { choice: false });
    await harness.player(1).respond(skill, { choice: false });
    await harness.player(1).triggerAction(skill, 'respondWuxie', { cardId: 'response-card' });
    await harness.player(0).respond(skill, { choice: false });
    await harness.player(2).respond(skill, { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[0].hand).toHaveLength(0);
    expect(harness.state.players[1].hand).toHaveLength(0);
    expect(harness.state.zones.deck).toEqual(['deck1', 'deck2']);
    expect(harness.state.zones.discardPile).toContain('yuji-card');
    expect(harness.state.zones.discardPile).toContain('response-card');
    const publicEvents = JSON.stringify(harness.state.atomHistory
      .filter((entry) => entry.kind === 'atom')
      .map((entry) => entry.viewEvents.othersView));
    expect(publicEvents).not.toContain('yuji-card');
    expect(publicEvents).not.toContain('response-card');
  });
});
