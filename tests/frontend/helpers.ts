import type { PlayerEvent, Json } from '@engine/types';
import type {
  FrontendState,
  PlayerView,
  SelfView,
  OtherPlayerView,
  CardInfo,
  TableView,
  TurnView,
} from '@engine/view/types';

let eventCounter = 0;

export function resetEventCounter(start = 0) {
  eventCounter = start;
}

function defaultCardInfo(cardId: string): CardInfo {
  return {
    id: cardId,
    name: '杀',
    type: '基本牌',
    subtype: '杀',
    suit: '♠',
    rank: 'A',
    description: '',
  };
}

function makeSelfView(hand: string[]): SelfView {
  return {
    hand: hand.map(id => defaultCardInfo(id)),
    equipment: { weapon: null, armor: null, mount: null },
    health: 4,
    maxHealth: 4,
    pendingTricks: [],
    tags: [],
    vars: {},
    alive: true,
  };
}

function makeOtherView(handCount: number): OtherPlayerView {
  return {
    handCount,
    equipment: { weapon: null, armor: null, mount: null },
    health: 4,
    maxHealth: 4,
    pendingTrickCount: 0,
    alive: true,
  };
}

export function createFrontend(
  playerConfigs: Record<string, { health?: number; maxHealth?: number; hand?: string[] }>,
  myPlayerId: string,
): FrontendState {
  const playerIds = Object.keys(playerConfigs);
  const firstPlayer = playerIds[0];
  const myConfig = playerConfigs[myPlayerId];
  if (!myConfig) throw new Error(`createFrontend: myPlayerId "${myPlayerId}" not in playerConfigs`);

  const self: SelfView = {
    ...makeSelfView(myConfig.hand ?? []),
    health: myConfig.health ?? 4,
    maxHealth: myConfig.maxHealth ?? 4,
  };

  const others: Record<string, OtherPlayerView> = {};
  for (const otherPid of playerIds) {
    if (otherPid === myPlayerId) continue;
    const otherConfig = playerConfigs[otherPid];
    others[otherPid] = {
      ...makeOtherView(otherConfig?.hand?.length ?? 0),
      health: otherConfig?.health ?? 4,
      maxHealth: otherConfig?.maxHealth ?? 4,
    };
  }

  return {
    view: {
      self,
      others,
      table: { discardPileCount: 0, deckCount: 80 },
      turn: { phase: '出牌', currentPlayer: firstPlayer, killsPlayed: 0 },
      pending: null,
    },
    myPlayerId,
    animationQueue: [],
  };
}

export function makeView(overrides?: {
  self?: Partial<SelfView>;
  others?: Record<string, OtherPlayerView>;
  table?: Partial<TableView>;
  turn?: Partial<TurnView>;
}): PlayerView {
  const defaults: PlayerView = {
    self: makeSelfView([]),
    others: {},
    table: { discardPileCount: 0, deckCount: 80 },
    turn: { phase: '出牌', currentPlayer: 'P1', killsPlayed: 0 },
    pending: null,
  };
  if (!overrides) return defaults;
  return {
    self: overrides.self ? { ...defaults.self, ...overrides.self } : defaults.self,
    others: { ...defaults.others, ...overrides.others },
    table: overrides.table ? { ...defaults.table, ...overrides.table } : defaults.table,
    turn: overrides.turn ? { ...defaults.turn, ...overrides.turn } : defaults.turn,
    pending: null,
  };
}

export function makePlayerEvent(
  type: string,
  payload?: Json,
): PlayerEvent {
  return {
    id: `evt-${++eventCounter}`,
    type,
    timestamp: Date.now(),
    payload: payload ?? {},
  };
}

export function cloneFrontend(fe: FrontendState): FrontendState {
  return JSON.parse(JSON.stringify(fe));
}
