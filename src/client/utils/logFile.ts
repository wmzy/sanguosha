import type { GameState } from '../../engine/types';
import type { GameLog } from '../../shared/log';

export function saveState(state: GameState): void {
  const json = JSON.stringify(state);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sanguosha_${state.meta.createdAt}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadState(file: File): Promise<GameState> {
  const { promise, resolve, reject } = Promise.withResolvers<GameState>();
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as GameState;
      resolve(data);
    } catch (e) {
      reject(e);
    }
  };
  reader.onerror = reject;
  reader.readAsText(file);
  return promise;
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
  const json = JSON.stringify(log, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sanguosha-log-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadLog(file: File): Promise<GameLog> {
  const { promise, resolve, reject } = Promise.withResolvers<GameLog>();
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data: unknown = JSON.parse(reader.result as string);
      if (!validateGameLog(data)) {
        reject(new Error('Invalid GameLog structure: missing meta, serverOps, or playerOps'));
        return;
      }
      resolve(data);
    } catch (e) {
      reject(e);
    }
  };
  reader.onerror = reject;
  reader.readAsText(file);
  return promise;
}
