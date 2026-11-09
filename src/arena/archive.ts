import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ArenaManifest, ArenaDecisionRecord, ArenaObservation, ModelMessage } from './types';

export const DEFAULT_ARENA_DIR = resolve(process.env.SGS_ARENA_DIR ?? 'data/arena');

export function safeName(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`无效的归档标识: ${value}`);
  return value;
}

export interface PlayerContext {
  memory: string;
  messages: ModelMessage[];
}

/** One match directory; each player is the only writer of their own context and logs. */
export class ArenaArchive {
  readonly dir: string;
  constructor(readonly id: string, root = DEFAULT_ARENA_DIR) {
    this.dir = join(resolve(root), safeName(id));
    mkdirSync(this.dir, { recursive: true });
  }

  write(name: string, value: unknown): void {
    const path = join(this.dir, name);
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
  }

  append(name: string, value: unknown): void {
    const path = join(this.dir, name);
    mkdirSync(resolve(path, '..'), { recursive: true });
    appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
  }

  manifest(): ArenaManifest | null {
    const path = join(this.dir, 'manifest.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as ArenaManifest : null;
  }

  context(playerId: string): PlayerContext {
    const path = join(this.dir, 'players', safeName(playerId), 'context.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as PlayerContext : { memory: '', messages: [] };
  }

  saveContext(playerId: string, context: PlayerContext): void {
    this.write(`players/${safeName(playerId)}/context.json`, context);
  }

  observation(playerId: string, observation: ArenaObservation): void {
    this.append(`players/${safeName(playerId)}/observations.jsonl`, { at: Date.now(), ...observation });
  }

  decision(record: ArenaDecisionRecord): void {
    this.append(`players/${safeName(record.playerId)}/decisions.jsonl`, record);
  }
}
