// src/client/assets/imageAssets.ts
// 武将/卡牌图片资源映射。供前端展示层引用 public 目录下的图片。
//
// 数据来源:
//   - 武将立绘:docs/research/武将技能/.hero-cache/images/<id>.png → public/characters/<name>.png
//   - 卡牌图:docs/research/images/<name>.{png,jpg} → public/cards/<type>/<name>.<ext>
//
// 命名约定:
//   - 武将按 character.name(代码内名,如「曹操」「界卧龙诸葛」)命名,避免外部 id 漂移。
//   - 卡牌按 card.name 命名,类型区分子目录(basic / equipment / trick / 其他)。
//
// 缺失图片(无对应素材)返回 null,调用方自行回退到文字/默认样式。
// 只暴露 URL 字符串,组件直接放进 <img src=...>,缺失图片用 onError 兜底。
//
// ─── 卡牌图来源 ──────────────────────────────────────────────
// 卡牌图来自 public/cards-local/<type>/<名>-<点>-<花色>.png(本地卡图,gitignored)。
// 命名格式:[名称]-[点数]-[花色].png —— 每张物理牌一张独立图。
// 火杀/雷杀 name 仍是「杀」,靠花色点数组合唯一区分(♥4 只可能是火杀)。
// 缺失图片(无对应文件或 card 无 suit/rank)返回 null,调用方用 <object> fallback
// 到 HTML 绘制的牌面;图片 404 由 <object> 自动回退其内部内容。

// ─── 武将立绘 ───────────────────────────────────────────────
// 命名 → 文件名映射。若名字相同(同前缀、同后缀)而 series 不同,以前缀区分(界/谋/SP 等)。
// 凡是本仓库 src/engine/cards/characters 已实现且有立绘素材的武将,在此列出。
const CHARACTER_FILES: ReadonlySet<string> = new Set([
  // 魏
  '曹操', '司马懿', '夏侯惇', '张辽', '许褚', '郭嘉', '甄姬', '夏侯渊', '曹仁', '荀彧', '典韦', '曹丕', '徐晃', '张郃', '邓艾',
  // 蜀
  '刘备', '关羽', '张飞', '赵云', '马超', '黄忠', '魏延', '诸葛亮', '黄月英', '庞统', '姜维', '刘禅', '孟获', '祝融', '卧龙诸葛',
  // 吴
  '孙权', '甘宁', '吕蒙', '黄盖', '周瑜', '大乔', '陆逊', '孙尚香', '小乔', '周泰', '太史慈', '孙坚', '孙策', '张昭张纮', '鲁肃',
  // 群
  '华佗', '吕布', '貂蝉', '袁绍', '颜良文丑', '于吉', '左慈', '贾诩', '张角', '董卓', '庞德', '蔡文姬',
  // 界限突破
  '界曹操', '界司马懿', '界夏侯惇', '界张辽', '界许褚', '界郭嘉', '界甄姬', '界夏侯渊', '界曹仁', '界荀彧', '界典韦', '界曹丕', '界徐晃', '界张郃', '界邓艾',
  '界刘备', '界关羽', '界张飞', '界赵云', '界马超', '界黄忠', '界魏延', '界诸葛亮', '界黄月英', '界庞统', '界姜维', '界刘禅', '界孟获', '界祝融', '界卧龙诸葛',
  '界孙权', '界甘宁', '界吕蒙', '界黄盖', '界周瑜', '界大乔', '界陆逊', '界孙尚香', '界小乔', '界周泰', '界太史慈', '界孙坚', '界孙策', '界张昭张纮', '界鲁肃',
]);

/** 武将立绘 URL。缺失返回 null。 */
export function getCharacterImage(name: string): string | null {
  if (!name) return null;
  return CHARACTER_FILES.has(name) ? `/characters/${name}.png` : null;
}

// ─── 卡牌图 ─────────────────────────────────────────────────
// 牌名 → cards-local 子目录(basic/equipment/trick),从 CardDef 实时派生。
// 不手动维护牌名 Set —— 直接复用 shared/cards 的权威 CardDef 注册表,
// 新增牌时自动覆盖,杜绝漏牌(如赤兔/的卢等坐骑名)。
import { 基本牌列表, 锦囊牌列表, 装备牌列表 } from '../../shared/cards';
import type { CardType } from '../../shared/types';

const NAME_TO_SUB: ReadonlyMap<string, 'basic' | 'equipment' | 'trick'> = (() => {
  const m = new Map<string, 'basic' | 'equipment' | 'trick'>();
  const subOf = (t: CardType): 'basic' | 'equipment' | 'trick' =>
    t === '基本牌' ? 'basic' : t === '装备牌' ? 'equipment' : 'trick';
  for (const def of 基本牌列表) m.set(def.name, subOf(def.type));
  for (const def of 锦囊牌列表) m.set(def.name, subOf(def.type));
  for (const def of 装备牌列表) m.set(def.name, subOf(def.type));
  return m;
})();

/** 卡牌图 URL(来自 public/cards-local/<type>/<名>-<点>-<花色>.png)。
 *
 * 需 card 同时具备 name + suit + rank 才能定位精确图片;缺任一返回 null
 * (转化卡 suit 为空串、或 card 信息不全时直接渲染 HTML 牌面)。
 * 图片 404(cards-local 中无该文件)由 <object> fallback 处理:自动渲染
 * 内部的 HTML 绘制牌面。 */
export function getCardImage(card: { name: string; suit?: string; rank?: string }): string | null {
  const sub = NAME_TO_SUB.get(card.name);
  if (!sub || !card.suit || !card.rank) return null;
  // basic 用 .jpg(官方扫描图),equipment/trick 用 .png
  const ext = sub === 'basic' ? 'jpg' : 'png';
  return `/cards-local/${sub}/${card.name}-${card.rank}-${card.suit}.${ext}`;
}

/** 装备区缩略图 URL(按牌名查找,一张图对应一种装备)。
 *
 * 装备区是小缩略图列表,不需要区分花色点数;cards-local/equipment/<名>.png。
 * 图片 404 由 <object> fallback 到 emoji 图标。 */
export function getEquipCardImage(name: string): string | null {
  if (NAME_TO_SUB.get(name) !== 'equipment') return null;
  return `/cards-local/equipment/${name}.png`;
}
