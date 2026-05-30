import type { GameState, Atom, AtomDefinition, AtomEventResult, ServerEvent } from './types';

const registry = new Map<string, AtomDefinition>();

export function registerAtom<A>(def: AtomDefinition<A>): void {
  if (registry.has(def.type)) {
    throw new Error(`Atom type "${def.type}" already registered`);
  }
  registry.set(def.type, def as AtomDefinition);
}

export function getAtomDef(type: string): AtomDefinition {
  const def = registry.get(type);
  if (!def) throw new Error(`Unknown atom type: "${type}"`);
  return def;
}

export function applyAtom(state: GameState, atom: Atom): GameState {
  return getAtomDef(atom.type).apply(state, atom);
}

export function atomToEvents(state: GameState, atom: Atom): AtomEventResult {
  return getAtomDef(atom.type).toEvents(state, atom);
}

export interface BroadcastResult {
  state: GameState;
  playerEvents: Map<string, import('./types').PlayerEvent[]>;
}

export function broadcast(state: GameState, atoms: Atom[]): BroadcastResult {
  const playerEvents = new Map<string, import('./types').PlayerEvent[]>();

  for (const player of state.playerOrder) {
    playerEvents.set(player, []);
  }

  let s = state;
  for (const atom of atoms) {
    const [serverEvent, playerMap, defaultEvent] = atomToEvents(s, atom);

    s = {
      ...s,
      serverLog: [...s.serverLog, serverEvent],
    };

    for (const player of s.playerOrder) {
      const specific = playerMap.get(player);
      if (specific) {
        playerEvents.get(player)!.push(specific);
      } else if (defaultEvent) {
        playerEvents.get(player)!.push(defaultEvent);
      }
    }

    s = applyAtom(s, atom);
  }

  return { state: s, playerEvents };
}
