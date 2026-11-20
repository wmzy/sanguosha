// src/server/fsQuiet.ts — 「文件不存在 → 静默」类 fs 读写的共享封装。
//
// 共同约定:ENOENT 一律静默返回 null/false(不记日志、不抛出);其它错误原样
// 抛给调用方,由各站点保留自己既有的日志+抛出/吞错语义(persistence 记日志后
// normalizeError 抛出、gameHistory 记日志后回空值)——不为统一而改行为。

import { readFile, unlink } from 'node:fs/promises';

/** 读取并 JSON.parse 指定文件。文件不存在(ENOENT)→ null(静默);
 *  其它读盘/解析错误原样抛出,日志与吞/抛由调用方决定。 */
export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** 删除指定文件。文件原本存在且删除成功 → true;不存在(ENOENT)→ false(静默);
 *  其它错误原样抛出,日志与吞/抛由调用方决定。 */
export async function unlinkIfExists(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
