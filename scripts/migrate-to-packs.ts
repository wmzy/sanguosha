// scripts/migrate-to-packs.ts
// 一次性迁移脚本：cards-local + sounds → packs/base + 生成 manifest.json。
//
// 用法：tsx scripts/migrate-to-packs.ts [--dry-run] [--copy]
//   --dry-run  只打印将做什么，不实际移动
//   --copy     复制而非移动（保留原文件）
//
// 迁移映射（见 spec §9）：
//   cards-local/basic/<名>-<点>-<花色>.{jpg,png}  → packs/base/card/<原文件名>
//   cards-local/equipment/<名>.png                 → packs/base/card/equipment/<名>.png
//   cards-local/trick/<名>-<点>-<花色>.png          → packs/base/card/<原文件名>
//   cards-local/characters/<名>.png                → packs/base/character/<名>.png
//   sounds/<id>.mp3                                → packs/base/sound/<id>.mp3
//
// manifest.json 生成规则：
//   - .jpg 文件：显式写 file（默认推断为 .png）
//   - .png/.mp3/.json：省略 file（按 ID 同构）

import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');
const OLD_CARD_LOCAL = join(PUBLIC, 'cards-local');
const OLD_SOUNDS = join(PUBLIC, 'sounds');
const NEW_BASE = join(PUBLIC, 'packs', 'base');

interface Move {
  from: string;
  to: string;
  resourceId: string;
  type: 'image' | 'audio';
  explicitFile?: string;
}

function scanMoves(): Move[] {
  const moves: Move[] = [];
  const sub = (name: string): 'basic' | 'equipment' | 'trick' | 'characters' | null => {
    if (['basic', 'equipment', 'trick', 'characters'].includes(name)) return name as any;
    return null;
  };

  if (existsSync(OLD_CARD_LOCAL)) {
    for (const dir of readdirSync(OLD_CARD_LOCAL, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const s = sub(dir.name);
      if (!s) continue;
      const srcDir = join(OLD_CARD_LOCAL, dir.name);
      for (const f of readdirSync(srcDir)) {
        const srcPath = join(srcDir, f);
        if (!statSync(srcPath).isFile()) continue;
        const ext = extname(f).toLowerCase();
        if (!['.png', '.jpg', '.jpeg'].includes(ext)) continue;
        const stem = basename(f, ext);
        if (s === 'characters') {
          moves.push({
            from: srcPath, to: join(NEW_BASE, 'character', `${stem}.png`),
            resourceId: `character/${stem}`, type: 'image',
          });
        } else if (s === 'equipment') {
          if (f.includes('-')) {
            moves.push({
              from: srcPath, to: join(NEW_BASE, 'card', f),
              resourceId: `card/${stem}`, type: 'image',
              explicitFile: ext === '.jpg' ? `card/${f}` : undefined,
            });
          } else {
            moves.push({
              from: srcPath, to: join(NEW_BASE, 'card', 'equipment', f),
              resourceId: `card/equipment/${stem}`, type: 'image',
            });
          }
        } else {
          moves.push({
            from: srcPath, to: join(NEW_BASE, 'card', f),
            resourceId: `card/${stem}`, type: 'image',
            explicitFile: ext === '.jpg' ? `card/${f}` : undefined,
          });
        }
      }
    }
  }

  if (existsSync(OLD_SOUNDS)) {
    for (const f of readdirSync(OLD_SOUNDS)) {
      const srcPath = join(OLD_SOUNDS, f);
      if (!statSync(srcPath).isFile()) continue;
      const ext = extname(f).toLowerCase();
      if (ext !== '.mp3') continue;
      const stem = basename(f, ext);
      moves.push({
        from: srcPath, to: join(NEW_BASE, 'sound', f),
        resourceId: `sound/${stem}`, type: 'audio',
      });
    }
  }

  return moves;
}

function buildManifest(moves: Move[]) {
  const resources = moves.map((m) => {
    const entry: any = { id: m.resourceId, type: m.type };
    if (m.explicitFile) entry.file = m.explicitFile;
    return entry;
  });
  return {
    manifestVersion: 1 as const,
    id: 'base',
    name: '基础资源包',
    version: '1.0.0',
    author: '迁移自 cards-local + sounds',
    priority: 0,
    resources,
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const dry = args.has('--dry-run');
  const copy = args.has('--copy');

  const moves = scanMoves();
  if (moves.length === 0) {
    console.log('无可迁移文件（cards-local 和 sounds 均为空或不存在）。');
    return;
  }

  console.log(`将迁移 ${moves.length} 个文件到 ${NEW_BASE}:\n`);
  for (const m of moves) {
    console.log(`  ${m.from.replace(ROOT, '.')} → ${m.to.replace(ROOT, '.')}  [${m.resourceId}]`);
  }
  console.log('');

  if (dry) {
    console.log('[dry-run] 不实际移动。');
    return;
  }

  for (const m of moves) {
    mkdirSync(join(m.to, '..'), { recursive: true });
    if (copy) copyFileSync(m.from, m.to);
    else renameSync(m.from, m.to);
  }

  mkdirSync(NEW_BASE, { recursive: true });
  const manifest = buildManifest(moves);
  const manifestPath = join(NEW_BASE, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`已生成 ${manifestPath.replace(ROOT, '.')}（${manifest.resources.length} 项资源）`);
  console.log('\n完成。请启动 dev server 验证：curl http://localhost:3930/packs/index.json');
}

main();
