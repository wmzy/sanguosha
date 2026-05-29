import { describe, it, expect } from 'vitest';
import {
  ResponseSystem,
  createKillResponseWindow,
  createTrickResponseWindow,
  createDyingResponseWindow,
} from '@engine/core/response';
import type { GameState, Card, Player } from '@shared/types';

// Helper to create a minimal game state for testing
function makeCard(name: string, overrides?: Partial<Card>): Card {
  return {
    name,
    type: '基本牌',
    subtype: name === '闪' ? '闪' : name === '桃' ? '桃' : '杀',
    suit: '♠',
    rank: 'A',
    description: '',
    ...overrides,
  };
}

function makePlayer(name: string, overrides?: Partial<Player>): Player {
  return {
    name,
    character: {
      name,
      maxHealth: 4,
      gender: '男',
      faction: '魏',
      abilities: [],
    },
    role: '主公',
    health: 4,
    maxHealth: 4,
    hand: [],
    equipment: {},
    alive: true,
    ...overrides,
  };
}

function makeGame(overrides?: Partial<GameState>): GameState {
  return {
    players: [makePlayer('曹操'), makePlayer('刘备')],
    deck: [],
    discardPile: [],
    currentPlayer: '曹操',
    phase: '出牌',
    round: 1,
    status: '进行中',
    ...overrides,
  };
}

// ============================================================
// ResponseSystem
// ============================================================

describe('ResponseSystem', () => {
  it('should start empty', () => {
    const system = new ResponseSystem();
    expect(system.isEmpty()).toBe(true);
    expect(system.hasPending()).toBe(false);
    expect(system.current()).toBeUndefined();
    expect(system.getPendingResponders()).toEqual([]);
  });

  it('should push and track a window', () => {
    const system = new ResponseSystem();
    const window = createKillResponseWindow('曹操', '刘备', makeCard('杀'));

    system.push(window);

    expect(system.isEmpty()).toBe(false);
    expect(system.hasPending()).toBe(true);
    expect(system.current()).toBe(window);
    expect(system.getPendingResponders()).toEqual(['刘备']);
  });

  it('should resolve a window and apply onResolve', () => {
    const system = new ResponseSystem();
    const killCard = makeCard('杀');
    const window = createKillResponseWindow('曹操', '刘备', killCard);
    system.push(window);

    const game = makeGame();
    const responses = new Map<string, Card | null>();
    // No dodge — 刘备 takes damage
    const result = system.resolve(game, responses);

    expect(system.isEmpty()).toBe(true);
    const liuBei = result.players.find(p => p.name === '刘备')!;
    expect(liuBei.health).toBe(3);
  });

  it('should support nested windows (stack)', () => {
    const system = new ResponseSystem();
    const window1 = createKillResponseWindow('曹操', '刘备', makeCard('杀'));
    const window2 = createTrickResponseWindow('曹操', '过河拆桥');

    system.push(window1);
    system.push(window2);

    expect(system.current()?.type).toBe('trick_response');
    expect(system.getPendingResponders()).toEqual([]);

    system.resolve(makeGame(), new Map());
    expect(system.current()?.type).toBe('kill_response');
    expect(system.getPendingResponders()).toEqual(['刘备']);
  });

  it('should return game unchanged when resolving empty stack', () => {
    const system = new ResponseSystem();
    const game = makeGame();
    const result = system.resolve(game, new Map());
    expect(result).toBe(game);
  });
});

// ============================================================
// createKillResponseWindow
// ============================================================

describe('createKillResponseWindow', () => {
  it('should apply damage when target does not dodge', () => {
    const window = createKillResponseWindow('曹操', '刘备', makeCard('杀'));
    const game = makeGame();
    const responses = new Map<string, Card | null>();

    const result = window.onResolve(game, responses);

    const liuBei = result.players.find(p => p.name === '刘备')!;
    expect(liuBei.health).toBe(3);
  });

  it('should dodge and remove 闪 from target hand', () => {
    const dodgeCard = makeCard('闪');
    const window = createKillResponseWindow('曹操', '刘备', makeCard('杀'));
    const game = makeGame({
      players: [
        makePlayer('曹操'),
        makePlayer('刘备', { hand: [dodgeCard, makeCard('杀')], health: 4 }),
      ],
    });
    const responses = new Map<string, Card | null>();
    responses.set('刘备', dodgeCard);

    const result = window.onResolve(game, responses);

    const liuBei = result.players.find(p => p.name === '刘备')!;
    expect(liuBei.health).toBe(4); // No damage
    expect(liuBei.hand.length).toBe(1); // 闪 removed
    expect(liuBei.hand[0].name).toBe('杀'); // Only 杀 remains
  });

  it('should not affect other players', () => {
    const window = createKillResponseWindow('曹操', '刘备', makeCard('杀'));
    const game = makeGame();
    const responses = new Map<string, Card | null>();

    const result = window.onResolve(game, responses);

    const caoCao = result.players.find(p => p.name === '曹操')!;
    expect(caoCao.health).toBe(4);
  });

  it('should store sourceCard', () => {
    const killCard = makeCard('杀');
    const window = createKillResponseWindow('曹操', '刘备', killCard);
    expect(window.sourceCard).toBe(killCard);
    expect(window.type).toBe('kill_response');
  });
});

// ============================================================
// createTrickResponseWindow
// ============================================================

describe('createTrickResponseWindow', () => {
  it('should return game unchanged when no one nullifies', () => {
    const window = createTrickResponseWindow('曹操', '过河拆桥', '刘备');
    const game = makeGame();
    const responses = new Map<string, Card | null>();

    const result = window.onResolve(game, responses);

    expect(result).toEqual(game);
  });

  it('should nullify trick when 无懈可击 is played', () => {
    const window = createTrickResponseWindow('曹操', '过河拆桥', '刘备');
    const game = makeGame();
    const nullifyCard = makeCard('无懈可击', { type: '锦囊牌', subtype: '锦囊' });
    const responses = new Map<string, Card | null>();
    responses.set('刘备', nullifyCard);

    const result = window.onResolve(game, responses);

    // Game state should be unchanged (trick nullified)
    expect(result).toEqual(game);
  });

  it('should not nullify when non-无懈可击 card is played', () => {
    const window = createTrickResponseWindow('曹操', '过河拆桥', '刘备');
    const game = makeGame();
    const responses = new Map<string, Card | null>();
    responses.set('刘备', makeCard('杀'));

    const result = window.onResolve(game, responses);

    // Should return game as-is (not nullified, trick proceeds)
    expect(result).toEqual(game);
  });

  it('should have empty validResponders (all players can respond)', () => {
    const window = createTrickResponseWindow('曹操', '过河拆桥');
    expect(window.validResponders).toEqual([]);
    expect(window.validCards).toEqual(['无懈可击']);
  });
});

// ============================================================
// createDyingResponseWindow
// ============================================================

describe('createDyingResponseWindow', () => {
  it('should save player when 桃 is played', () => {
    const peachCard = makeCard('桃', { type: '基本牌', subtype: '桃', suit: '♥' });
    const dyingPlayer = makePlayer('刘备', { health: 0, alive: false });
    const savior = makePlayer('曹操', { hand: [peachCard] });

    const window = createDyingResponseWindow('刘备', ['曹操', '刘备']);
    const game = makeGame({ players: [savior, dyingPlayer] });
    const responses = new Map<string, Card | null>();
    responses.set('曹操', peachCard);

    const result = window.onResolve(game, responses);

    const liuBei = result.players.find(p => p.name === '刘备')!;
    const caoCao = result.players.find(p => p.name === '曹操')!;
    expect(liuBei.health).toBe(1);
    expect(liuBei.alive).toBe(true);
    expect(caoCao.hand.length).toBe(0); // 桃 consumed
  });

  it('should let player die when no one plays 桃', () => {
    const dyingPlayer = makePlayer('刘备', { health: 0, alive: false });

    const window = createDyingResponseWindow('刘备', ['曹操', '刘备']);
    const game = makeGame({ players: [makePlayer('曹操'), dyingPlayer] });
    const responses = new Map<string, Card | null>();

    const result = window.onResolve(game, responses);

    const liuBei = result.players.find(p => p.name === '刘备')!;
    expect(liuBei.alive).toBe(false);
    expect(liuBei.health).toBe(0);
  });

  it('should use self-played 桃 to save', () => {
    const peachCard = makeCard('桃', { type: '基本牌', subtype: '桃', suit: '♥' });
    const dyingPlayer = makePlayer('刘备', { health: 0, alive: false, hand: [peachCard] });

    const window = createDyingResponseWindow('刘备', ['曹操', '刘备']);
    const game = makeGame({ players: [makePlayer('曹操'), dyingPlayer] });
    const responses = new Map<string, Card | null>();
    responses.set('刘备', peachCard);

    const result = window.onResolve(game, responses);

    const liuBei = result.players.find(p => p.name === '刘备')!;
    expect(liuBei.health).toBe(1);
    expect(liuBei.alive).toBe(true);
    expect(liuBei.hand.length).toBe(0); // Self-played 桃 consumed
  });

  it('should accept all players as valid responders', () => {
    const window = createDyingResponseWindow('刘备', ['曹操', '刘备', '孙权']);
    expect(window.validResponders).toEqual(['曹操', '刘备', '孙权']);
    expect(window.validCards).toEqual(['桃']);
    expect(window.type).toBe('dying');
  });
});
