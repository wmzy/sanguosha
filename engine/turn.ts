import type { GameState, TurnPhase } from '../shared/types';
import type { Rng } from '../shared/rng';
import type { GameLogger } from './logger';
import { getCurrentPlayer, getAlivePlayers, updatePlayer } from './state';
import { drawCards, shuffle } from '../shared/deck';
import { resolvePendingTrick } from './judge';

export const phaseOrder: TurnPhase[] = ['准备', '判定', '摸牌', '出牌', '弃牌', '结束'];

export function nextPhase(game: GameState, logger?: GameLogger): GameState {
  const currentIndex = phaseOrder.indexOf(game.phase);
  const nextIndex = (currentIndex + 1) % phaseOrder.length;
  const nextPhaseName = phaseOrder[nextIndex];

  if (nextPhaseName === '准备') {
    const alive = getAlivePlayers(game);
    const currentIdx = alive.findIndex(p => p.name === game.currentPlayer);
    const nextIdx = (currentIdx + 1) % alive.length;
    const nextPlayer = alive[nextIdx];

    const newState: GameState = {
      ...game,
      phase: nextPhaseName,
      currentPlayer: nextPlayer.name,
      round: game.round + 1,
      killsPlayedThisTurn: 0,
      skillsUsedThisTurn: [],
    };

    logger?.logServerOp('turnChange', {
      from: game.currentPlayer,
      to: nextPlayer.name,
      round: newState.round,
    }, `轮到 ${nextPlayer.name} 的回合`);

    return newState;
  }

  logger?.logServerOp('phaseChange', {
    phase: nextPhaseName,
    player: game.currentPlayer,
  }, `进入${nextPhaseName}阶段`);

  return { ...game, phase: nextPhaseName };
}

export function drawPhase(
  game: GameState,
  rng: Rng,
  logger?: GameLogger,
): { state: GameState; message: string } {
  const currentPlayer = getCurrentPlayer(game);

  let deck = [...game.deck];
  let discardPile = [...game.discardPile];

  if (deck.length < 2) {
    if (discardPile.length > 0) {
      deck = [...deck, ...shuffle(discardPile, rng)];
      discardPile = [];
      logger?.logServerOp('shuffle', { deckSize: deck.length }, '洗牌');
    }
  }

  const drawCount = Math.min(2, deck.length);
  const { drawn: drawnCards, remaining: remainingDeck } = drawCards(deck, drawCount);

  const state: GameState = {
    ...game,
    players: game.players.map(p =>
      p.name === currentPlayer.name
        ? { ...p, hand: [...p.hand, ...drawnCards] }
        : p,
    ),
    deck: remainingDeck,
    discardPile,
  };

  logger?.logServerOp('draw', {
    player: currentPlayer.name,
    cards: drawnCards.map(c => ({ name: c.name, suit: c.suit, rank: c.rank })),
  }, `${currentPlayer.name} 摸了 ${drawnCards.length} 张牌`);

  return {
    state,
    message: `${currentPlayer.name} 摸了 ${drawnCards.length} 张牌`,
  };
}

export function checkDiscard(game: GameState): boolean {
  const currentPlayer = getCurrentPlayer(game);
  return currentPlayer.hand.length > currentPlayer.maxHealth;
}

export function executeDiscard(
  game: GameState,
  discardIndices: number[],
  logger?: GameLogger,
): GameState {
  const currentPlayer = getCurrentPlayer(game);
  const discardedCards = discardIndices
    .map(i => currentPlayer.hand[i])
    .filter(Boolean);
  const remainingHand = currentPlayer.hand.filter((_, i) => !discardIndices.includes(i));

  logger?.logServerOp('discard', {
    player: currentPlayer.name,
    cards: discardedCards.map(c => ({ name: c.name, suit: c.suit, rank: c.rank })),
  }, `${currentPlayer.name} 弃了 ${discardedCards.length} 张牌`);

  return {
    ...game,
    players: game.players.map(p =>
      p.name === currentPlayer.name ? { ...p, hand: remainingHand } : p,
    ),
    discardPile: [...game.discardPile, ...discardedCards],
  };
}

export function handleJudgePhase(
  game: GameState,
  rng: Rng,
  logger?: GameLogger,
): { state: GameState; skipPhases: TurnPhase[] } {
  const player = getCurrentPlayer(game);
  const tricks = [...(player.pendingTricks ?? [])];
  let state = updatePlayer(game, player.name, { pendingTricks: [] });
  const allSkipPhases: TurnPhase[] = [];

  for (const trick of tricks) {
    const result = resolvePendingTrick(state, player.name, trick, rng, logger);
    state = result.state;
    allSkipPhases.push(...result.skipPhases);
  }

  return { state, skipPhases: allSkipPhases };
}
