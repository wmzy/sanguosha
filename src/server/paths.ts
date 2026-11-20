// src/server/paths.ts — 服务端落盘目录单点。
// 各模块的 data/ 子树目录推导只允许存在这一份,防多处各自 join(process.cwd(), ...)
// 漂移到不同根(或用相对路径时漂到任意 CWD)。

import { join, resolve } from 'node:path';

/** 房间持久化数据根目录:<roomId>.json 快照与 <roomId>.events.jsonl journal 均落于此。 */
export const ROOMS_DATA_DIR = join(process.cwd(), 'data', 'rooms');

/** debug 快照目录(snapshot.ts)。 */
export const SNAPSHOTS_DIR = join(process.cwd(), 'data', 'snapshots');

/** 对局历史根目录(gameHistory.ts),每房间一个子目录。
 *  SGS_HISTORY_DIR 可重定向(测试沙箱重定向到临时目录,见 tests/setup.ts)。 */
export const HISTORY_DIR = process.env.SGS_HISTORY_DIR
  ? resolve(process.env.SGS_HISTORY_DIR)
  : join(process.cwd(), 'data', 'history');

/** AI bug 反馈目录(ai-mcp/feedbackHandler.ts)。运行时仍可被 SGS_FEEDBACK_DIR 覆盖。 */
export const FEEDBACK_DIR = join(process.cwd(), 'data', 'ai-feedback');

/** 共享 PGLite 数据目录(dbStore.ts)。 */
export const DB_DIR = join(process.cwd(), 'data', 'db');
