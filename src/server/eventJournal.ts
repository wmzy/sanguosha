// src/server/eventJournal.ts — 事件 journal 持久化层。
//
// atomHistory 在内存只保留活跃窗口(session 层按水位裁剪,见 session.trimAtomHistory),
// 被裁掉的条目以 append-only JSONL 落盘到 data/rooms/<roomId>.events.jsonl,
// 完整事件流(全部局)可事后审计。写入 fire-and-forget:失败只记日志,绝不影响对局。
//
// 生命周期:
// - 每局开始(startGame/restoreState)resetEventJournal 清空,epoch 变化重新计数;
// - 裁剪时 appendEventJournal 追加被裁条目(每行 { epoch, ...entry });
// - 房间清理统一走 persistence.deletePersistedRoom(内部 await removeEventJournal)。
//
// 并发模型:per-room 串行链(serialChain.ts 共享实现)——append 与删除
// 按到达顺序执行,删除必等在途 append 完成,避免「rm 先完成、appendFile 后落盘」
// 留下孤儿 journal。
//
// 注:本模块 import snapshot 的 serializeAtomHistory,snapshot 又 import persistence,
// persistence import 本模块 —— 构成 persistence→eventJournal→snapshot→persistence 的
// 函数级循环依赖(所有交叉引用均在函数体内调用,模块求值期无访问,ESM 下安全)。

import { appendFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppliedAtomEntry } from '../engine/types';
import { serializeAtomHistory } from './snapshot';
import { createLogger } from './logger';
import { register as registerLifecycle } from './resourceRegistry';
import { createRoomSerialChain } from './serialChain';
import { isSafeRoomId } from './safeId';

const log = createLogger('eventJournal');

const DATA_DIR = join(process.cwd(), 'data', 'rooms');

/** 已确认存在的 journal 目录(避免每次 append 都 mkdir)。 */
const ensuredDirs = new Set<string>();

/** 每房间 journal IO 串行链:失败不阻断后续,只记 error(对局不受磁盘故障影响)。 */
const { chains, enqueue } = createRoomSerialChain('eventJournalChains', {
  onError: (roomId, err) => log.err(`journal io failed for room ${roomId}`, err),
});

registerLifecycle('eventJournalChains', chains, () => {
  chains.clear();
});

function journalPath(roomId: string): string | null {
  if (!isSafeRoomId(roomId)) {
    log.warn(`拒绝为非法 roomId 生成 journal 路径: ${roomId}`);
    return null;
  }
  return join(DATA_DIR, `${roomId}.events.jsonl`);
}

/** 追加被裁剪的 atomHistory 条目到 journal,每行 JSON:{ epoch, ...entry }。
 *  序列化同步完成(调用方随后可能 mutate 数组);磁盘写入 fire-and-forget:
 *  失败仅记 error,不抛出(对局不受磁盘故障影响)。 */
export function appendEventJournal(
  roomId: string,
  epoch: number,
  entries: AppliedAtomEntry[],
): void {
  if (entries.length === 0) return;
  const path = journalPath(roomId);
  if (!path) return;
  // 同步序列化:不能让落盘链读取已被 splice/mutate 的源数组
  const payload =
    `${serializeAtomHistory(entries)
      .map((entry) => JSON.stringify({ epoch, ...entry }))
      .join('\n')  }\n`;
  void enqueue(roomId, async () => {
    const dir = dirname(path);
    if (!ensuredDirs.has(dir)) {
      await mkdir(dir, { recursive: true });
      ensuredDirs.add(dir);
    }
    await appendFile(path, payload, 'utf-8');
  });
}

/** 删除 journal 文件(幂等,文件不存在时静默)。入串行链:先等在途 append 落盘再删,
 *  杜绝 rm/append 竞态留下的孤儿文件;失败仅记 error,不抛出。 */
export async function removeEventJournal(roomId: string): Promise<void> {
  const path = journalPath(roomId);
  if (!path) return;
  await enqueue(roomId, () => rm(path, { force: true }));
}

/** 新一局 journal 重新开始(epoch 变化,旧局条目作废)。fire-and-forget 删除旧 journal。 */
export function resetEventJournal(roomId: string): void {
  void removeEventJournal(roomId);
}
