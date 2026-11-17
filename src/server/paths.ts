// src/server/paths.ts — 服务端落盘目录单点。
// 房间快照持久化(persistence.ts)与事件 journal(eventJournal.ts)写同一棵
// data/rooms/ 树(.json 快照 + .events.jsonl),目录推导只允许存在这一份,
// 防两处各自 join(process.cwd(), ...) 漂移到不同根。
// (dbStore.ts 的 data/db 是另一棵树,不在此收敛。)

import { join } from 'node:path';

/** 房间持久化数据根目录:<roomId>.json 快照与 <roomId>.events.jsonl journal 均落于此。 */
export const ROOMS_DATA_DIR = join(process.cwd(), 'data', 'rooms');
