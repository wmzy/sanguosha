// src/server/vite-resource-plugin.ts
// 资源包 Vite 插件：拦截 /packs/ 文件请求 + 生成 /packs/index.json。
//
// 职责：
//   1. 文件服务：GET /packs/{packId}/{path} → 命中 stream 返回 + MIME；未命中 404（不让 SPA fallback）。
//   2. 包发现：GET /packs/index.json → 扫描 public/packs/*/manifest.json 聚合返回（dev）；
//      closeBundle 钩子写入 dist/packs/index.json（prod）。
// 替换原 vite-card-local-plugin.ts。

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, statSync, createReadStream, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, normalize, sep, extname } from 'node:path';
import { createLogger } from './logger';
import type { Manifest, PacksIndex } from '../client/resources/types';

const log = createLogger('resource-pack');

const PUBLIC_DIR = join(process.cwd(), 'public');
const PACKS_DIR = join(PUBLIC_DIR, 'packs');
const DIST_PACKS_DIR = join(process.cwd(), 'dist', 'packs');

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
};

/** 扫描 public/packs 下各子目录的 manifest.json，聚合成 PacksIndex。 */
export function scanPacksIndex(): PacksIndex {
  const packs: PacksIndex['packs'] = [];
  if (!existsSync(PACKS_DIR)) return { packs };
  for (const entry of readdirSync(PACKS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(PACKS_DIR, entry.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as Manifest;
      if (manifest && typeof manifest.id === 'string') {
        packs.push({ id: manifest.id, manifest });
      }
    } catch (e) {
      log.error(`解析 manifest 失败: ${manifestPath}: ${(e as Error).message}`);
    }
  }
  return { packs };
}

/** 测试用：从已读 manifests 构建 index。 */
export function buildPacksIndex(items: Array<{ packId: string; manifest: Manifest }>): PacksIndex {
  return { packs: items.map((i) => ({ id: i.packId, manifest: i.manifest })) };
}

/** 解析 /packs/{packId}/{relPath} 的绝对路径。越界（穿越/非法 packId）返回 null。 */
export function resolvePackFile(packsRoot: string, packId: string, relPath: string): string | null {
  if (packId.includes('/') || packId.includes(sep) || packId.includes('\\')) return null;
  const packDir = join(packsRoot, packId);
  const target = normalize(join(packDir, relPath));
  if (!target.startsWith(packDir + sep) && target !== packDir) return null;
  return target;
}

export function resourcePlugin(): Plugin {
  const packsExist = existsSync(PACKS_DIR) && statSync(PACKS_DIR).isDirectory();
  if (packsExist) {
    log.info(`检测到 ${PACKS_DIR}，资源包将从此目录提供`);
  }

  return {
    name: 'resource-pack-serve',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? '';
        // 1. 包发现清单
        if (url.split('?')[0] === '/packs/index.json') {
          const index = scanPacksIndex();
          res.setHeader('Content-Type', MIME_BY_EXT['.json']);
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify(index));
          return;
        }
        // 2. 文件请求
        if (!url.startsWith('/packs/')) {
          next();
          return;
        }
        const pathPart = url.split('?')[0].slice('/packs/'.length);
        const decoded = decodeURIComponent(pathPart);
        const slashIdx = decoded.indexOf('/');
        if (slashIdx <= 0) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const packId = decoded.slice(0, slashIdx);
        const relPath = decoded.slice(slashIdx + 1);
        const target = resolvePackFile(PACKS_DIR, packId, relPath);
        if (!target || !existsSync(target) || !statSync(target).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const mime = MIME_BY_EXT[extname(target).toLowerCase()] ?? 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(target).pipe(res);
      });
    },
    closeBundle() {
      if (!existsSync(DIST_PACKS_DIR) && existsSync(PACKS_DIR)) {
        mkdirSync(DIST_PACKS_DIR, { recursive: true });
      }
      if (existsSync(PACKS_DIR)) {
        const index = scanPacksIndex();
        writeFileSync(join(DIST_PACKS_DIR, 'index.json'), JSON.stringify(index));
        log.info(`已生成 dist/packs/index.json（${index.packs.length} 个包）`);
      }
    },
  };
}
