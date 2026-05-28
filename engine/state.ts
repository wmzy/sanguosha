import type { GameState, Player, PublicGameState, CharacterConfig, Role } from '../shared/types';
import type { GameLogger } from './logger';
import { createDeck } from '../shared/cards';
import { shuffle } from '../shared/deck';
import { createRng } from '../shared/rng';

export function createGame(characters: CharacterConfig[], seed?: number, logger?: GameLogger): GameState {
  const rng = createRng(seed ?? Date.now());
  const deck = shuffle(createDeck(), rng);

  const roles = assignRoles(characters.length);

  const players: Player[] = characters.map((character, i) => ({
    name: character.name,
    character,
    role: roles[i],
    health: character.maxHealth,
    maxHealth: character.maxHealth,
    hand: [],
    equipment: {},
    alive: true,
  }));

  const gameState: GameState = {
    players,
    deck,
    discardPile: [],
    currentPlayer: players[0].name,
    phase: '准备',
    round: 1,
    status: '等待中',
  };

  if (logger) {
    logger.logServerOp('gameStart', {
      players: players.map(p => ({ name: p.name, character: p.character.name, role: p.role })),
    }, `游戏开始: ${players.map(p => p.name).join(', ')}`);
    for (const player of players) {
      logger.logPlayerOp(player.name, 'gameStart', {
        player: player.name,
        character: player.character.name,
        role: player.role,
      }, `游戏开始，你是 ${player.character.name}（${player.role}）`);
    }
  }

  return gameState;
}

function assignRoles(playerCount: number): Role[] {
  if (playerCount === 2) {
    return ['主公', '反贼'];
  }
  const roles: Role[] = ['主公'];
  if (playerCount >= 4) roles.push('忠臣');
  const rebelCount = playerCount >= 5 ? 2 : 1;
  for (let i = 0; i < rebelCount; i++) roles.push('反贼');
  if (playerCount >= 4) roles.push('内奸');
  return roles.slice(0, playerCount);
}

export function getPublicState(game: GameState, observerName: string): PublicGameState {
  return {
    players: game.players.map(player => {
      const { hand, ...rest } = player;
      if (player.name === observerName) {
        return { ...rest, hand, handCount: hand.length };
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

export function startGame(game: GameState): GameState {
  return { ...game, status: '进行中' };
}

export function getCurrentPlayer(game: GameState): Player {
  const player = game.players.find(p => p.name === game.currentPlayer);
  if (!player) throw new Error(`找不到玩家: ${game.currentPlayer}`);
  return player;
}

export function getAlivePlayers(game: GameState): Player[] {
  return game.players.filter(p => p.alive);
}

export function checkVictory(game: GameState, logger?: GameLogger): GameState {
  const alive = getAlivePlayers(game);
  const lord = game.players.find(p => p.role === '主公');

  const aliveRoles = alive.map(p => p.role);
  const hasRebel = aliveRoles.includes('反贼');
  const hasSpy = aliveRoles.includes('内奸');

  function logGameEnd(winner: Role): void {
    if (logger) {
      const reason = `${winner}获胜`;
      logger.logServerOp('gameEnd', { winner, reason }, `游戏结束: ${reason}`);
      for (const player of game.players) {
        logger.logPlayerOp(player.name, 'gameEnd', { winner, reason }, `游戏结束: ${reason}`);
      }
    }
  }

  if (lord && !lord.alive) {
    if (hasRebel) {
      logGameEnd('反贼');
      return { ...game, status: '已结束', winner: '反贼' };
    }
    if (hasSpy && alive.length === 1) {
      logGameEnd('内奸');
      return { ...game, status: '已结束', winner: '内奸' };
    }
    logGameEnd('反贼');
    return { ...game, status: '已结束', winner: '反贼' };
  }

  if (lord?.alive && !hasRebel && !hasSpy) {
    logGameEnd('主公');
    return { ...game, status: '已结束', winner: '主公' };
  }

  if (alive.length === 1) {
    logGameEnd(alive[0].role);
    return { ...game, status: '已结束', winner: alive[0].role };
  }

  return game;
}

export function playerDeath(game: GameState, playerName: string, logger?: GameLogger): GameState {
  const newPlayers = game.players.map(p => {
    if (p.name === playerName) {
      return { ...p, alive: false };
    }
    return p;
  });

  const newGame = { ...game, players: newPlayers };

  if (logger) {
    logger.logServerOp('gameEnd', { player: playerName }, `${playerName} 已死亡`);
    for (const player of newGame.players) {
      logger.logPlayerOp(player.name, 'gameEnd', { player: playerName }, `${playerName} 已死亡`);
    }
  }

  return checkVictory(newGame, logger);
}
