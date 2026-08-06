// scripts/sync-cards-ai-to-packs.ts
// 将 public/cards-ai/(gen-card.ts --all 产出的逐张分化卡面)同步到
// public/packs/base/card/,作为运行时资源包的手牌大图。
//
// 为什么需要这个脚本:
//   - cards-ai 由 gen-card.ts 按每张物理牌(牌名+点数+花色)单独合成,
//     左上角点数/花色角标与文件名一一对应(正确)。
//   - packs/base 曾被 sync-cards-local + migrate-to-packs 用「每牌名一张通用图
//     复制到所有花色点数变体」填充,导致除首张外其余变体的角标全部错误
//     (同名不同花色点数的牌字节完全相同)。本脚本用正确的 cards-ai 覆盖之。
//
// 同步规则:
//   - 目标尺寸 240×337(与 packs/base 既有缩略图一致),cover 居中裁切。
//   - 扩展名遵循 manifest.json 既有 file 字段:基本牌→.jpg(mozjpeg q82),
//     装备/锦囊→.png(palette 压缩)。manifest 无需改动。
//   - equipment/ 缩略图(按名)不在本脚本范围,保持不变。
//
// 用法: npx tsx scripts/sync-cards-ai-to-packs.ts [--dry-run]
//   --dry-run  只打印计划,不写文件

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(import.meta.dirname, '..');
const AIDIR = join(ROOT, 'public', 'cards-ai');
const BASE = join(ROOT, 'public', 'packs', 'base');
const MANIFEST_PATH = join(BASE, 'manifest.json');
const TARGET_W = 240;
const TARGET_H = 337;

const dryRun = process.argv.includes('--dry-run');

interface ResourceEntry {
  id: string;
  type: string;
  file?: string;
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    resources: ResourceEntry[];
  };
  // 仅处理手牌大图(card/<名>-<点>-<花色>),排除装备缩略图(card/equipment/*)
  const cardEntries = manifest.resources.filter(
    (r) =>
      typeof r.id === 'string' &&
      r.id.startsWith('card/') &&
      !r.id.startsWith('card/equipment/'),
  );

  let ok = 0;
  let missing = 0;
  const missingList: string[] = [];
  for (const e of cardEntries) {
    const core = e.id.slice('card/'.length);
    const mm = core.match(/^(.*)-([0-9AJQK]+)-(♠|♥|♣|♦)$/);
    if (!mm) {
      missing++;
      missingList.push(`${e.id} (无法解析)`);
      continue;
    }
    const [, name, rank, suit] = mm;
    // 在 cards-ai 三个子目录中定位源图
    let src: string | null = null;
    for (const sub of ['basic', 'equipment', 'trick']) {
      const p = join(AIDIR, sub, `${name}-${rank}-${suit}.png`);
      if (existsSync(p)) {
        src = p;
        break;
      }
    }
    if (!src) {
      missing++;
      missingList.push(`${e.id} (cards-ai 无源图)`);
      continue;
    }
    const expFile = e.file ?? `${e.id}.png`;
    const ext = expFile.endsWith('.jpg') ? 'jpg' : 'png';
    const dest = join(BASE, 'card', `${name}-${rank}-${suit}.${ext}`);
    if (dryRun) {
      console.log(`[dry-run] ${src} → ${dest} (${ext})`);
      ok++;
      continue;
    }
    let pipeline = sharp(src).resize(TARGET_W, TARGET_H, {
      fit: 'cover',
      position: 'center',
    });
    if (ext === 'jpg') pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
    else pipeline = pipeline.png({ compressionLevel: 9, palette: true });
    await pipeline.toFile(dest);
    ok++;
  }
  console.log(`\n=== 同步完成 ===`);
  console.log(`成功: ${ok}, 缺失: ${missing}, 总计: ${cardEntries.length}`);
  if (missingList.length) {
    console.log('缺失列表:');
    for (const m of missingList) console.log(`  - ${m}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
