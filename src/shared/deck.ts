// src/shared/deck.ts
// 标准包(108) + 军争篇(52) = 160 张牌堆。
//
// 数据来源:三国杀WIKI_BWIKI(哔哩哔哩,官方授权社区 wiki)
//   标准包卡牌: https://wiki.biligame.com/sgs/标准包卡牌
//   军争篇卡牌: https://wiki.biligame.com/sgs/军争篇卡牌
//   维基百科/  Fandom 三国杀 Wiki 三方数据一致,互为校验。
//
// 规则:
//   - 标准包:108 张。4 花色,每花色 27 张(13 点数 × 2 + 1 张 EX 牌)。
//     每张牌有固定的花色 + 点数(官方设定,非算法生成)。
//   - 军争篇:52 张。4 花色,每花色 13 张(每点数各一张)。
//
// 关键设计:
//   - 与旧版不同,不再用 `add(name,count)` 在花色/点数数组上循环——
//     那样产出的花色点数是算法编的,与官方牌表不符。
//   - 现在用逐张精确声明的 `entry(name, suit, rank, opts?)` 表:
//     一个 (花色,点数,牌名) 三元组对应一张物理牌。
//     火杀/雷杀是带 damageType 的「杀」(subtype 仍为 '杀',不单独命名),
//     这与引擎杀.ts 的 card.damageType 读取一致。
//
// EX 牌:标准包每花色 1 张,共 4 张(♥Q 闪电 / ♠2 寒冰剑 / ♦Q 无懈可击 / ♣2 仁王盾)。
//   EX 与同点数的另一张牌共存(如 ♠2 有 雌雄双股剑、八卦阵 + EX 寒冰剑 共 3 张),
//   故 (花色,点数) 在标准包内不唯一 —— 牌 id 须用牌名区分,不能仅靠花色点数。

import type { Card, Suit, Rank, CardType, CardSubType, TrickSubType, DamageType } from './types';
import { suitColor } from './types';
import type { Rng } from './rng';
import { 装备牌列表 } from './cards/equipment';
import { getCardDescription } from './cards/description';

// ─── 装备牌射程表(从 CardDef 派生) ──────────────────────────
const equipmentRangeMap = new Map<string, number>();
for (const def of 装备牌列表) {
  if (typeof def.range === 'number') equipmentRangeMap.set(def.name, def.range);
}

// ─── 牌堆逐张声明表 ─────────────────────────────────────────
// 每行 = 一张物理牌:[牌名, 花色, 点数, opts?]
// opts.damageType: 火杀/雷杀的属性(底层牌名仍是 '杀')
// opts.trickSubtype: 锦囊的子类(延时/响应)
type Entry = [
  name: string,
  suit: Suit,
  rank: Rank,
  opts?: { damageType?: DamageType; trickSubtype?: TrickSubType },
];

// 标准包(108 张)。来源:BWIKI「标准包卡牌」牌堆构成表。
const STANDARD_DECK: Entry[] = [
  // ♥ 红桃(27 张,含 ♥Q 闪电 EX)
  ['桃园结义', '♥', 'A'],
  ['万箭齐发', '♥', 'A'],
  ['闪', '♥', '2'],
  ['闪', '♥', '2'],
  ['桃', '♥', '3'],
  ['五谷丰登', '♥', '3'],
  ['桃', '♥', '4'],
  ['五谷丰登', '♥', '4'],
  ['麒麟弓', '♥', '5'],
  ['赤兔', '♥', '5'],
  ['桃', '♥', '6'],
  ['乐不思蜀', '♥', '6', { trickSubtype: '延时锦囊' }],
  ['桃', '♥', '7'],
  ['无中生有', '♥', '7'],
  ['桃', '♥', '8'],
  ['无中生有', '♥', '8'],
  ['桃', '♥', '9'],
  ['无中生有', '♥', '9'],
  ['杀', '♥', '10'],
  ['杀', '♥', '10'],
  ['杀', '♥', 'J'],
  ['无中生有', '♥', 'J'],
  ['桃', '♥', 'Q'],
  ['过河拆桥', '♥', 'Q'],
  ['闪电', '♥', 'Q', { trickSubtype: '延时锦囊' }], // EX
  ['闪', '♥', 'K'],
  ['爪黄飞电', '♥', 'K'],

  // ♠ 黑桃(27 张,含 ♠2 寒冰剑 EX)
  ['决斗', '♠', 'A'],
  ['闪电', '♠', 'A', { trickSubtype: '延时锦囊' }],
  ['雌雄双股剑', '♠', '2'],
  ['八卦阵', '♠', '2'],
  ['寒冰剑', '♠', '2'], // EX
  ['过河拆桥', '♠', '3'],
  ['顺手牵羊', '♠', '3'],
  ['过河拆桥', '♠', '4'],
  ['顺手牵羊', '♠', '4'],
  ['青龙偃月刀', '♠', '5'],
  ['绝影', '♠', '5'],
  ['乐不思蜀', '♠', '6', { trickSubtype: '延时锦囊' }],
  ['青釭剑', '♠', '6'],
  ['杀', '♠', '7'],
  ['南蛮入侵', '♠', '7'],
  ['杀', '♠', '8'],
  ['杀', '♠', '8'],
  ['杀', '♠', '9'],
  ['杀', '♠', '9'],
  ['杀', '♠', '10'],
  ['杀', '♠', '10'],
  ['顺手牵羊', '♠', 'J'],
  ['无懈可击', '♠', 'J', { trickSubtype: '响应锦囊' }],
  ['过河拆桥', '♠', 'Q'],
  ['丈八蛇矛', '♠', 'Q'],
  ['南蛮入侵', '♠', 'K'],
  ['大宛', '♠', 'K'],

  // ♦ 方块(27 张,含 ♦Q 无懈可击 EX)
  ['诸葛连弩', '♦', 'A'],
  ['决斗', '♦', 'A'],
  ['闪', '♦', '2'],
  ['闪', '♦', '2'],
  ['闪', '♦', '3'],
  ['顺手牵羊', '♦', '3'],
  ['闪', '♦', '4'],
  ['顺手牵羊', '♦', '4'],
  ['闪', '♦', '5'],
  ['贯石斧', '♦', '5'],
  ['杀', '♦', '6'],
  ['闪', '♦', '6'],
  ['杀', '♦', '7'],
  ['闪', '♦', '7'],
  ['杀', '♦', '8'],
  ['闪', '♦', '8'],
  ['杀', '♦', '9'],
  ['闪', '♦', '9'],
  ['杀', '♦', '10'],
  ['闪', '♦', '10'],
  ['闪', '♦', 'J'],
  ['闪', '♦', 'J'],
  ['桃', '♦', 'Q'],
  ['方天画戟', '♦', 'Q'],
  ['无懈可击', '♦', 'Q', { trickSubtype: '响应锦囊' }], // EX
  ['杀', '♦', 'K'],
  ['紫骍', '♦', 'K'],

  // ♣ 梅花(27 张,含 ♣2 仁王盾 EX)
  ['决斗', '♣', 'A'],
  ['诸葛连弩', '♣', 'A'],
  ['杀', '♣', '2'],
  ['八卦阵', '♣', '2'],
  ['仁王盾', '♣', '2'], // EX
  ['杀', '♣', '3'],
  ['过河拆桥', '♣', '3'],
  ['杀', '♣', '4'],
  ['过河拆桥', '♣', '4'],
  ['杀', '♣', '5'],
  ['的卢', '♣', '5'],
  ['杀', '♣', '6'],
  ['乐不思蜀', '♣', '6', { trickSubtype: '延时锦囊' }],
  ['杀', '♣', '7'],
  ['南蛮入侵', '♣', '7'],
  ['杀', '♣', '8'],
  ['杀', '♣', '8'],
  ['杀', '♣', '9'],
  ['杀', '♣', '9'],
  ['杀', '♣', '10'],
  ['杀', '♣', '10'],
  ['杀', '♣', 'J'],
  ['杀', '♣', 'J'],
  ['借刀杀人', '♣', 'Q'],
  ['无懈可击', '♣', 'Q', { trickSubtype: '响应锦囊' }],
  ['借刀杀人', '♣', 'K'],
  ['无懈可击', '♣', 'K', { trickSubtype: '响应锦囊' }],
];

// 军争篇(52 张)。来源:BWIKI「军争篇卡牌」牌堆构成表。
// 每花色 13 张,每点数各一张。
const JUNZHENG_DECK: Entry[] = [
  // ♥ 红桃(13 张)
  ['无懈可击', '♥', 'A', { trickSubtype: '响应锦囊' }],
  ['火攻', '♥', '2'],
  ['火攻', '♥', '3'],
  ['杀', '♥', '4', { damageType: '火焰' }], // 火杀
  ['桃', '♥', '5'],
  ['桃', '♥', '6'],
  ['杀', '♥', '7', { damageType: '火焰' }], // 火杀
  ['闪', '♥', '8'],
  ['闪', '♥', '9'],
  ['杀', '♥', '10', { damageType: '火焰' }], // 火杀
  ['闪', '♥', 'J'],
  ['闪', '♥', 'Q'],
  ['无懈可击', '♥', 'K', { trickSubtype: '响应锦囊' }],

  // ♣ 梅花(13 张)
  ['白银狮子', '♣', 'A'],
  ['藤甲', '♣', '2'],
  ['酒', '♣', '3'],
  ['兵粮寸断', '♣', '4', { trickSubtype: '延时锦囊' }],
  ['杀', '♣', '5', { damageType: '雷电' }], // 雷杀
  ['杀', '♣', '6', { damageType: '雷电' }], // 雷杀
  ['杀', '♣', '7', { damageType: '雷电' }], // 雷杀
  ['杀', '♣', '8', { damageType: '雷电' }], // 雷杀
  ['酒', '♣', '9'],
  ['铁索连环', '♣', '10'],
  ['铁索连环', '♣', 'J'],
  ['铁索连环', '♣', 'Q'],
  ['铁索连环', '♣', 'K'],

  // ♠ 黑桃(13 张)
  ['古锭刀', '♠', 'A'],
  ['藤甲', '♠', '2'],
  ['酒', '♠', '3'],
  ['杀', '♠', '4', { damageType: '雷电' }], // 雷杀
  ['杀', '♠', '5', { damageType: '雷电' }], // 雷杀
  ['杀', '♠', '6', { damageType: '雷电' }], // 雷杀
  ['杀', '♠', '7', { damageType: '雷电' }], // 雷杀
  ['杀', '♠', '8', { damageType: '雷电' }], // 雷杀
  ['酒', '♠', '9'],
  ['兵粮寸断', '♠', '10', { trickSubtype: '延时锦囊' }],
  ['铁索连环', '♠', 'J'],
  ['铁索连环', '♠', 'Q'],
  ['无懈可击', '♠', 'K', { trickSubtype: '响应锦囊' }],

  // ♦ 方块(13 张)
  ['朱雀羽扇', '♦', 'A'],
  ['桃', '♦', '2'],
  ['桃', '♦', '3'],
  ['杀', '♦', '4', { damageType: '火焰' }], // 火杀
  ['杀', '♦', '5', { damageType: '火焰' }], // 火杀
  ['闪', '♦', '6'],
  ['闪', '♦', '7'],
  ['闪', '♦', '8'],
  ['酒', '♦', '9'],
  ['闪', '♦', '10'],
  ['闪', '♦', 'J'],
  ['火攻', '♦', 'Q'],
  ['骅骝', '♦', 'K'],
];

// ─── 卡牌 type/subtype 推断(从牌名查 CardDef,取权威类型) ─────
// deck.ts 只产 Card 实例(运行时数据),CardDef 是定义层。
// 引擎的 CardDef 注册在 shared/cards/{basic,tricks,equipment}.ts,
// 此处复用同一份牌名→类型映射,避免维护两套。
import { 基本牌列表, 锦囊牌列表 } from './cards';

const DEF_INDEX: Map<string, { type: CardType; subtype: CardSubType }> = new Map();
for (const def of [...基本牌列表, ...锦囊牌列表, ...装备牌列表]) {
  DEF_INDEX.set(def.name, { type: def.type, subtype: def.subtype });
}

function cardType(name: string): { type: CardType; subtype: CardSubType } {
  const t = DEF_INDEX.get(name);
  if (!t) throw new Error(`deck.ts: 未知牌名「${name}」,未在 CardDef 注册表中找到`);
  return t;
}

// ─── 牌堆构造 ───────────────────────────────────────────────
export function createStandardDeck(): Card[] {
  const deck: Card[] = [];
  let seq = 0;
  for (const [name, suit, rank, opts] of [...STANDARD_DECK, ...JUNZHENG_DECK]) {
    const { type, subtype } = cardType(name);
    const description = getCardDescription(name);
    const card: Card = {
      name,
      type,
      subtype,
      suit,
      color: suitColor(suit),
      rank,
      description,
      // 牌 id 须唯一:同花色同点数可能有多张(EX/借刀杀人等),
      // 故带 seq 后缀。引擎按 id 去重,不依赖 (suit,rank) 唯一性。
      id: `${name}-${suit}${rank}-${seq++}`,
    };
    const range = equipmentRangeMap.get(name);
    if (range != null) card.range = range;
    if (opts?.trickSubtype) card.trickSubtype = opts.trickSubtype;
    if (opts?.damageType) card.damageType = opts.damageType;
    deck.push(card);
  }
  return deck;
}

export function shuffle(deck: Card[], rng: Rng): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function drawCards(deck: Card[], count: number): { drawn: Card[]; remaining: Card[] } {
  const drawn = deck.slice(0, count);
  const remaining = deck.slice(count);
  return { drawn, remaining };
}

export function discardCards(discardPile: Card[], cards: Card[]): Card[] {
  return [...discardPile, ...cards];
}
