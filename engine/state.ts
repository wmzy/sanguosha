import type { Card } from '../shared/types';
import { createStandardDeck, shuffle } from '../shared/deck';
import { createRng } from '../shared/rng';
import type { GameState, PlayerState, GameZones, TurnState, GameMeta } from './types';

export interface GameConfig {
  players: Array<{
    name: string;
    characterId: string;
    role: import('../shared/types').Role;
  }>;
  seed: number;
  characterMap: Record<string, import('../shared/types').CharacterConfig>;
}

export function createInitialState(config: GameConfig): GameState {
  const rng = createRng(config.seed);
  const deckCards = shuffle(createStandardDeck(), rng);
  const rngState = rng.getState();
  const cardMap: Record<string, Card> = {};
  const deckIds: string[] = [];
  for (const card of deckCards) {
    cardMap[card.id] = card;
    deckIds.push(card.id);
  }

  const players: Record<string, PlayerState> = {};
  const playerOrder: string[] = [];
  const handSize = 4;
  let deckIdx = 0;

  for (const p of config.players) {
    const char = config.characterMap[p.characterId];
    if (!char) throw new Error(`Unknown character: ${p.characterId}`);

    playerOrder.push(p.name);
    const hand = deckIds.slice(deckIdx, deckIdx + handSize);
    deckIdx += handSize;

    players[p.name] = {
      info: {
        name: p.name,
        characterId: p.characterId,
        role: p.role,
        alive: true,
        gender: char.gender,
        faction: char.faction,
      },
      health: char.maxHealth,
      maxHealth: char.maxHealth,
      hand,
      equipment: {},
      pendingTricks: [],
      vars: {},
      tags: [],
      chained: false,
    };
  }

  const zones: GameZones = { deck: deckIds.slice(deckIdx), discardPile: [] };
  const turn: TurnState = { killsPlayed: 0, skillsUsed: [], turnStarted: false };
  const meta: GameMeta = {
    id: `game_${Date.now().toString(36)}_${config.seed.toString(36)}`,
    seed: config.seed,
    round: 1,
    turnNumber: 0,
    status: '进行中',
    createdAt: Date.now(),
    playerCount: config.players.length,
    autoSkipWuxie: false,
  };

  return {
    meta,
    phase: '准备',
    currentPlayer: playerOrder[0],
    playerOrder,
    players,
    zones,
    cardMap,
    turn,
    pending: null,
    triggers: [],
    marks: {},
    serverLog: [],
    playerLogs: Object.fromEntries(playerOrder.map(name => [name, []])),
    rngState,
  };
}

export function getPlayer(state: GameState, name: string): PlayerState {
  return state.players[name];
}

export function getAlivePlayers(state: GameState): PlayerState[] {
  return state.playerOrder
    .map(name => state.players[name])
    .filter(p => p.info.alive);
}

export function getAlivePlayerNames(state: GameState): string[] {
  return state.playerOrder.filter(name => state.players[name].info.alive);
}

export function getCard(state: GameState, cardId: string): Card {
  return state.cardMap[cardId];
}

export function updatePlayer(
  state: GameState,
  name: string,
  updater: (p: PlayerState) => Partial<PlayerState>,
): GameState {
  const player = state.players[name];
  const updated = { ...player, ...updater(player) };
  return { ...state, players: { ...state.players, [name]: updated } };
}

export function updatePlayers(
  state: GameState,
  updates: Record<string, Partial<PlayerState>>,
): GameState {
  const players = { ...state.players };
  for (const [name, partial] of Object.entries(updates)) {
    players[name] = { ...players[name], ...partial };
  }
  return { ...state, players };
}

export function nextRngState(state: GameState): { state: GameState; rng: import('../shared/rng').Rng } {
  const rng = createRng(state.rngState);
  rng.next();
  return { state: { ...state, rngState: rng.getState() }, rng };
}

/** 身份局胜利条件检查。返回 { winner, reason } 或 null。 */
export function checkWinCondition(
  state: GameState,
): { winner: string; reason: string } | null {
  if (state.meta.status === '已结束') return null;

  const alive = getAlivePlayers(state);
  const aliveByRole = groupAliveByRole(alive);

  for (const rule of WIN_RULES) {
    const result = rule(alive, aliveByRole);
    if (result !== null) return result;
  }

  return null;
}

interface AliveByRole {
  lord: PlayerState | undefined;
  loyalists: PlayerState[];
  rebels: PlayerState[];
  spy: PlayerState | undefined;
}

function groupAliveByRole(alive: PlayerState[]): AliveByRole {
  return {
    lord: alive.find(p => p.info.role === '主公'),
    loyalists: alive.filter(p => p.info.role === '忠臣'),
    rebels: alive.filter(p => p.info.role === '反贼'),
    spy: alive.find(p => p.info.role === '内奸'),
  };
}

type WinResult = { winner: string; reason: string } | null;
type WinRule = (
  alive: PlayerState[],
  roles: AliveByRole,
) => WinResult;

const WIN_RULES: WinRule[] = [
  (alive) => {
    if (alive.length === 0) {
      return { winner: '无', reason: '平局：所有玩家阵亡' };
    }
    return null;
  },

  (_alive, roles) => {
    if (roles.lord == null && roles.spy != null && roles.rebels.length === 0 && roles.loyalists.length === 0) {
      return { winner: roles.spy.info.name, reason: '内奸获胜：主公阵亡，内奸是唯一存活者' };
    }
    return null;
  },

  (_alive, roles) => {
    if (roles.lord == null) {
      return { winner: '反贼', reason: '反贼获胜：主公阵亡' };
    }
    return null;
  },

  (alive, roles) => {
    const isLordVsSpyShowdown =
      roles.rebels.length === 0 &&
      roles.spy != null &&
      roles.loyalists.length === 0 &&
      alive.length === 2;
    if (roles.rebels.length === 0 && !isLordVsSpyShowdown) {
      return { winner: '主公', reason: '主公阵营获胜：所有反贼阵亡' };
    }
    return null;
  },
];
