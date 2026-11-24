// server/fsAtomic.ts — 原子写盘的单点封装(tmp + rename)。
// 用于「崩溃时读到半截 JSON」会造成静默数据丢失的文件:房间快照、历史索引、
// 录像。与 persistence.writeNow 原实现逐字同语义(同目录 tmp、失败清 tmp、
// rename 原子替换),只是抽出来供多个模块共用。
import { writeFile, rename, unlink } from 'node:fs/promises';

/** 原子写:先写同目录临时文件再 rename。rename 在同一文件系统内是原子的,
 *  崩溃/断电时目标文件要么是旧内容、要么是新内容,不会是截断的半截 JSON。
 *  失败时尽力清理临时文件,并原样抛出(调用方决定上报/重试)。 */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, data);
    await rename(tempPath, path);
  } catch (err) {
    try {
      await unlink(tempPath);
    } catch {
      // 临时文件清理失败不覆盖原始写入错误
    }
    throw err;
  }
}
