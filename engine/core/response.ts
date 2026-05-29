import type { GameState, Card, Player } from '../../shared/types';

export type ResponseWindowType = 'kill_response' | 'trick_response' | 'dying' | 'aoe_response';

export interface ResponseWindow {
  type: ResponseWindowType;
  requester: string;           // Who is waiting for responses
  validResponders: string[];   // Who can respond
  validCards: string[];        // Card names that can be played as response
  sourceCard?: Card;           // The card that triggered this response
  onResolve: (game: GameState, responses: Map<string, Card | null>) => GameState;
}

export class ResponseSystem {
  private stack: ResponseWindow[] = [];

  // Push a new response window
  push(window: ResponseWindow): void {
    this.stack.push(window);
  }

  // Resolve the top response window
  resolve(game: GameState, responses: Map<string, Card | null>): GameState {
    const window = this.stack.pop();
    if (!window) return game;
    return window.onResolve(game, responses);
  }

  // Get the current pending response window
  current(): ResponseWindow | undefined {
    return this.stack[this.stack.length - 1];
  }

  // Check if there's a pending response
  hasPending(): boolean {
    return this.stack.length > 0;
  }

  // Get players who need to respond
  getPendingResponders(): string[] {
    const window = this.current();
    return window?.validResponders ?? [];
  }

  isEmpty(): boolean {
    return this.stack.length === 0;
  }
}

// ============================================================
// Pre-built response windows
// ============================================================

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
    onResolve: (game, responses) => {
      const dodgeCard = responses.get(target);
      if (dodgeCard) {
        // 杀被闪避
        return {
          ...game,
          players: game.players.map(p => {
            if (p.name === target) {
              const idx = p.hand.findIndex(c => c.name === '闪');
              if (idx >= 0) {
                const newHand = [...p.hand];
                newHand.splice(idx, 1);
                return { ...p, hand: newHand };
              }
            }
            return p;
          }),
        };
      }
      // 杀命中，扣血
      return {
        ...game,
        players: game.players.map(p =>
          p.name === target ? { ...p, health: p.health - 1 } : p,
        ),
      };
    },
  };
}

export function createTrickResponseWindow(
  source: string,
  trickName: string,
  target?: string,
): ResponseWindow {
  return {
    type: 'trick_response',
    requester: source,
    validResponders: [], // All players can respond with 无懈可击
    validCards: ['无懈可击'],
    onResolve: (game, responses) => {
      // Check if anyone played 无懈可击
      const nullified = Array.from(responses.values()).some(c => c?.name === '无懈可击');
      if (nullified) {
        // Trick is nullified, no effect
        return game;
      }
      // Trick proceeds normally (caller handles the effect)
      return game;
    },
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
    onResolve: (game, responses) => {
      // Check if anyone played 桃
      for (const [playerName, card] of responses) {
        if (card?.name === '桃') {
          // Player is saved
          return {
            ...game,
            players: game.players.map(p => {
              const isDying = p.name === dyingPlayer;
              const isSavior = p.name === playerName;
              if (!isDying && !isSavior) return p;

              const updates: Partial<Player> = {};
              if (isDying) {
                updates.health = 1;
                updates.alive = true;
              }
              if (isSavior) {
                const idx = p.hand.findIndex(c => c.name === '桃');
                if (idx >= 0) {
                  const newHand = [...p.hand];
                  newHand.splice(idx, 1);
                  updates.hand = newHand;
                }
              }
              return { ...p, ...updates };
            }),
          };
        }
      }
      // No one saved, player dies
      return {
        ...game,
        players: game.players.map(p =>
          p.name === dyingPlayer ? { ...p, alive: false, health: 0 } : p,
        ),
      };
    },
  };
}
