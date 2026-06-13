// src/engine/cards/装备.ts — 装备牌模板
import type { Card } from '../types';

const allRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function make(name: string, subtype: string, count: number, suits: Card['suit'][]): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    const suit = suits[i % suits.length];
    const rank = allRanks[i % allRanks.length];
    cards.push({ id: `${name}-${suit}-${rank}-${i}`, name, suit, rank, type: '装备牌', subtype });
  }
  return cards;
}

const S = '♠' as const;
const H = '♥' as const;
const C = '♣' as const;
const D = '♦' as const;

// 武器
export const 诸葛连弩牌堆: Card[] = make('诸葛连弩', '武器', 1, [S, C]);
export const 青釭剑牌堆: Card[] = make('青釭剑', '武器', 1, [S]);
export const 雌雄双股剑牌堆: Card[] = make('雌雄双股剑', '武器', 1, [S]);
export const 贯石斧牌堆: Card[] = make('贯石斧', '武器', 1, [S]);
export const 青龙偃月刀牌堆: Card[] = make('青龙偃月刀', '武器', 1, [S]);
export const 丈八蛇矛牌堆: Card[] = make('丈八蛇矛', '武器', 1, [S]);
export const 方天画戟牌堆: Card[] = make('方天画戟', '武器', 1, [D]);
export const 麒麟弓牌堆: Card[] = make('麒麟弓', '武器', 1, [H]);

export const 武器牌堆: Card[] = [
  ...诸葛连弩牌堆, ...青釭剑牌堆, ...雌雄双股剑牌堆, ...贯石斧牌堆,
  ...青龙偃月刀牌堆, ...丈八蛇矛牌堆, ...方天画戟牌堆, ...麒麟弓牌堆,
];

// 防具
export const 八卦阵牌堆: Card[] = make('八卦阵', '防具', 2, [S, C]);
export const 仁王盾牌堆: Card[] = make('仁王盾', '防具', 1, [C]);

export const 防具牌堆: Card[] = [...八卦阵牌堆, ...仁王盾牌堆];

// 马
export const 赤兔牌堆: Card[] = make('赤兔', '进攻马', 1, [H]);
export const 紫骍牌堆: Card[] = make('紫骍', '进攻马', 1, [D]);
export const 大宛牌堆: Card[] = make('大宛', '进攻马', 1, [S]);
export const 的卢牌堆: Card[] = make('的卢', '防御马', 1, [C]);
export const 绝影牌堆: Card[] = make('绝影', '防御马', 1, [S]);
export const 爪黄飞电牌堆: Card[] = make('爪黄飞电', '防御马', 1, [H]);

export const 马牌堆: Card[] = [...赤兔牌堆, ...紫骍牌堆, ...大宛牌堆, ...的卢牌堆, ...绝影牌堆, ...爪黄飞电牌堆];

export const 装备牌堆: Card[] = [...武器牌堆, ...防具牌堆, ...马牌堆];
