import type { GameState } from '../../engine/types';
import type { GameLog } from '../../engine/util/log';
import { downloadJson, readJsonFile, JsonValidationError } from './jsonFile';

export function saveState(state: GameState): void {
  downloadJson(`sanguosha_${state.meta.createdAt}.json`, state);
}

export function loadState(file: File): Promise<GameState> {
  return readJsonFile<GameState>(file);
}

function validateGameLog(obj: unknown): obj is GameLog {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  if (typeof o['meta'] !== 'object' || o['meta'] === null) return false;
  if (!Array.isArray(o['serverOps'])) return false;
  if (typeof o['playerOps'] !== 'object' || o['playerOps'] === null) return false;
  return true;
}

export function saveLog(log: GameLog): void {
  downloadJson(`sanguosha-log-${Date.now()}.json`, log, true);
}

export function loadLog(file: File): Promise<GameLog> {
  // 校验失败时替换为 GameLog 专用文案(历史行为)
  return readJsonFile(file, validateGameLog).catch((err) => {
    if (err instanceof JsonValidationError) {
      throw new Error('Invalid GameLog structure: missing meta, serverOps, or playerOps');
    }
    throw err;
  });
}
