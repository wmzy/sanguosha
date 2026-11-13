// src/engine/util/non-delay-tricks.ts — 非延时锦囊清单(单一来源)。
//
// 集智/界集智 的触发清单、界矫诏 的可声明锦囊子集共用此处,勿再手抄名单
// (历史上三处手抄曾漂移:界集智漏了 火攻/铁索连环)。
//
// 程序化推导(非写死名单):
//   - 「锦囊牌」= card-defs 的 锦囊牌列表(定义层权威);
//   - 「延时」= CardEffect.delayed === true(乐不思蜀/兵粮寸断/闪电,与 use-card
//     的延时分支同源);
//   - 非延时锦囊 = 锦囊牌列表 − 延时锦囊,共 12 张
//     (标准版 10 + 军争篇 火攻/铁索连环;含 响应锦囊·无懈可击);
//   - 普通锦囊 = 非延时锦囊 − 响应牌(timing='生效前' 的纯回应牌,即无懈可击)。
import { 锦囊牌列表 } from '../data/card-defs';
import { getCardEffect } from '../skills/cards';

/** 非延时锦囊牌名集合(12 张,含 无懈可击)。 */
export const NON_DELAY_TRICK_NAMES: ReadonlySet<string> = new Set(
  锦囊牌列表.filter((def) => getCardEffect(def.name)?.delayed !== true).map((def) => def.name),
);

/** 普通锦囊牌名集合(11 张 = 非延时锦囊 − 响应锦囊·无懈可击)。 */
export const NORMAL_TRICK_NAMES: ReadonlySet<string> = new Set(
  [...NON_DELAY_TRICK_NAMES].filter((name) => getCardEffect(name)?.timing !== '生效前'),
);
