import type { GameState, Card, PendingTrick, TurnPhase } from '../shared/types';
import type { Rng } from '../shared/rng';
import { shuffle } from '../shared/deck';
import { updatePlayer, getPlayer, getAlivePlayers } from './state';
import type { GameLogger } from './logger';

export interface PendingTrickResult {
  state: GameState;
  skipPhases: TurnPhase[];
  judgeCard: Card;
}

export function performJudge(game: GameState, rng: Rng): { game: GameState; card: Card } {
  const state = ensureDeck(game, rng);
  if (state.deck.length === 0) {
    throw new Error('没有可用的牌进行判定');
  }
  const card = state.deck[0];
  return { game: { ...state, deck: state.deck.slice(1) }, card };
}

function ensureDeck(game: GameState, rng: Rng): GameState {
  if (game.deck.length > 0) return game;
  if (game.discardPile.length === 0) return game;
  const shuffled = shuffle(game.discardPile, rng);
  return { ...game, deck: shuffled, discardPile: [] };
}

export function resolvePendingTrick(
  game: GameState,
  playerName: string,
  trick: PendingTrick,
  rng: Rng,
  logger?: GameLogger,
): PendingTrickResult {
  const { game: judgedGame, card: judgeCard } = performJudge(game, rng);

  logger?.logServerOp('play', {
    player: playerName,
    card: `${judgeCard.suit}${judgeCard.rank}`,
  }, `${playerName} 判定结果: ${judgeCard.suit}${judgeCard.rank}`);

  let state = updatePlayer(judgedGame, playerName, {
    pendingTricks: (getPlayer(judgedGame, playerName).pendingTricks ?? [])
      .filter(t => t !== trick),
  });
  state = { ...state, discardPile: [...state.discardPile, judgeCard] };

  const skipPhases: TurnPhase[] = [];

  switch (trick.name) {
    case '乐不思蜀': {
      // 非♥则跳过出牌阶段
      if (judgeCard.suit !== '♥') {
        skipPhases.push('出牌');
      }
      break;
    }
    case '兵粮寸断': {
      // 非♣则跳过摸牌阶段
      if (judgeCard.suit !== '♣') {
        skipPhases.push('摸牌');
      }
      break;
    }
    case '闪电': {
      const rankValues: Record<string, number> = {
        A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
        8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13,
      };
      const rankValue = rankValues[judgeCard.rank] ?? 0;
      if (judgeCard.suit === '♠' && rankValue >= 2 && rankValue <= 9) {
        // 受3点雷电伤害
        const player = getPlayer(state, playerName);
        state = updatePlayer(state, playerName, {
          health: player.health - 3,
        });
        logger?.logServerOp('damage', {
          target: playerName, amount: 3, damageType: '雷电',
        }, `${playerName} 受到闪电3点雷电伤害`);
      } else {
        // 传给下家
        const alive = getAlivePlayers(state);
        const currentIdx = alive.findIndex(p => p.name === playerName);
        const nextIdx = (currentIdx + 1) % alive.length;
        const nextPlayer = alive[nextIdx];
        if (nextPlayer) {
          const newTrick: PendingTrick = { ...trick };
          state = updatePlayer(state, nextPlayer.name, {
            pendingTricks: [...(getPlayer(state, nextPlayer.name).pendingTricks ?? []), newTrick],
          });
        }
      }
      break;
    }
  }

  return { state, skipPhases, judgeCard };
}
