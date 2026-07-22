// src/server/vite-card-local-plugin.ts
// 卡牌图本地覆盖中间件。
//
// 背景:public/cards-local/ 存放本地卡图(gitignored,开发者自备)。
//      命名规范:<type>/<名>-<点>-<花色>.<ext>,每张物理牌一张图。
//
// 机制:拦截 /cards-local/ 请求,命中则直接返回;未命中返回 404
//      (不落到 Vite SPA fallback 的 200 index.html),保证 <object> 标签
//      能正确触发其 fallback HTML 绘制牌面。
//
// 生产构建:vite build 会自动把 public/ 复制到 dist/;本插件无需额外处理。

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { join, normalize, sep, extname } from 'node:path';
import { createLogger } from './logger';

const log = createLogger('card-local');

const LOCAL_DIR = join(process.cwd(), 'public', 'cards-local');

// 卡牌图仅用这几种扩展名,无需完整 MIME 库。
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function cardLocalPlugin(): Plugin {
  const localExists = existsSync(LOCAL_DIR) && statSync(LOCAL_DIR).isDirectory();
  if (localExists) {
    log.info('检测到 public/cards-local/,卡图将从此目录提供');
  }

  return {
    name: 'card-local-serve',
    configureServer(server) {
      if (!localExists) return;
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/cards-local/')) {
          next();
          return;
        }
        // 去 query → 解码 → 防目录穿越(须落在 LOCAL_DIR 内)。
        const pathPart = url.split('?')[0].slice('/cards-local/'.length);
        const decoded = decodeURIComponent(pathPart);
        const safe = normalize(join(LOCAL_DIR, decoded));
        if (!safe.startsWith(LOCAL_DIR + sep) && safe !== LOCAL_DIR) {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (existsSync(safe) && statSync(safe).isFile()) {
          const mime = MIME_BY_EXT[extname(safe).toLowerCase()] ?? 'application/octet-stream';
          res.setHeader('Content-Type', mime);
          res.setHeader('Cache-Control', 'no-cache');
          createReadStream(safe).pipe(res);
          return;
        }
        // 文件不存在:返回 404(不让 Vite SPA fallback 返回 index.html)
        // <object> 收到 404 才会正确渲染其 fallback 内容。
        res.statusCode = 404;
        res.end();
      });
    },
  };
}
