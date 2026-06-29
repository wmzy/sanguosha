// server/version.ts — 运行时读取 package.json 版本号。
// 服务端模块(snapshot.ts 等)直接 import 即可,不依赖 Vite 的编译期 define
// (define 只作用于客户端 bundle,服务端走 Node 直接执行)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 从本文件(src/server/version.ts)向上两级到项目根目录读 package.json。
// 用 fileURLToPath + resolve 而非 new URL(),兼容 vitest 与生产环境。
const __filename = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(__filename), '..', '..');

const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8')) as {
  version: string;
};

export const ENGINE_VERSION: string = pkg.version;
