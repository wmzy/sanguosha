import { describe, it, expect, beforeEach } from 'vitest';
import { eventsToAnimations } from './eventsToAnimations';
import { makePlayerEvent, resetEventCounter } from './helpers';

describe('eventsToAnimations', () => {
  const PID = 'P1';

  beforeEach(() => {
    resetEventCounter();
  });

  it('damage event → damagePopup animation', () => {
    const events = [makePlayerEvent('damage', { target: 'P2', amount: 2 })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'damagePopup', target: 'P2', amount: 2 },
    ]);
  });

  it('heal event → healGlow animation', () => {
    const events = [makePlayerEvent('heal', { target: 'P1', amount: 1 })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'healGlow', target: 'P1', amount: 1 },
    ]);
  });

  it('draw event → drawCards animation', () => {
    const events = [makePlayerEvent('draw', { player: 'P1', count: 2 })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'drawCards', player: 'P1', count: 2 },
    ]);
  });

  it('draw event for other player still produces drawCards', () => {
    const events = [makePlayerEvent('draw', { player: 'P2', count: 3 })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'drawCards', player: 'P2', count: 3 },
    ]);
  });

  it('discard event → discardCards animation', () => {
    const events = [makePlayerEvent('discard', { player: 'P1', cardIds: ['c1', 'c2'] })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'discardCards', player: 'P1', cardIds: ['c1', 'c2'] },
    ]);
  });

  it('gainCard event → cardMove animation with from/to', () => {
    const events = [makePlayerEvent('gainCard', { player: 'P1', cardId: 'c5', from: { zone: 'discardPile' } })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'cardMove', cardId: 'c5', from: { zone: 'discardPile' }, to: { zone: 'hand', player: 'P1' }, duration: 300 },
    ]);
  });

  it('gainCard event with card object instead of cardId', () => {
    const events = [makePlayerEvent('gainCard', { player: 'P2', card: { id: 'c9' } })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'cardMove', cardId: 'c9', from: { zone: 'discardPile' }, to: { zone: 'hand', player: 'P2' }, duration: 300 },
    ]);
  });

  it('equip event → equipItem animation', () => {
    const events = [makePlayerEvent('equip', { player: 'P1', cardId: 'weapon1', slot: 'weapon' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'equipItem', player: 'P1', cardId: 'weapon1', slot: 'weapon' },
    ]);
  });

  it('kill event with payload.player → death animation', () => {
    const events = [makePlayerEvent('kill', { player: 'P3' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'death', player: 'P3' },
    ]);
  });

  it('kill event with payload.target → death animation', () => {
    const events = [makePlayerEvent('kill', { target: 'P2' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'death', player: 'P2' },
    ]);
  });

  it('pushPending event → pendingPrompt animation', () => {
    const events = [makePlayerEvent('pushPending', { type: 'responseWindow' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'pendingPrompt', actionType: 'responseWindow' },
    ]);
  });

  it('judge event → cardFlip animation', () => {
    const events = [makePlayerEvent('judge', { cardId: 'judgeCard1' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'cardFlip', cardId: 'judgeCard1' },
    ]);
  });

  it('moveCard event → cardMove animation', () => {
    const events = [makePlayerEvent('moveCard', {
      cardId: 'c10',
      from: { zone: 'hand', player: 'P1' },
      to: { zone: 'discardPile' },
    })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'cardMove', cardId: 'c10', from: { zone: 'hand', player: 'P1' }, to: { zone: 'discardPile' }, duration: 300 },
    ]);
  });

  it('setPhase event → no animation', () => {
    const events = [makePlayerEvent('setPhase', { phase: '出牌' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([]);
  });

  it('nextPlayer event → nextPlayer animation', () => {
    const events = [makePlayerEvent('nextPlayer', { player: 'P2' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'nextPlayer', player: 'P2' },
    ]);
  });

  it('addPendingTrick event → pendingPrompt animation', () => {
    const events = [makePlayerEvent('addPendingTrick', { player: 'P3', trick: { name: '闪电' } })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'pendingPrompt', actionType: 'addPendingTrick' },
    ]);
  });

  it('removePendingTrick event → trickReveal animation', () => {
    const events = [makePlayerEvent('removePendingTrick', { player: 'P3', cardId: 'trickCard1', result: 'success' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'trickReveal', cardId: 'trickCard1', result: 'success' },
    ]);
  });

  it('removePendingTrick with fail result', () => {
    const events = [makePlayerEvent('removePendingTrick', { cardId: 'trickCard2', result: 'fail' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'trickReveal', cardId: 'trickCard2', result: 'fail' },
    ]);
  });

  it('unknown event → no animation', () => {
    const events = [makePlayerEvent('customEvent', { foo: 'bar' })];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([]);
  });

  it('empty events → empty array', () => {
    const anims = eventsToAnimations(PID, []);
    expect(anims).toEqual([]);
  });

  it('multiple events → multiple animations in order', () => {
    const events = [
      makePlayerEvent('damage', { target: 'P2', amount: 1 }),
      makePlayerEvent('heal', { target: 'P1', amount: 1 }),
      makePlayerEvent('draw', { player: 'P1', count: 2 }),
      makePlayerEvent('setPhase', { phase: '弃牌' }),
      makePlayerEvent('kill', { player: 'P2' }),
    ];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'damagePopup', target: 'P2', amount: 1 },
      { type: 'healGlow', target: 'P1', amount: 1 },
      { type: 'drawCards', player: 'P1', count: 2 },
      { type: 'death', player: 'P2' },
    ]);
  });

  it('events with missing payload fields use defaults gracefully', () => {
    const events = [
      makePlayerEvent('damage', {}),
      makePlayerEvent('discard', { player: 'P1' }),
      makePlayerEvent('kill', {}),
    ];
    const anims = eventsToAnimations(PID, events);
    expect(anims).toEqual([
      { type: 'damagePopup', target: '', amount: 0 },
      { type: 'discardCards', player: 'P1', cardIds: [] },
      { type: 'death', player: '' },
    ]);
  });
});
