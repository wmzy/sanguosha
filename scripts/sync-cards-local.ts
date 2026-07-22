// scripts/sync-cards-local.ts
// 从 public/cards/ (按名) 生成 public/cards-local/ (按物理牌) 的卡图。
//
// 命名规范: <type>/<name>-<rank>-<suit>.<ext>
//   basic 卡 → .jpg, equipment/trick → .png
//   火杀实例(♥4/♥7/♥10/♦4/♦5) → 源图 火杀.jpg
//   雷杀实例(♣5-8/♠4-8)        → 源图 雷杀.jpg
//   普通 杀 实例                → 源图 杀.jpg
//
// 同时为 equipment 保留按名文件 (<name>.png) 供 EquipColumn 缩略图使用。
//
// 用法: npx tsx scripts/sync-cards-local.ts

import { existsSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStandardDeck } from '../src/shared/deck';
import type { Card } from '../src/shared/types';

const CARDS_DIR = join(import.meta.dirname, '..', 'public', 'cards');
const LOCAL_DIR = join(import.meta.dirname, '..', 'public', 'cards-local');

// subtype 目录映射
function subDir(card: Card): string {
  if (card.type === '基本牌') return 'basic';
  if (card.type === '装备牌') return 'equipment';
  return 'trick';
}

// 源图文件名:火杀→火杀.jpg,雷杀→雷杀.jpg,其余→<name>.<ext>
function sourceFile(card: Card): string {
  const sub = subDir(card);
  const ext = sub === 'basic' ? '.jpg' : '.png';
  if (card.name === '杀') {
    if (card.damageType === '火焰') return `火杀${ext}`;
    if (card.damageType === '雷电') return `雷杀${ext}`;
  }
  // 坐骑:无独立图,用通用 +1坐骑/-1坐骑 图标
  if (card.subtype === '防御马') return `+1坐骑${ext}`;
  if (card.subtype === '进攻马') return `-1坐骑${ext}`;
  return `${card.name}${ext}`;
}

// 目标文件名:<name>-<rank>-<suit>.<ext>
function targetFile(card: Card): string {
  const sub = subDir(card);
  const ext = sub === 'basic' ? '.jpg' : '.png';
  return `${card.name}-${card.rank}-${card.suit}${ext}`;
}

/** 在 cards/ 和 cards-local/ 中查找源图,返回找到的第一个路径。 */
function findSource(name: string): string | null {
  for (const base of [CARDS_DIR, LOCAL_DIR]) {
    // 先在子目录找,再在根目录找
    for (const sub of ['basic', 'equipment', 'trick', '']) {
      const p = join(base, sub, name);
      if (existsSync(p) && statSync(p).isFile()) return p;
    }
  }
  return null;
}

function main() {
  const deck = createStandardDeck();
  console.log(`牌堆共 ${deck.length} 张`);

  // 统计
  let copied = 0;
  let skipped = 0;
  const missing = new Set<string>();

  // 去重:同一 (name, rank, suit) 可能出现多次(如 ♠8 杀 ×2),只复制一次
  const seen = new Set<string>();

  for (const card of deck) {
    const src = sourceFile(card);
    const tgt = targetFile(card);
    const key = `${subDir(card)}/${tgt}`;
    if (seen.has(key)) continue; // 跳过重复物理牌
    seen.add(key);

    // 查找源图
    const srcPath = findSource(src);
    if (!srcPath) {
      missing.add(src);
      skipped++;
      continue;
    }

    // 确保目标目录存在
    const tgtDir = join(LOCAL_DIR, subDir(card));
    mkdirSync(tgtDir, { recursive: true });

    const tgtPath = join(tgtDir, tgt);
    copyFileSync(srcPath, tgtPath);
    copied++;
  }

  // equipment 按名文件(EquipColumn 缩略图用)
  let eqCopied = 0;
  for (const card of deck) {
    if (card.type !== '装备牌') continue;
    const namePath = `${card.name}.png`;
    if (seen.has(`equipment-name/${namePath}`)) continue;
    seen.add(`equipment-name/${namePath}`);

    // 坐骑:无独立图,用通用 +1坐骑/-1坐骑 图标复制为按名文件
    let srcPath: string | null;
    if (card.subtype === '防御马') srcPath = findSource('+1坐骑.png');
    else if (card.subtype === '进攻马') srcPath = findSource('-1坐骑.png');
    else srcPath = findSource(namePath);
    if (!srcPath) continue;

    const eqDir = join(LOCAL_DIR, 'equipment');
    mkdirSync(eqDir, { recursive: true });
    copyFileSync(srcPath, join(eqDir, namePath));
    eqCopied++;
  }

  console.log(`\n结果:`);
  console.log(`  按物理牌复制: ${copied} 张`);
  console.log(`  装备按名复制: ${eqCopied} 张`);
  console.log(`  跳过(无源图): ${skipped} 张`);

  if (missing.size > 0) {
    console.log(`\n缺失源图 (${missing.size} 种):`);
    for (const m of [...missing].sort()) console.log(`  ${m}`);
  }
}

main();
