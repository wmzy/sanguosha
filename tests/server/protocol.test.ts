// tests/server/protocol.test.ts
import { describe, it, expect } from 'vitest';
import {
  isValidClientMessage,
  serialize,
  deserialize,
  type ClientMessage,
  type ServerMessage,
} from '../../server/protocol';
import type { GameAction } from '../../engine/types';

// ─── helpers ────────────────────────────────────────────────

const stubGameAction: GameAction = { type: 'playCard', player: 'p1', cardId: 'c1' };

const stubFrontendState = {
  view: {
    cardMap: {},
    self: {
      characterId: '曹操',
      hand: [],
      equipment: { weapon: null, armor: null, mount: null },
      health: 4,
      maxHealth: 4,
      pendingTricks: [],
      tags: [],
      vars: {},
      alive: true,
    },
    others: {},
    table: { discardPileCount: 0, deckCount: 50 },
    turn: { phase: '出牌', currentPlayer: 'p1', killsPlayed: 0 },
    pending: null,
  },
  myPlayerId: 'p1',
  animationQueue: [],
};

// ─── isValidClientMessage: valid cases ──────────────────────

describe('isValidClientMessage — valid messages', () => {
  it('accepts action message', () => {
    expect(isValidClientMessage({ type: 'action', action: stubGameAction, baseSeq: 0 })).toBe(true);
  });

  it('accepts response message', () => {
    expect(isValidClientMessage({ type: 'response', baseSeq: 0, choice: 'A' })).toBe(true);
  });

  it('accepts ready message', () => {
    expect(isValidClientMessage({ type: 'ready' })).toBe(true);
  });

  it('accepts join_room message', () => {
    expect(isValidClientMessage({ type: 'join_room', roomId: 'r1' })).toBe(true);
  });

  it('accepts create_room message', () => {
    expect(isValidClientMessage({ type: 'create_room', name: 'room1', maxPlayers: 4 })).toBe(true);
  });


  it('accepts join_debug_room message', () => {
    expect(isValidClientMessage({ type: 'join_debug_room', roomId: 'dr1' })).toBe(true);
  });


  it('accepts start_game message', () => {
    expect(isValidClientMessage({ type: 'start_game' })).toBe(true);
  });

  it('accepts leave_room message', () => {
    expect(isValidClientMessage({ type: 'leave_room' })).toBe(true);
  });

  it('accepts list_rooms without filter', () => {
    expect(isValidClientMessage({ type: 'list_rooms' })).toBe(true);
  });

  it('accepts list_rooms with debug filter', () => {
    expect(isValidClientMessage({ type: 'list_rooms', filter: 'debug' })).toBe(true);
  });

  it('accepts list_rooms with multiplayer filter', () => {
    expect(isValidClientMessage({ type: 'list_rooms', filter: 'multiplayer' })).toBe(true);
  });

  it('accepts reconnect message', () => {
    expect(isValidClientMessage({ type: 'reconnect', playerId: 'p1' })).toBe(true);
  });
});

// ─── isValidClientMessage: invalid cases ────────────────────

describe('isValidClientMessage — invalid messages', () => {
  it('rejects null', () => {
    expect(isValidClientMessage(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidClientMessage(undefined)).toBe(false);
  });

  it('rejects string', () => {
    expect(isValidClientMessage('hello')).toBe(false);
  });

  it('rejects number', () => {
    expect(isValidClientMessage(42)).toBe(false);
  });

  it('rejects empty object', () => {
    expect(isValidClientMessage({})).toBe(false);
  });

  it('rejects object with non-string type', () => {
    expect(isValidClientMessage({ type: 123 })).toBe(false);
  });

  it('rejects unknown type', () => {
    expect(isValidClientMessage({ type: 'invalid' })).toBe(false);
  });

  it('rejects action with missing action field', () => {
    expect(isValidClientMessage({ type: 'action' })).toBe(false);
  });

  it('rejects action with non-object action field', () => {
    expect(isValidClientMessage({ type: 'action', action: 'not-an-object' })).toBe(false);
  });

  it('rejects action with null action field', () => {
    expect(isValidClientMessage({ type: 'action', action: null })).toBe(false);
  });

  it('rejects response with missing baseSeq', () => {
    expect(isValidClientMessage({ type: 'response', choice: 'A' })).toBe(false);
  });

  it('rejects response with non-number baseSeq', () => {
    expect(isValidClientMessage({ type: 'response', baseSeq: '0', choice: 'A' })).toBe(false);
  });

  it('rejects join_room with missing roomId', () => {
    expect(isValidClientMessage({ type: 'join_room' })).toBe(false);
  });

  it('rejects join_room with non-string roomId', () => {
    expect(isValidClientMessage({ type: 'join_room', roomId: 123 })).toBe(false);
  });

  it('rejects create_room with missing name', () => {
    expect(isValidClientMessage({ type: 'create_room', maxPlayers: 4 })).toBe(false);
  });

  it('rejects create_room with non-number maxPlayers', () => {
    expect(isValidClientMessage({ type: 'create_room', name: 'room', maxPlayers: '4' })).toBe(false);
  });

  it('rejects create_debug_room below minimum (1)', () => {
    expect(isValidClientMessage({ type: 'create_debug_room', playerCount: 1 })).toBe(false);
  });

  it('rejects create_debug_room above maximum (9)', () => {
    expect(isValidClientMessage({ type: 'create_debug_room', playerCount: 9 })).toBe(false);
  });

  it('rejects create_debug_room with non-number playerCount', () => {
    expect(isValidClientMessage({ type: 'create_debug_room', playerCount: '3' })).toBe(false);
  });

  it('rejects join_debug_room with missing roomId', () => {
    expect(isValidClientMessage({ type: 'join_debug_room' })).toBe(false);
  });

  it('rejects reconnect with missing playerId', () => {
    expect(isValidClientMessage({ type: 'reconnect' })).toBe(false);
  });

  it('rejects list_rooms with invalid filter', () => {
    expect(isValidClientMessage({ type: 'list_rooms', filter: 'other' })).toBe(false);
  });
});

// ─── isValidClientMessage: type guard ───────────────────────

describe('isValidClientMessage — type guard', () => {
  it('narrows type to ClientMessage', () => {
    const data: unknown = { type: 'ready' };
    if (isValidClientMessage(data)) {
      // TypeScript 应该允许访问 type 属性
      expect(data.type).toBe('ready');
    } else {
      expect.unreachable('Should be a valid ClientMessage');
    }
  });
});

// ─── serialize ──────────────────────────────────────────────

describe('serialize', () => {
  it('serializes error message', () => {
    const msg: ServerMessage = { type: 'error', message: 'something went wrong' };
    const result = serialize(msg);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('error');
    expect(parsed.message).toBe('something went wrong');
  });

  it('serializes room_joined message', () => {
    const msg: ServerMessage = { type: 'room_joined', roomId: 'r1', playerId: 'p1' };
    const result = serialize(msg);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('room_joined');
    expect(parsed.roomId).toBe('r1');
    expect(parsed.playerId).toBe('p1');
  });

  it('serializes player_joined message', () => {
    const msg: ServerMessage = { type: 'player_joined', playerId: 'p1' };
    const result = serialize(msg);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('player_joined');
    expect(parsed.playerId).toBe('p1');
  });

  it('serializes player_left message', () => {
    const msg: ServerMessage = { type: 'player_left', playerId: 'p2' };
    const result = serialize(msg);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('player_left');
  });

  it('serializes player_disconnected message with graceMs', () => {
    const msg: ServerMessage = { type: 'player_disconnected', playerId: 'p1', graceMs: 30000 };
    const result = serialize(msg);
    const parsed = JSON.parse(result);
    expect(parsed.graceMs).toBe(30000);
  });

  it('serializes player_reconnected message', () => {
    const msg: ServerMessage = { type: 'player_reconnected', playerId: 'p1' };
    const result = serialize(msg);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('player_reconnected');
  });

  it('serializes game_started message', () => {
    const msg: ServerMessage = { type: 'game_started' };
    const result = serialize(msg);
    expect(JSON.parse(result).type).toBe('game_started');
  });

  it('serializes gameOver message', () => {
    const msg: ServerMessage = { type: 'gameOver', winner: '主公' };
    const result = serialize(msg);
    const parsed = JSON.parse(result);
    expect(parsed.winner).toBe('主公');
  });

  it('serializes initialView message with FrontendState', () => {
    const msg: ServerMessage = { type: 'initialView', state: stubFrontendState, lastSeq: 5 };
    const result = serialize(msg);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('initialView');
    expect(parsed.state.myPlayerId).toBe('p1');
    expect(parsed.lastSeq).toBe(5);
  });

  it('serializes events message with seq/timestamp and no actionLog', () => {
    const events = [{ id: 'e1', type: 'turnStart', timestamp: 1000, payload: { player: 'p1' }, seq: 3 }];
    const msg: ServerMessage = { type: 'events', fromSeq: 3, events };
    const result = serialize(msg);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('events');
    expect(parsed.fromSeq).toBe(3);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].seq).toBe(3);
    expect(parsed.events[0].timestamp).toBe(1000);
    expect(parsed.actionLog).toBeUndefined();
  });

  it('serializes room_list message', () => {
    const rooms = [
      { id: 'r1', name: 'room1', playerCount: 2, maxPlayers: 4, status: '等待中' as const, isDebug: false },
    ];
    const msg: ServerMessage = { type: 'room_list', rooms };
    const result = serialize(msg);
    const parsed = JSON.parse(result);
    expect(parsed.rooms).toHaveLength(1);
    expect(parsed.rooms[0].status).toBe('等待中');
  });

  it('produces valid JSON that can be parsed back', () => {
    const msg: ServerMessage = { type: 'error', message: 'test' };
    expect(() => JSON.parse(serialize(msg))).not.toThrow();
  });
});

// ─── deserialize — valid messages ───────────────────────────

describe('deserialize — valid messages', () => {
  it('deserializes ready message', () => {
    const result = deserialize(JSON.stringify({ type: 'ready' }));
    expect(result).toEqual({ type: 'ready' });
  });

  it('deserializes action message with nested object', () => {
    const msg = { type: 'action', action: { type: 'playCard', player: 'p1', cardId: 'c1' }, baseSeq: 0 };
    const result = deserialize(JSON.stringify(msg));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('action');
    expect((result as { action: unknown }).action).toEqual(msg.action);
  });

  it('deserializes response message', () => {
    const msg = { type: 'response', baseSeq: 0, choice: { cardId: 'c1' } };
    const result = deserialize(JSON.stringify(msg));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('response');
  });

  it('deserializes create_room message', () => {
    const msg = { type: 'create_room', name: 'test', maxPlayers: 6 };
    const result = deserialize(JSON.stringify(msg));
    expect(result).toEqual(msg);
  });

  it('deserializes reconnect message', () => {
    const msg = { type: 'reconnect', playerId: 'abc-123' };
    const result = deserialize(JSON.stringify(msg));
    expect(result).toEqual(msg);
  });

  it('deserializes list_rooms with filter', () => {
    const msg = { type: 'list_rooms', filter: 'debug' };
    const result = deserialize(JSON.stringify(msg));
    expect(result).toEqual(msg);
  });
});

// ─── deserialize — invalid messages ─────────────────────────

describe('deserialize — invalid messages', () => {
  it('returns null for invalid JSON', () => {
    expect(deserialize('{bad json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(deserialize('')).toBeNull();
  });

  it('returns null for valid JSON with unknown type', () => {
    expect(deserialize(JSON.stringify({ type: 'unknown_type' }))).toBeNull();
  });

  it('returns null for valid JSON with no type field', () => {
    expect(deserialize(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });

  it('returns null for valid JSON with invalid payload (missing fields)', () => {
    expect(deserialize(JSON.stringify({ type: 'join_room' }))).toBeNull();
  });

  it('returns null for non-object JSON (string)', () => {
    expect(deserialize('"hello"')).toBeNull();
  });

  it('returns null for non-object JSON (number)', () => {
    expect(deserialize('42')).toBeNull();
  });

  it('returns null for JSON null', () => {
    expect(deserialize('null')).toBeNull();
  });

  it('returns null for JSON array', () => {
    expect(deserialize('[1,2,3]')).toBeNull();
  });
});

// ─── round-trip ─────────────────────────────────────────────

describe('serialize + deserialize round-trip', () => {
  it('round-trips ready message through string', () => {
    const original: ClientMessage = { type: 'ready' };
    const json = JSON.stringify(original);
    const result = deserialize(json);
    expect(result).toEqual(original);
  });

  it('round-trips response message', () => {
    const original: ClientMessage = { type: 'response', baseSeq: 42, choice: ['card1', 'card2'] };
    const result = deserialize(JSON.stringify(original));
    expect(result).toEqual(original);
  });
});
