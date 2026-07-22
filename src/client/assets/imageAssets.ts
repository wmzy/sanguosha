// src/client/assets/imageAssets.ts
// 武将/卡牌图片资源映射。供前端展示层引用 public 目录下的图片。
//
// 数据来源:
//   - 武将立绘:docs/research/武将技能/.hero-cache/images/<id>.png → public/cards-local/characters/<name>.png
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
// 武将按 character.name(代码内名,如「曹操」「界卧龙诸葛」)命名,统一放在
// cards-local/characters/<name>.png(与卡牌图同目录,gitignored,开发者自备)。
// 不维护武将名白名单——任意武将都返回 URL,文件 404 由调用方 <img onError> 兜底,
// 回退到角色势力的背景色(见各武将卡组件的势力色 portrait 层)。
/** 武将立绘 URL。name 为空返回 null。 */
export function getCharacterImage(name: string): string | null {
  if (!name) return null;
  return `/cards-local/characters/${name}.png`;
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
