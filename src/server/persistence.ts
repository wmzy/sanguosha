// src/server/persistence.ts
// 切到新 ENGINE-DESIGN:序列化 GameState + ActionLogEntry[] 到磁盘
import { writeFile, readFile, unlink, mkdir, readdir, stat } from 'node:fs/promises';
import type { ActionLogEntry, GameState } from '../engine/types';
import { register as registerLifecycle } from './lifecycles';
import { createLogger } from './logger';

const DATA_DIR = join(process.cwd(), 'data', 'rooms');

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

export interface PlayerConfig {
  name: string;
  characterId: string;
  role: string;
}

interface PersistedWrapper {
  roomName: string;
  maxPlayers: number;
  hostId: string | null;
  debug: boolean;
  players: PlayerConfig[];
  seed: number;
  actionLog: ActionLogEntry[];
  state: GameState;
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
  if (typeof v['state'] !== 'object' || v['state'] === null) return false;
  if (typeof v['savedAt'] !== 'number') return false;
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
  actionLog: ActionLogEntry[];
  state: GameState;
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
  actionLog: ActionLogEntry[],
  immediate = false,
): Promise<void> {
  await ensureDir();
  const wrapper: PersistedWrapper = {
    roomName: meta.roomName,
    maxPlayers: meta.maxPlayers,
    hostId: meta.hostId,
    debug: meta.debug,
    players: state.players.map(p => ({
      name: p.name,
      characterId: p.character,
      role: '主公',
    })),
    seed: state.rngSeed,
    actionLog: [...actionLog],
    state,
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
  clearTimeout(existing);
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
    state: wrapper.state,
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
  // 直接返回持久化的 state,真正的重放由 GameSession 调新 createEngine().dispatch() 完成
  return persisted.state;
}
