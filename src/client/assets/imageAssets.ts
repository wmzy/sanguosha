// src/client/assets/imageAssets.ts
// 武将/卡牌图片资源映射。薄委托 ResourceManager。
//
// 全局 ID 约定（见 docs/superpowers/specs/2026-07-26-resource-pack-system-design.md §3.1）：
//   character/{名}              武将立绘
//   card/{名}-{点}-{花色}       手牌大图
//   card/equipment/{名}         装备区缩略图
//
// 缺失资源（无文件或未注册）ResourceManager.get 返回 null，调用方 fallback：
//   - 卡牌：<object> fallback 到 HTML 牌面
//   - 武将：<img onError> fallback 到势力色背景

import { resourceManager } from '../resources';
import { 基本牌列表, 锦囊牌列表, 装备牌列表 } from '../../engine/data/card-defs';
import type { CardType } from '../../engine/types';

const NAME_TO_SUB: ReadonlyMap<string, 'basic' | 'equipment' | 'trick'> = (() => {
  const m = new Map<string, 'basic' | 'equipment' | 'trick'>();
  const subOf = (t: CardType): 'basic' | 'equipment' | 'trick' =>
    t === '基本牌' ? 'basic' : t === '装备牌' ? 'equipment' : 'trick';
  for (const def of 基本牌列表) m.set(def.name, subOf(def.type));
  for (const def of 锦囊牌列表) m.set(def.name, subOf(def.type));
  for (const def of 装备牌列表) m.set(def.name, subOf(def.type));
  return m;
})();

/**
 * 武将立绘别名与关联回退表。
 * 当角色无独立立绘时，自动回退到同义名或同系/渊源标准版武将，确保牌桌上全部 165 将均有精美立绘呈现。
 */
export const CHARACTER_FALLBACK_MAP: Readonly<Record<string, string>> = {
  // 别名与同义称呼
  卧龙诸葛亮: '卧龙诸葛',
  卧龙诸葛: '诸葛亮',
  张昭张弘: '张昭张纮',
  // 关联/同系立绘回退（165可用武将中无独立立绘的武将）
  诸葛瞻: '诸葛亮',
  陈到: '赵云',
  严颜: '黄忠',
  王平: '姜维',
  郝昭: '曹仁',
  王基: '邓艾',
  毌丘俭: '张郃',
  蒯越蒯良: '刘表',
  陆绩: '陆逊',
  周妃: '小乔',
  孙亮: '孙权',
  卢植: '刘备',
  张绣: '贾诩',
  郭皇后: '甄姬',
};

/** 武将立绘 URL。name 为空返回 null。支持界限突破与别名/同系无缝回退。 */
export function getCharacterImage(name: string, visited?: Set<string>): string | null {
  if (!name) return null;
  if (visited?.has(name)) return null;

  // 1. 优先使用独立立绘（如 character/界关羽、character/曹操）
  const direct = resourceManager.get(`character/${name}`);
  if (direct) return direct;

  const nextVisited = visited ? new Set(visited).add(name) : new Set([name]);

  // 2. 别名与同系关联回退
  const mapped = CHARACTER_FALLBACK_MAP[name];
  if (mapped) {
    const mappedRes = getCharacterImage(mapped, nextVisited);
    if (mappedRes) return mappedRes;
  }

  // 3. 界限突破武将（前缀带“界”或变体）在无独立立绘时自动无缝回退至标准版立绘（例如 界关羽 -> 关羽）
  if (name.startsWith('界')) {
    const baseName = name.slice(1);
    const baseRes = getCharacterImage(baseName, nextVisited);
    if (baseRes) return baseRes;
  }

  return null;
}

/** 卡牌图 URL。需同时具备 name + suit + rank。扩展名由 manifest 的 file 字段决定。 */
export function getCardImage(card: { name: string; suit?: string; rank?: string }): string | null {
  const sub = NAME_TO_SUB.get(card.name);
  if (!sub || !card.suit || !card.rank) return null;
  return resourceManager.get(`card/${card.name}-${card.rank}-${card.suit}`);
}

/** 不含花色点数的通用牌面，交由 CardFace 叠加本张牌的信息。 */
export function getCardArtImage(name: string, damageType?: string): string | null {
  const variant = name === '杀' && damageType === '火焰' ? '火杀'
    : name === '杀' && damageType === '雷电' ? '雷杀' : name;
  return resourceManager.get(`card/art/${variant}`) ?? resourceManager.get(`card/art/${name}`);
}

/** 装备区缩略图 URL。 */
export function getEquipCardImage(name: string): string | null {
  if (NAME_TO_SUB.get(name) !== 'equipment') return null;
  return resourceManager.get(`card/equipment/${name}`);
}

/** 牌背图 URL。未安装资源时返回 null，由 CardBack 使用内联 SVG。
 * 避免请求不存在的旧路径，被开发服务器 SPA fallback 当作 HTML 加载。 */
export function getCardBackImage(): string | null {
  return resourceManager.get('card/back');
}
