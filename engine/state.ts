import type { CharacterConfig, GameState, Player, PublicGameState, Role } from '../shared/types';
import type { Rng } from '../shared/rng';
import { createRng } from '../shared/rng';
import { createDeck } from '../shared/cards';
import { shuffle } from '../shared/deck';
import type { GameLogger } from './logger';

function shuffleArray<T>(arr: T[], rng: Rng): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function assignRoles(count: number): Role[] {
  if (count < 2) throw new Error('至少需要2名玩家');
  const roles: Role[] = ['主公'];
  const rebels = Math.max(1, Math.floor(count / 2));
  const traitors = count >= 5 ? 1 : 0;
  const loyal = count - 1 - rebels - traitors;
  for (let i = 0; i < loyal; i++) roles.push('忠臣');
  for (let i = 0; i < rebels; i++) roles.push('反贼');
  for (let i = 0; i < traitors; i++) roles.push('内奸');
  return roles;
}

export function createGame(
  characters: CharacterConfig[],
  seed?: number,
  logger?: GameLogger,
): GameState {
  const actualSeed = seed ?? Date.now();
  const rng = createRng(actualSeed);
  const deck = shuffle(createDeck(), rng);
  const roles = shuffleArray(assignRoles(characters.length), rng);

  const players: Player[] = characters.map((char, i) => ({
    name: char.name,
    character: char,
    role: roles[i],
    health: char.maxHealth,
    maxHealth: char.maxHealth,
    hand: [],
    equipment: {},
    alive: true,
    pendingTricks: [],
  }));

  const 主公 = players.find(p => p.role === '主公');

  logger?.logServerOp('gameStart', { playerCount: characters.length }, '创建游戏');

  return {
    players,
    deck,
    discardPile: [],
    currentPlayer: 主公?.name ?? players[0].name,
    phase: '准备',
    round: 1,
    status: '等待中',
    seed: actualSeed,
    killsPlayedThisTurn: 0,
    skillsUsedThisTurn: [],
  };
}

export function startGame(game: GameState, logger?: GameLogger): GameState {
  const handSize = 4;
  let deck = [...game.deck];
  const players = game.players.map(p => {
    const hand = deck.slice(0, handSize);
    deck = deck.slice(handSize);
    return { ...p, hand };
  });

  logger?.logServerOp('gameStart', {
    players: players.map(p => ({ name: p.name, character: p.character.name, role: p.role })),
  }, '发初始牌');

  return { ...game, players, deck, status: '进行中' };
}

export function getPlayer(game: GameState, name: string): Player {
  const player = game.players.find(p => p.name === name);
  if (!player) throw new Error(`玩家 ${name} 不存在`);
  return player;
}

export function getCurrentPlayer(game: GameState): Player {
  return getPlayer(game, game.currentPlayer);
}

export function getAlivePlayers(game: GameState): Player[] {
  return game.players.filter(p => p.alive);
}

export function getPublicState(game: GameState, observerName: string): PublicGameState {
  return {
    players: game.players.map(p => {
      const { hand, ...rest } = p;
      if (p.name === observerName) {
        return { ...rest, handCount: hand.length, hand };
      }
      return { ...rest, handCount: hand.length };
    }),
    discardPile: game.discardPile,
    currentPlayer: game.currentPlayer,
    phase: game.phase,
    round: game.round,
    status: game.status,
    winner: game.winner,
  };
}

export function checkVictory(game: GameState, logger?: GameLogger): GameState {
  const alive = getAlivePlayers(game);
  const aliveRoles = new Set(alive.map(p => p.role));

  let winner: string | undefined;

  if (!alive.some(p => p.role === '主公')) {
    winner = alive.length === 1 && alive[0].role === '内奸' ? '内奸' : '反贼';
  }

  if (!aliveRoles.has('反贼') && !aliveRoles.has('内奸')) {
    winner = '主公';
  }

  if (winner) {
    logger?.logServerOp('gameEnd', { winner }, `${winner}阵营胜利`);
    return { ...game, status: '已结束', winner: winner as GameState['winner'] };
  }

  return game;
}

export function playerDeath(game: GameState, playerName: string, logger?: GameLogger): GameState {
  const player = getPlayer(game, playerName);
  if (!player.alive) return game;

  logger?.logServerOp('play', { player: playerName }, `${playerName} 阵亡`);

  const newDiscardPile = [...game.discardPile, ...player.hand];

  let state: GameState = {
    ...game,
    players: game.players.map(p =>
      p.name === playerName
        ? { ...p, alive: false, health: 0, hand: [], pendingTricks: [] }
        : p,
    ),
    discardPile: newDiscardPile,
  };

  state = checkVictory(state, logger);
  return state;
}

export function updatePlayer(
  game: GameState,
  playerName: string,
  updates: Partial<Player>,
): GameState {
  return {
    ...game,
    players: game.players.map(p =>
      p.name === playerName ? { ...p, ...updates } : p,
    ),
  };
}
