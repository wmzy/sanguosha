// server/persistence.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState, GameAction, ServerEvent } from '../engine/types';
import { createInitialState } from '../engine/state';
import { engine } from '../engine/engine';
import { registerCharacterTriggers } from '../engine/skill';
import { restoreEventCounterFromLog } from '../engine/event';
import { allCharacters } from '../shared/characters';
import type { Role } from '../shared/types';

const DATA_DIR = join(process.cwd(), 'data', 'rooms');

const DEBOUNCE_MS = 1000;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingWrappers = new Map<string, PersistedWrapper>();

const characterMap = Object.fromEntries(allCharacters.map(c => [c.name, c]));

export interface PlayerConfig {
  name: string;
  characterId: string;
  role: Role;
}

interface PersistedWrapper {
  roomName: string;
  maxPlayers: number;
  hostId: string | null;
  debug: boolean;
  players: PlayerConfig[];
  seed: number;
  actionLog: GameAction[];
  serverLog: ServerEvent[];
  savedAt: number;
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(roomId: string): string {
  return join(DATA_DIR, `${roomId}.json`);
}

function writeNow(roomId: string, wrapper: PersistedWrapper): void {
  try {
    writeFileSync(filePath(roomId), JSON.stringify(wrapper));
  } catch (err) {
    console.warn(`[persistence] save failed for room ${roomId}: ${String(err)}`);
  }
}

function readWrapperFromDisk(roomId: string): PersistedWrapper | null {
  const path = filePath(roomId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedWrapper(parsed)) return null;
    return parsed;
  } catch (err) {
    console.warn(`[persistence] read failed for room ${roomId}: ${String(err)}`);
    return null;
  }
}

function isPersistedWrapper(value: unknown): value is PersistedWrapper {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['roomName'] !== 'string') return false;
  if (typeof v['maxPlayers'] !== 'number') return false;
  if (v['hostId'] !== null && typeof v['hostId'] !== 'string') return false;
  if (typeof v['debug'] !== 'boolean') return false;
  if (!Array.isArray(v['players'])) return false;
  if (typeof v['seed'] !== 'number') return false;
  if (!Array.isArray(v['actionLog'])) return false;
  if (!Array.isArray(v['serverLog'])) return false;
  if (typeof v['savedAt'] !== 'number') return false;
  for (const p of v['players']) {
    if (typeof p !== 'object' || p === null) return false;
    const pp = p as Record<string, unknown>;
    if (typeof pp['name'] !== 'string') return false;
    if (typeof pp['characterId'] !== 'string') return false;
    if (typeof pp['role'] !== 'string') return false;
  }
  for (const a of v['actionLog']) {
    if (typeof a !== 'object' || a === null) return false;
    const aa = a as Record<string, unknown>;
    if (typeof aa['type'] !== 'string') return false;
  }
  return true;
}

export interface PersistedRoom {
  roomId: string;
  roomName: string;
  maxPlayers: number;
  hostId: string | null;
  debug: boolean;
  players: PlayerConfig[];
  seed: number;
  actionLog: GameAction[];
  serverLog: ServerEvent[];
  savedAt: number;
  lastActivityAt: number;
}

export function saveRoom(
  roomId: string,
  meta: {
    roomName: string;
    maxPlayers: number;
    hostId: string | null;
    debug: boolean;
  },
  state: GameState,
  actionLog: GameAction[],
  immediate = false,
): void {
  ensureDir();
  const wrapper: PersistedWrapper = {
    roomName: meta.roomName,
    maxPlayers: meta.maxPlayers,
    hostId: meta.hostId,
    debug: meta.debug,
    players: state.playerOrder.map(name => {
      const p = state.players[name];
      return {
        name: p.info.name,
        characterId: p.info.characterId,
        role: p.info.role,
      };
    }),
    seed: state.meta.seed,
    actionLog: [...actionLog],
    serverLog: state.serverLog,
    savedAt: Date.now(),
  };
  pendingWrappers.set(roomId, wrapper);

  if (immediate) {
    const existing = pendingTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      pendingTimers.delete(roomId);
    }
    writeNow(roomId, wrapper);
    pendingWrappers.delete(roomId);
    return;
  }

  const existing = pendingTimers.get(roomId);
  if (existing) clearTimeout(existing);
  pendingTimers.set(
    roomId,
    setTimeout(() => {
      const w = pendingWrappers.get(roomId);
      if (w) writeNow(roomId, w);
      pendingTimers.delete(roomId);
      pendingWrappers.delete(roomId);
    }, DEBOUNCE_MS),
  );
}

export function loadRoom(roomId: string): PersistedRoom | null {
  const path = filePath(roomId);
  if (!existsSync(path)) return null;
  const wrapper = readWrapperFromDisk(roomId);
  if (!wrapper) return null;
  const lastActivityAt = statSync(path).mtimeMs;
  return {
    roomId,
    roomName: wrapper.roomName,
    maxPlayers: wrapper.maxPlayers,
    hostId: wrapper.hostId,
    debug: wrapper.debug,
    players: wrapper.players,
    seed: wrapper.seed,
    actionLog: wrapper.actionLog,
    serverLog: wrapper.serverLog,
    savedAt: wrapper.savedAt,
    lastActivityAt,
  };
}

export function deletePersistedRoom(roomId: string): void {
  const pending = pendingTimers.get(roomId);
  if (pending) {
    clearTimeout(pending);
    pendingTimers.delete(roomId);
  }
  pendingWrappers.delete(roomId);
  const path = filePath(roomId);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch (err) {
      console.warn(`[persistence] delete failed for room ${roomId}: ${String(err)}`);
    }
  }
}

export function listPersistedRooms(): string[] {
  ensureDir();
  return readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

export function flushPendingWrites(): void {
  for (const [roomId, wrapper] of pendingWrappers) {
    writeNow(roomId, wrapper);
  }
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
  pendingWrappers.clear();
}

export function _pendingWriteCount(): number {
  return pendingTimers.size;
}

export function restoreToState(persisted: PersistedRoom): GameState {
  let state = createInitialState({
    players: persisted.players,
    seed: persisted.seed,
    characterMap,
  });

  for (const playerName of state.playerOrder) {
    state = registerCharacterTriggers(state, playerName, { characterMap });
  }

  for (const action of persisted.actionLog) {
    const result = engine(state, action);
    if (result.error) {
      console.warn(`[persistence] replay error for room ${persisted.roomId}: ${result.error}`);
      break;
    }
    state = result.state;
  }

  restoreEventCounterFromLog(state.serverLog);
  return state;
}
