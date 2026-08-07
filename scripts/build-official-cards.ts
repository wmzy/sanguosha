// scripts/build-official-cards.ts
// 用官方无角标卡面(QSanguosha/BWIKI)为底图,程序绘制每个花色点数变体的角标,
// 生成 packs/base/card/ 的手牌大图。
//
// 背景:
//   三国杀官方设计里同牌名(如「杀」)的不同花色点数变体插画相同,仅左上角点数花色不同。
//   历史上 packs/base 被错误地用「每牌名一张图复制到所有变体」填充,导致角标全部错误。
//   本脚本用官方底图 + 程序绘制正确角标,彻底解决。
//
// 底图来源(无角标官方卡面,优先级):
//   QSanguosha image/big-card (200×290, 大部分牌)
//   QSanguosha image/card (93×130 小图, 装备类)
//   BWIKI patchwiki (200×290, 方天画戟等)
//   cards-ai (1760×2368 正规三国杀风格, 坐骑类 — QSanguosha 无坐骑卡面)
//   底图统一缩放到 240×337(与 packs/base 既有缩略图一致),cover 居中。
//
// 角标绘制:
//   左上角用半透明深色圆角块覆盖底图原有内容(部分来源带角标),其上绘制点数+花色。
//   花色颜色:♥♦红色 / ♠♣黑色,与官方一致。
//
// 用法: npx tsx scripts/build-official-cards.ts [--dry-run]
//   底图目录: /tmp/qs_cards (qs_<拼音>.png)
//   输出: public/packs/base/card/<牌名>-<点数>-<花色>.{jpg,png}

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(import.meta.dirname, '..');
const BASE = join(ROOT, 'public', 'packs', 'base');
const MANIFEST_PATH = join(BASE, 'manifest.json');
const BASE_IMG_DIR = '/tmp/qs_cards'; // 官方底图缓存
const OUT_W = 240;
const OUT_H = 337;

const dryRun = process.argv.includes('--dry-run');

// 牌名 → QSanguosha 拼音映射
const NAME_TO_PY: Record<string, string> = {
  '杀': 'slash', '火杀': 'fire_slash', '雷杀': 'thunder_slash',
  '闪': 'jink', '桃': 'peach', '酒': 'analeptic',
  '诸葛连弩': 'Crossbow', '雌雄双股剑': 'DoubleSword', '青釭剑': 'QinggangSword',
  '寒冰剑': 'IceSword', '贯石斧': 'Axe', '丈八蛇矛': 'Spear', '青龙偃月刀': 'Blade',
  '麒麟弓': 'KylinBow', '八卦阵': 'EightDiagram', '仁王盾': 'RenwangShield', '藤甲': 'Vine',
  '白银狮子': 'SilverLion', '朱雀羽扇': 'Fan',
  '赤兔': 'ChiTu', '大宛': 'DaYuan', '的卢': 'DiLu', '爪黄飞电': 'ZhuaHuangFeiDian',
  '绝影': 'JueYing', '紫骍': 'ZiXing', '骅骝': 'HuaLiu',
  '决斗': 'duel', '无中生有': 'ex_nihilo', '借刀杀人': 'collateral',
  '顺手牵羊': 'snatch', '过河拆桥': 'dismantlement', '无懈可击': 'nullification',
  '铁索连环': 'iron_chain', '火攻': 'fire_attack', '桃园结义': 'god_salvation',
  '南蛮入侵': 'savage_assault', '万箭齐发': 'archery_attack', '五谷丰登': 'amazing_grace',
  '闪电': 'lightning', '乐不思蜀': 'indulgence', '兵粮寸断': 'supply_shortage',
  '方天画戟': 'Halberd', '古锭刀': 'GudingBlade',
};

const SUIT_COLOR: Record<string, string> = { '♥': '#c0392b', '♦': '#c0392b', '♠': '#1a1a1a', '♣': '#1a1a1a' };

interface ResourceEntry { id: string; type: string; file?: string }

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 构造角标 SVG(左上角覆盖块 + 点数 + 花色)
// w/h 为目标图尺寸(OUT_W×OUT_H)。角标区约占左上 16% 宽 × 18% 高。
function buildCornerSvg(rank: string, suit: string, w: number, h: number): string {
  const color = SUIT_COLOR[suit] ?? '#1a1a1a';
  // 角标块尺寸
  const bw = Math.round(w * 0.18); // 块宽
  const bh = Math.round(h * 0.20); // 块高
  const r = 6; // 圆角
  const rankFs = Math.round(bh * 0.42);
  const suitFs = Math.round(bh * 0.34);
  const padX = Math.round(w * 0.015);
  const padY = Math.round(h * 0.015);
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${padX}" y="${padY}" width="${bw}" height="${bh}" rx="${r}" ry="${r}" fill="rgba(245,230,200,0.92)" stroke="rgba(107,78,26,0.5)" stroke-width="1"/>
  <text x="${padX + bw/2}" y="${padY + rankFs + 4}" font-family="Georgia, 'Times New Roman', serif" font-size="${rankFs}" font-weight="bold" fill="${color}" text-anchor="middle">${escapeXml(rank)}</text>
  <text x="${padX + bw/2}" y="${padY + rankFs + suitFs + 8}" font-family="Arial, sans-serif" font-size="${suitFs}" fill="${color}" text-anchor="middle">${suit}</text>
</svg>`;
}

async function main() {
  // 读 deck.ts 取所有物理牌(牌名,花色,点数)
  const deckSrc = readFileSync(join(ROOT, 'src', 'shared', 'deck.ts'), 'utf8');
  const entries: { name: string; suit: string; rank: string }[] = [];
  for (const line of deckSrc.split('\n')) {
    const mm = line.match(/^\s*\['([^']+)',\s*'(♠|♥|♣|♦)',\s*'([^']+)'/);
    if (mm) entries.push({ name: mm[1], suit: mm[2], rank: mm[3] });
  }
  // 去重(同 牌名+花色+点数 共享一张图)
  const seen = new Set<string>();
  const uniq = entries.filter((e) => {
    const k = `${e.name}|${e.suit}|${e.rank}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 读 manifest 拿每个变体的目标扩展名
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as { resources: ResourceEntry[] };
  const extMap = new Map<string, string>(); // "牌名|花色|点数" → jpg/png
  for (const e of manifest.resources) {
    if (typeof e.id !== 'string' || !e.id.startsWith('card/') || e.id.startsWith('card/equipment/')) continue;
    const mm = e.id.match(/^card\/(.*)-([0-9AJQK]+)-(♠|♥|♣|♦)$/);
    if (!mm) continue;
    const expFile = e.file ?? `${e.id}.png`;
    extMap.set(`${mm[1]}|${mm[3]}|${mm[2]}`, expFile.endsWith('.jpg') ? 'jpg' : 'png');
  }

  let ok = 0;
  const missing: string[] = [];
  for (const { name, suit, rank } of uniq) {
    const py = NAME_TO_PY[name];
    if (!py) { missing.push(`${name}(无映射)`); continue; }
    const baseImg = `${BASE_IMG_DIR}/qs_${py}.png`;
    if (!existsSync(baseImg)) { missing.push(`${name}(${py} 无底图)`); continue; }
    const ext = extMap.get(`${name}|${suit}|${rank}`) ?? 'png';
    const dest = join(BASE, 'card', `${name}-${rank}-${suit}.${ext}`);
    if (dryRun) { console.log(`[dry-run] ${py} + ${rank}${suit} → ${name}-${rank}-${suit}.${ext}`); ok++; continue; }
    // 缩放底图到 240×337
    // 高分辨率底图(cards-ai 来源)用 contain + 背景填充,避免 cover 裁切变形;
    // QSanguosha/BWIKI 低分辨率底图(已是完整卡面)用 cover。
    const baseMeta = await sharp(baseImg).metadata();
    const isHiRes = (baseMeta.height ?? 0) > 400;
    let pipeline: ReturnType<typeof sharp>;
    if (isHiRes) {
      // contain 模式:先缩放到容纳,再用卡牌背景色画布居中合成
      const scaled = await sharp(baseImg)
        .resize(OUT_W, OUT_H, { fit: 'contain', position: 'center', background: '#f5e6c8' })
        .png().toBuffer();
      pipeline = sharp(scaled);
    } else {
      pipeline = sharp(baseImg).resize(OUT_W, OUT_H, { fit: 'cover', position: 'center' });
    }
    // 叠加角标 SVG
    const cornerSvg = Buffer.from(buildCornerSvg(rank, suit, OUT_W, OUT_H));
    pipeline = pipeline.composite([{ input: cornerSvg, top: 0, left: 0 }]);
    if (ext === 'jpg') pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
    else pipeline = pipeline.png({ compressionLevel: 9 });
    await pipeline.toFile(dest);
    ok++;
  }
  console.log(`\n=== 生成完成 ===`);
  console.log(`成功: ${ok}/${uniq.length}, 缺失: ${missing.length}`);
  if (missing.length) { console.log('缺失:'); for (const m of missing) console.log(`  - ${m}`); }
}

main().catch((e) => { console.error(e); process.exit(1); });
