import { describe, expect, it } from 'vitest';
import { buildAudienceView } from '../../src/engine/view/audience';
import { buildView } from '../../src/engine/view/buildView';
import { applyAtom } from '../../src/engine/core/apply';
import { createGameState, suitColor } from '../../src/engine/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';

function card(id: string, name: string): Card {
  return { id, name, suit: '♠', color: suitColor('♠'), rank: 'A', type: '基本牌' };
}

function player(index: number, options: Partial<PlayerState> = {}): PlayerState {
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

function makeState(players: PlayerState[], cardMap: Record<string, Card>): GameState {
  return createGameState({
    players,
    cardMap,
    zones: { deck: [], discardPile: [], processing: [] },
  });
}

describe('audience visibility', () => {
  it('keeps player views limited to their own hand', () => {
    const cards = { a: card('a', '杀'), b: card('b', '桃') };
    const state = makeState(
      [player(0, { hand: ['a'] }), player(1, { hand: ['b'] })],
      cards,
    );

    const first = buildView(state, 0);
    expect(first.players[0].hand?.map((c) => c.id)).toEqual(['a']);
    expect(first.players[1].hand).toBeUndefined();

    const second = buildView(state, 1);
    expect(second.players[1].hand?.map((c) => c.id)).toEqual(['b']);
    expect(second.players[0].hand).toBeUndefined();
  });

  it('shows every hand to the audience while hiding living non-lord identities', () => {
    const cards = { a: card('a', '杀'), b: card('b', '桃'), c: card('c', '闪') };
    const state = makeState(
      [
        player(0, { hand: ['a'], identity: '主公' }),
        player(1, { hand: ['b'], identity: '反贼' }),
        player(2, { hand: ['c'], identity: '忠臣', alive: false }),
      ],
      cards,
    );

    const view = buildAudienceView(state);
    expect(view.viewer).toBe(-1);
    expect(view.players.map((p) => p.hand?.map((c) => c.id))).toEqual([['a'], ['b'], ['c']]);
    expect(view.players[0].identity).toBe('主公');
    expect(view.players[1].identity).toBeUndefined();
    expect(view.players[1].identityHidden).toBe(true);
    expect(view.players[2].identity).toBe('忠臣');
    expect(view.players[2].identityHidden).toBe(false);
    expect(view.zones?.deckCount).toBe(0);
  });

  it('only exposes Guanxing observed cards in the acting player pending prompt', async () => {
    const cards = {
      buried: card('buried', '桃'),
      seen1: card('seen1', '杀'),
      seen2: card('seen2', '闪'),
    };
    const state = createGameState({
      players: [
        player(0, { skills: ['观星'] }),
        player(1),
      ],
      cardMap: cards,
      zones: { deck: ['buried', 'seen1', 'seen2'], discardPile: [], processing: [] },
    });
    const harness = new SkillTestHarness();
    await harness.setup(state);

    void applyAtom(state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    await harness.player('P0').respond('观星', { choice: true });
    await harness.waitForStable();

    const ownerPending = buildView(state, 0).pending;
    const otherPending = buildView(state, 1).pending;
    const audiencePending = buildAudienceView(state).pending;
    expect(ownerPending?.prompt.type).toBe('distribute');
    if (ownerPending?.prompt.type !== 'distribute') throw new Error('expected arrange prompt');
    expect(ownerPending.prompt.cardIds).toEqual(['seen1', 'seen2']);
    expect(JSON.stringify(otherPending)).not.toContain('seen1');
    expect(JSON.stringify(otherPending)).not.toContain('seen2');
    expect(JSON.stringify(audiencePending)).not.toContain('seen1');
    expect(JSON.stringify(audiencePending)).not.toContain('seen2');
  });
});
