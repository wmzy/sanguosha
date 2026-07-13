// src/db/migrate.ts — 运行 drizzle 迁移。createDB 后、查询前必须调用。
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/pglite/migrator';
import type { DB } from './client';

async function migrateDB(handle: DB): Promise<void> {
  const currentDir = fileURLToPath(new URL('.', import.meta.url));
  const migrationsFolder = resolve(currentDir, '..', '..', 'drizzle');
  await drizzleMigrate(handle.db, { migrationsFolder });
}

export { migrateDB };
