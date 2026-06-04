// server/persistence.ts
import { writeFile, readFile, unlink, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameState, GameAction, ServerEvent } from '../engine/types';
import { createInitialState } from '../engine/state';
import { engine } from '../engine/engine';
import { registerCharacterTriggers } from '../engine/skill';
import { restoreEventCounterFromLog } from '../engine/event';
import { allCharacters } from '../shared/characters';
import type { Role } from '../shared/types';

const DATA_DIR = join(process.cwd(), 'data', 'rooms');

import { register as registerLifecycle } from './lifecycles';
import { createLogger } from './logger';

const log = createLogger('persistence');

const DEBOUNCE_MS = 1000;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingWrappers = new Map<string, PersistedWrapper>();

registerLifecycle('pendingTimers', pendingTimers, () => {
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
});

registerLifecycle('pendingWrappers', pendingWrappers, () => {
  pendingWrappers.clear();
});

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

async function ensureDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

function filePath(roomId: string): string {
  return join(DATA_DIR, `${roomId}.json`);
}

async function writeNow(roomId: string, wrapper: PersistedWrapper): Promise<void> {
  try {
    await writeFile(filePath(roomId), JSON.stringify(wrapper));
  } catch (err) {
    log.warn(`save failed for room ${roomId}: ${String(err)}`);
  }
}

async function readWrapperFromDisk(roomId: string): Promise<PersistedWrapper | null> {
  const path = filePath(roomId);
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedWrapper(parsed)) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    log.warn(`read failed for room ${roomId}: ${String(err)}`);
    return null;
  }
}

async function deleteFile(roomId: string): Promise<void> {
  const path = filePath(roomId);
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    log.warn(`delete failed for room ${roomId}: ${String(err)}`);
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

export async function saveRoom(
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
): Promise<void> {
  await ensureDir();
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
    await writeNow(roomId, wrapper);
    pendingWrappers.delete(roomId);
    return;
  }

  const existing = pendingTimers.get(roomId);
  if (existing) clearTimeout(existing);
  pendingTimers.set(
    roomId,
    setTimeout(async () => {
      const w = pendingWrappers.get(roomId);
      if (w) await writeNow(roomId, w);
      pendingTimers.delete(roomId);
      pendingWrappers.delete(roomId);
    }, DEBOUNCE_MS),
  );
}

export async function loadRoom(roomId: string): Promise<PersistedRoom | null> {
  const path = filePath(roomId);
  const wrapper = await readWrapperFromDisk(roomId);
  if (!wrapper) return null;
  let lastActivityAt: number;
  try {
    lastActivityAt = (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
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

export async function deletePersistedRoom(roomId: string): Promise<void> {
  const pending = pendingTimers.get(roomId);
  if (pending) {
    clearTimeout(pending);
    pendingTimers.delete(roomId);
  }
  pendingWrappers.delete(roomId);
  await deleteFile(roomId);
}

export async function listPersistedRooms(): Promise<string[]> {
  await ensureDir();
  const entries = await readdir(DATA_DIR);
  return entries.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
}

export async function flushPendingWrites(): Promise<void> {
  const writes: Promise<void>[] = [];
  for (const [roomId, wrapper] of pendingWrappers) {
    writes.push(writeNow(roomId, wrapper));
  }
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
  pendingWrappers.clear();
  await Promise.all(writes);
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
      log.warn(`replay error for room ${persisted.roomId}: ${result.error}`);
      break;
    }
    state = result.state;
  }

  restoreEventCounterFromLog(state.serverLog);
  return state;
}
