// src/db/index.ts — DB 包:Drizzle schema + PGLite 客户端 + 迁移。

export type { DB } from './client';
export { createDB } from './client';
export { migrateDB } from './migrate';
export { rooms } from './schema';
export type { RoomInsert, RoomRow } from './schema';
export type { DBConfig, DBDriver } from './types';
