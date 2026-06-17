// LEGACY TEST: references deleted v2 modules - skipped
/**
 * tests/serializer.test.ts — 序列化和验证
 */
import { describe, it, expect } from 'vitest';
// import { serialize, deserialize, validateGameState } from '@engine/serializer';  // LEGACY: removed (v2 module deleted)
import { createTestGame } from './engine-helpers';

describe.skip('validateGameState', () => {
  it('returns true for a valid GameState', () => {
    const state = createTestGame();
    expect(validateGameState(state)).toBe(true);
  });

  it('returns false for null', () => {
    expect(validateGameState(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(validateGameState('string')).toBe(false);
    expect(validateGameState(42)).toBe(false);
    expect(validateGameState(true)).toBe(false);
  });

  it('returns false when meta is missing', () => {
    const state = createTestGame();
    const { meta: _meta, ...rest } = state;
    expect(validateGameState(rest)).toBe(false);
  });

  it('returns false when meta.id is not a string', () => {
    const state = createTestGame();
    expect(validateGameState({ ...state, meta: { ...state.meta, id: 123 } })).toBe(false);
  });

  it('returns false when meta.seed is not a number', () => {
    const state = createTestGame();
    expect(validateGameState({ ...state, meta: { ...state.meta, seed: 'abc' } })).toBe(false);
  });

  it('returns false when phase is missing', () => {
    const state = createTestGame();
    const { phase: _phase, ...rest } = state;
    expect(validateGameState(rest)).toBe(false);
  });

  it('returns false when currentPlayer is missing', () => {
    const state = createTestGame();
    const { currentPlayer: _currentPlayer, ...rest } = state;
    expect(validateGameState(rest)).toBe(false);
  });

  it('returns false when playerOrder is not an array', () => {
    const state = createTestGame();
    expect(validateGameState({ ...state, playerOrder: 'P1,P2' })).toBe(false);
  });

  it('returns false when players is missing', () => {
    const state = createTestGame();
    const { players: _players, ...rest } = state;
    expect(validateGameState(rest)).toBe(false);
  });

  it('returns false when zones is missing', () => {
    const state = createTestGame();
    const { zones: _zones, ...rest } = state;
    expect(validateGameState(rest)).toBe(false);
  });

  it('returns false when cardMap is missing', () => {
    const state = createTestGame();
    const { cardMap: _cardMap, ...rest } = state;
    expect(validateGameState(rest)).toBe(false);
  });

  it('returns false when turn is missing', () => {
    const state = createTestGame();
    const { turn: _turn, ...rest } = state;
    expect(validateGameState(rest)).toBe(false);
  });


  it('returns false when serverLog is not an array', () => {
    const state = createTestGame();
    expect(validateGameState({ ...state, serverLog: 'not-array' })).toBe(false);
  });

  it('returns false when playerLogs is missing', () => {
    const state = createTestGame();
    const { playerLogs: _playerLogs, ...rest } = state;
    expect(validateGameState(rest)).toBe(false);
  });

  it('returns false when rngState is not a number', () => {
    const state = createTestGame();
    expect(validateGameState({ ...state, rngState: 'abc' })).toBe(false);
  });

  it('returns true when pending is null', () => {
    const state = createTestGame();
    expect(validateGameState({ ...state, pending: null })).toBe(true);
  });

  it('returns false when pending is a non-null non-object', () => {
    const state = createTestGame();
    expect(validateGameState({ ...state, pending: 'invalid' })).toBe(false);
  });
});

describe.skip('serialize / deserialize', () => {
  it('serialize produces valid JSON', () => {
    const state = createTestGame();
    const json = serialize(state);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('round-trips through serialize/deserialize', () => {
    const state = createTestGame();
    const json = serialize(state);
    const restored = deserialize(json);
    expect(restored.meta.id).toBe(state.meta.id);
    expect(restored.meta.seed).toBe(state.meta.seed);
    expect(restored.currentPlayer).toBe(state.currentPlayer);
    expect(restored.playerOrder).toEqual(state.playerOrder);
    expect(restored.phase).toBe(state.phase);
    expect(restored.rngState).toBe(state.rngState);
  });

  it('throws on invalid JSON', () => {
    expect(() => deserialize('not json')).toThrow();
  });

  it('throws on valid JSON but invalid GameState', () => {
    expect(() => deserialize('{}')).toThrow('Invalid GameState');
  });

  it('throws when meta fields are missing', () => {
    const state = createTestGame();
    const json = serialize(state);
    const obj = JSON.parse(json);
    delete obj.meta.id;
    expect(() => deserialize(JSON.stringify(obj))).toThrow('Invalid GameState');
  });
});
