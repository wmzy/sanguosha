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
// 卡牌按 card.name 命名,文件后缀取决于原始素材(.jpg=基本牌扫描,.png=其他)。
// 列出所有 public/cards 下存在的文件名(含后缀),供查表。

// 基本牌(.jpg)
const BASIC_CARDS: ReadonlySet<string> = new Set(['杀', '闪', '桃', '酒', '火杀', '雷杀']);
// 装备牌(.png)——引擎已实现 + 卡牌库收录
const EQUIPMENT_CARDS: ReadonlySet<string> = new Set([
  '诸葛连弩', '青釭剑', '寒冰剑', '雌雄双股剑', '贯石斧', '丈八蛇矛', '麒麟弓', '八卦阵', '仁王盾',
  // 以下为牌库已收录但引擎暂未实现的装备(保留素材,将来接入时直接命中)
  '白银狮子', '朱雀羽扇', '三尖两刃刀', '吴六剑', '藤甲', '+1坐骑', '-1坐骑',
]);
// 锦囊牌(.png)
const TRICK_CARDS: ReadonlySet<string> = new Set([
  '决斗', '无中生有', '借刀杀人', '顺手牵羊', '过河拆桥', '无懈可击', '无懈可击·国',
  '铁索连环', '火攻', '桃园结义', '以逸待劳', '远交近攻', '南蛮入侵', '知己知彼',
  '万箭齐发', '闪电', '五谷丰登', '乐不思蜀', '兵粮寸断',
]);
// 其他(野心家等扩展素材,.jpg/.png 混合,直接以无后缀图名命名)
const OTHER_CARDS: ReadonlySet<string> = new Set(['野心家']);

const CARD_EXT: Record<string, 'png' | 'jpg'> = (() => {
  const table: Record<string, 'png' | 'jpg'> = {};
  for (const n of BASIC_CARDS) table[n] = 'jpg';
  for (const n of EQUIPMENT_CARDS) table[n] = 'png';
  for (const n of TRICK_CARDS) table[n] = 'png';
  for (const n of OTHER_CARDS) table[n] = 'jpg';
  return table;
})();

function cardCategory(name: string): 'basic' | 'equipment' | 'trick' | 'other' | null {
  if (BASIC_CARDS.has(name)) return 'basic';
  if (EQUIPMENT_CARDS.has(name)) return 'equipment';
  if (TRICK_CARDS.has(name)) return 'trick';
  if (OTHER_CARDS.has(name)) return 'other';
  return null;
}

/** 卡牌图 URL。缺失返回 null。 */
export function getCardImage(name: string): string | null {
  const cat = cardCategory(name);
  if (!cat) return null;
  const ext = CARD_EXT[name];
  const prefix = cat === 'other' ? '' : `${cat}/`;
  return `/cards/${prefix}${name}.${ext}`;
}
