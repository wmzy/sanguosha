// src/db/types.ts — DB 驱动类型定义。

/** 数据库驱动选择。PGLite 为本地 WASM Postgres(无服务器)。 */
type DBDriver = 'pglite';

/** 创建数据库连接的配置。 */
type DBConfig = { driver: 'pglite'; dataDir?: string };

export type { DBConfig, DBDriver };
