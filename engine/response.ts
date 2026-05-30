import type { GameState, Card } from '../shared/types';
import type { ResponseWindow } from './types';
import { getPlayer, updatePlayer, getAlivePlayers } from './state';
import { playerDeath } from './state';

export type { ResponseWindow };

export class ResponseSystem {
  private stack: ResponseWindow[] = [];

  push(window: ResponseWindow): void {
    this.stack.push(window);
  }

  pop(): ResponseWindow | undefined {
    return this.stack.pop();
  }

  current(): ResponseWindow | undefined {
    return this.stack[this.stack.length - 1];
  }

  hasPending(): boolean {
    return this.stack.length > 0;
  }

  getPendingResponders(): string[] {
    return this.current()?.validResponders ?? [];
  }

  isEmpty(): boolean {
    return this.stack.length === 0;
  }
}

export function createKillResponseWindow(
  attacker: string,
  target: string,
  sourceCard: Card,
): ResponseWindow {
  return {
    type: 'kill_response',
    requester: attacker,
    validResponders: [target],
    validCards: ['闪'],
    sourceCard,
  };
}

export function createAOEResponseWindow(
  source: string,
  targets: string[],
  responseType: '闪' | '杀',
): ResponseWindow {
  return {
    type: 'aoe_response',
    requester: source,
    validResponders: targets,
    validCards: [responseType],
    aoeResponseType: responseType,
  };
}

export function createDyingResponseWindow(
  dyingPlayer: string,
  allPlayers: string[],
): ResponseWindow {
  return {
    type: 'dying',
    requester: dyingPlayer,
    validResponders: allPlayers,
    validCards: ['桃'],
  };
}

export function createTrickResponseWindow(
  source: string,
): ResponseWindow {
  return {
    type: 'trick_response',
    requester: source,
    validResponders: [],
    validCards: ['无懈可击'],
  };
}

export function resolveKillResponse(
  game: GameState,
  window: ResponseWindow,
  responses: Map<string, Card | null>,
): GameState {
  const target = window.validResponders[0];
  const dodgeCard = responses.get(target);
  if (dodgeCard) {
    const targetPlayer = getPlayer(game, target);
    const idx = targetPlayer.hand.findIndex(c => c.id === dodgeCard.id);
    if (idx >= 0) {
      const newHand = [...targetPlayer.hand];
      newHand.splice(idx, 1);
      return {
        ...updatePlayer(game, target, { hand: newHand }),
        discardPile: [...game.discardPile, dodgeCard],
      };
    }
  }
  const targetPlayer = getPlayer(game, target);
  return updatePlayer(game, target, { health: targetPlayer.health - 1 });
}

export function resolveAOEResponse(
  game: GameState,
  window: ResponseWindow,
  responses: Map<string, Card | null>,
): GameState {
  let state = game;
  for (const targetName of window.validResponders) {
    const responseCard = responses.get(targetName);
    if (responseCard) {
      const player = getPlayer(state, targetName);
      const idx = player.hand.findIndex(c => c.id === responseCard.id);
      if (idx >= 0) {
        const newHand = [...player.hand];
        newHand.splice(idx, 1);
        state = {
          ...updatePlayer(state, targetName, { hand: newHand }),
          discardPile: [...state.discardPile, responseCard],
        };
        continue;
      }
    }
    const player = getPlayer(state, targetName);
    state = updatePlayer(state, targetName, {
      health: player.health - 1,
    });
  }
  return state;
}

export function resolveDyingResponse(
  game: GameState,
  window: ResponseWindow,
  responses: Map<string, Card | null>,
  logger?: import('./logger').GameLogger,
): GameState {
  const dyingPlayer = window.requester;
  for (const [playerName, card] of responses) {
    if (card?.name === '桃') {
      const savior = getPlayer(game, playerName);
      const idx = savior.hand.findIndex(c => c.id === card.id);
      if (idx >= 0) {
        const newHand = [...savior.hand];
        newHand.splice(idx, 1);
        let state = updatePlayer(game, playerName, { hand: newHand });
        state = updatePlayer(state, dyingPlayer, {
          health: 1,
          alive: true,
        });
        return {
          ...state,
          discardPile: [...state.discardPile, card],
        };
      }
    }
  }
  let state = updatePlayer(game, dyingPlayer, { alive: false, health: 0 });
  state = playerDeath(state, dyingPlayer, logger);
  return state;
}

export function resolveTrickResponse(
  game: GameState,
  responses: Map<string, Card | null>,
): { state: GameState; nullified: boolean } {
  for (const [playerName, card] of responses) {
    if (card?.name === '无懈可击') {
      const player = getPlayer(game, playerName);
      const idx = player.hand.findIndex(c => c.id === card.id);
      if (idx >= 0) {
        const newHand = [...player.hand];
        newHand.splice(idx, 1);
        return {
          state: {
            ...updatePlayer(game, playerName, { hand: newHand }),
            discardPile: [...game.discardPile, card],
          },
          nullified: true,
        };
      }
    }
  }
  return { state: game, nullified: false };
}
