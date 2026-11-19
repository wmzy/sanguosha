// src/client/replay/replayFile.ts
// 录像文件 I/O:委托 utils/jsonFile 完成下载/读取,校验逻辑留在本文件。

import type { ReplayFile } from './types';
import { REPLAY_FORMAT, REPLAY_VERSION } from './types';
import { downloadJson, readJsonFile, JsonValidationError } from '../utils/jsonFile';

/** 下载录像为 JSON 文件 */
export function saveReplay(file: ReplayFile): void {
  downloadJson(`sanguosha-replay-${file.meta.createdAt}.json`, file);
}

/** 校验对象是否符合 ReplayFile 结构(v2: baseline + delta) */
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
  // baseline 必须存在且含 cardMap/players
  if (typeof o['baseline'] !== 'object' || o['baseline'] === null) return false;
  const baseline = o['baseline'] as Record<string, unknown>;
  if (typeof baseline['cardMap'] !== 'object' || baseline['cardMap'] === null) return false;
  if (!Array.isArray(baseline['players'])) return false;
  if (typeof o['seats'] !== 'object' || o['seats'] === null) return false;
  const seats = o['seats'] as Record<string, unknown>;
  for (const key in seats) {
    const seat = seats[key] as Record<string, unknown>;
    if (typeof seat['viewer'] !== 'number') return false;
    if (typeof seat['playerName'] !== 'string') return false;
    if (!Array.isArray(seat['privateHands'])) return false;
    if (!Array.isArray(seat['identityView'])) return false;
    if (!Array.isArray(seat['events'])) return false;
  }
  return true;
}

/** 从文件加载录像,校验格式 */
export function loadReplay(file: File): Promise<ReplayFile> {
  // 校验失败时替换为录像专用文案(历史行为)
  return readJsonFile(file, isReplayFile).catch((err) => {
    if (err instanceof JsonValidationError) {
      throw new Error('无效的录像文件格式');
    }
    throw err;
  });
}
