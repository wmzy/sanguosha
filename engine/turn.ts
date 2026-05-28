import type { GameState, TurnPhase } from '../shared/types';
import type { GameLogger } from './logger';
import { getCurrentPlayer, getAlivePlayers } from './state';
import { drawCards } from '../shared/deck';

const phaseOrder: TurnPhase[] = ['准备', '判定', '摸牌', '出牌', '弃牌', '结束'];

export function nextPhase(game: GameState, logger?: GameLogger): GameState {
  const currentIndex = phaseOrder.indexOf(game.phase);
  const nextIndex = (currentIndex + 1) % phaseOrder.length;
  const nextPhaseName = phaseOrder[nextIndex];

  // If returning to the prepare phase, the round is over
  if (nextPhaseName === '准备' && currentIndex === phaseOrder.length - 1) {
    const alivePlayers = getAlivePlayers(game);
    const currentPlayerIndex = alivePlayers.findIndex(p => p.name === game.currentPlayer);
    const nextPlayerIndex = (currentPlayerIndex + 1) % alivePlayers.length;
    const nextPlayer = alivePlayers[nextPlayerIndex];

    const newState = {
      ...game,
      phase: nextPhaseName,
      currentPlayer: nextPlayer.name,
      round: game.round + 1,
    };

    if (logger) {
      logger.logServerOp('phaseChange', { phase: nextPhaseName, player: nextPlayer.name }, `进入${nextPhaseName}阶段`);
      logger.logServerOp('turnChange', { from: game.currentPlayer, to: nextPlayer.name, round: newState.round }, `轮到 ${nextPlayer.name} 的回合`);
    }

    return newState;
  }

  const newState = {
    ...game,
    phase: nextPhaseName,
  };

  if (logger) {
    logger.logServerOp('phaseChange', { phase: nextPhaseName, player: game.currentPlayer }, `进入${nextPhaseName}阶段`);
  }

  return newState;
}

export function drawPhase(game: GameState, logger?: GameLogger): { status: GameState; message: string } {
  const currentPlayer = getCurrentPlayer(game);

  // 如果牌堆不够，把弃牌堆洗回牌堆
  let deck = [...game.deck];
  let discardPile = [...game.discardPile];
  if (deck.length < 2 && discardPile.length > 0) {
    deck = [...deck, ...discardPile];
    discardPile = [];
    // 简单洗牌（不引入 rng 依赖）
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  const { drawn: drawnCards, remaining: remainingDeck } = drawCards(deck, 2);

  const newPlayers = game.players.map(p => {
    if (p.name === currentPlayer.name) {
      return { ...p, hand: [...p.hand, ...drawnCards] };
    }
    return p;
  });

  const status = { ...game, players: newPlayers, deck: remainingDeck, discardPile };

  if (logger) {
    logger.logServerOp('draw', {
      player: currentPlayer.name,
      cards: drawnCards.map(c => ({ name: c.name, suit: c.suit, rank: c.rank })),
    }, `${currentPlayer.name} 摸了 ${drawnCards.length} 张牌`);
    logger.logPlayerOp(currentPlayer.name, 'draw', {
      player: currentPlayer.name,
      cards: drawnCards.map(c => ({ name: c.name, suit: c.suit, rank: c.rank })),
    }, `你摸了 ${drawnCards.map(c => c.name).join('、')}`);
  }

  return {
    status,
    message: `${currentPlayer.name} 摸了 ${drawnCards.length} 张牌`,
  };
}

export function checkDiscard(game: GameState): boolean {
  const currentPlayer = getCurrentPlayer(game);
  return currentPlayer.hand.length > currentPlayer.maxHealth;
}

export function executeDiscard(game: GameState, discardIndices: number[], logger?: GameLogger): GameState {
  const currentPlayer = getCurrentPlayer(game);
  const discardedCards = discardIndices.map(i => currentPlayer.hand[i]).filter(Boolean);
  const remainingHand = currentPlayer.hand.filter((_, i) => !discardIndices.includes(i));

  const newPlayers = game.players.map(p => {
    if (p.name === currentPlayer.name) {
      return { ...p, hand: remainingHand };
    }
    return p;
  });

  const newState = {
    ...game,
    players: newPlayers,
    discardPile: [...game.discardPile, ...discardedCards],
  };

  if (logger) {
    logger.logServerOp('discard', {
      player: currentPlayer.name,
      cards: discardedCards.map(c => ({ name: c.name, suit: c.suit, rank: c.rank })),
    }, `${currentPlayer.name} 弃了 ${discardedCards.length} 张牌`);
    logger.logPlayerOp(currentPlayer.name, 'discard', {
      player: currentPlayer.name,
      cards: discardedCards.map(c => ({ name: c.name, suit: c.suit, rank: c.rank })),
    }, `你弃了 ${discardedCards.map(c => c.name).join('、')}`);
  }

  return newState;
}
