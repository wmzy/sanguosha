// src/client/replay/replayFile.ts
// 录像文件 I/O:Blob 下载 + File 加载。
// 复用 logFile.ts 的模式(saveLog/loadLog)。

import type { ReplayFile } from './types';
import { REPLAY_FORMAT, REPLAY_VERSION } from './types';

/** 下载录像为 JSON 文件 */
export function saveReplay(file: ReplayFile): void {
  const json = JSON.stringify(file);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sanguosha-replay-${file.meta.createdAt}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 校验对象是否符合 ReplayFile 结构 */
export function isReplayFile(value: unknown): value is ReplayFile {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  if (o['format'] !== REPLAY_FORMAT) return false;
  if (o['version'] !== REPLAY_VERSION) return false;
  if (typeof o['meta'] !== 'object' || o['meta'] === null) return false;
  const meta = o['meta'] as Record<string, unknown>;
  if (typeof meta['createdAt'] !== 'number') return false;
  if (typeof meta['playerCount'] !== 'number') return false;
  if (!Array.isArray(meta['characters'])) return false;
  if (typeof o['seats'] !== 'object' || o['seats'] === null) return false;
  const seats = o['seats'] as Record<string, unknown>;
  for (const key in seats) {
    const seat = seats[key] as Record<string, unknown>;
    if (typeof seat['seatIndex'] !== 'number') return false;
    if (typeof seat['playerName'] !== 'string') return false;
    if (typeof seat['initialView'] !== 'object' || seat['initialView'] === null) return false;
    if (!Array.isArray(seat['events'])) return false;
  }
  return true;
}

/** 从文件加载录像,校验格式 */
export function loadReplay(file: File): Promise<ReplayFile> {
  const { promise, resolve, reject } = Promise.withResolvers<ReplayFile>();
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data: unknown = JSON.parse(reader.result as string);
      if (!isReplayFile(data)) {
        reject(new Error('无效的录像文件格式'));
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
