// src/server/vite-card-local-plugin.ts
// 卡牌图本地覆盖中间件。
//
// 背景:public/cards/ 存放自制默认卡图(入 git,无版权问题);
//      public/cards-local/ 存放本地官方/任意卡图(gitignored,开发者自备)。
//
// 机制:拦截 /cards/ 请求,先查 public/cards-local/ 对应文件,命中则直接返回;
//      未命中则落到 Vite 默认的 public/cards/ 兜底。前端永远只请求 /cards/<...>,
//      无需 JS onError 交换 src,无本地存在性探测。
//
// 启动时检查 public/cards-local/ 是否存在:不存在则跳过中间件(零开销),
//      仅用 public/cards/ 自制默认图。
//
// 生产构建:vite build 不跑 dev 中间件。closeBundle 钩子里若 cards-local/ 存在,
//      将其内容合并到 dist/cards/(覆盖同名),使生产包也支持本地覆盖。
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, statSync, createReadStream, cpSync } from 'node:fs';
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
  // 启动时一次性检查:cards-local/ 不存在则整个中间件不挂载(零开销)。
  const localExists = existsSync(LOCAL_DIR) && statSync(LOCAL_DIR).isDirectory();
  if (!localExists) {
    log.info('未发现 public/cards-local/,仅使用默认卡图(public/cards/)');
  } else {
    log.info('检测到 public/cards-local/,本地卡图将覆盖默认卡图');
  }

  return {
    name: 'card-local-override',
    configureServer(server) {
      if (!localExists) return;
      // 挂在 Vite 静态资源中间件之前,优先拦截 /cards/。
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? '';
        // 仅拦截 /cards/ 前缀(排除 /cards-local/,若直接请求该路径则不处理)。
        if (!url.startsWith('/cards/') || url.startsWith('/cards-local/')) {
          next();
          return;
        }
        // 去 query → 解码 → 防目录穿越(须落在 LOCAL_DIR 内)。
        const pathPart = url.split('?')[0].slice('/cards/'.length);
        const decoded = decodeURIComponent(pathPart);
        const safe = normalize(join(LOCAL_DIR, decoded));
        if (!safe.startsWith(LOCAL_DIR + sep) && safe !== LOCAL_DIR) {
          next();
          return;
        }
        if (existsSync(safe) && statSync(safe).isFile()) {
          const mime = MIME_BY_EXT[extname(safe).toLowerCase()] ?? 'application/octet-stream';
          res.setHeader('Content-Type', mime);
          res.setHeader('Cache-Control', 'no-cache');
          createReadStream(safe).pipe(res);
          return;
        }
        // 未命中本地:落到默认 public/cards/
        next();
      });
    },
    // 生产构建:把 cards-local/(若存在)合并进 dist/cards/(覆盖同名)。
    closeBundle() {
      if (!localExists) return;
      const distCards = join(process.cwd(), 'dist', 'cards');
      if (!existsSync(distCards)) return; // 无 dist/cards/ 则跳过(非前端构建)
      try {
        cpSync(LOCAL_DIR, distCards, { recursive: true, force: true });
        log.info('已将 public/cards-local/ 合并到 dist/cards/');
      } catch (err) {
        log.error('构建期合并 cards-local 失败', { error: err });
      }
    },
  };
}
