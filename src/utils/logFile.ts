import type { GameLog } from '../../shared/log';
import { GameLogger } from '../../engine/logger';

export function saveLog(log: GameLog): void {
  const json = JSON.stringify(log, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sanguosha_${log.meta.createdAt}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadLog(file: File): Promise<GameLog> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        resolve(GameLogger.import(data));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
