// src/engine/cards/锦囊.ts — 锦囊牌模板
import type { Card } from '../types';

const allSuits: Card['suit'][] = ['♠', '♥', '♣', '♦'];
const allRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function make(name: string, count: number, suits?: Card['suit'][]): Card[] {
  const ss = suits ?? allSuits;
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    const suit = ss[i % ss.length];
    const rank = allRanks[i % allRanks.length];
    cards.push({ id: `${name}-${suit}-${rank}-${i}`, name, suit, rank, type: '锦囊牌' });
  }
  return cards;
}

export const 过河拆桥牌堆: Card[] = make('过河拆桥', 6);
export const 顺手牵羊牌堆: Card[] = make('顺手牵羊', 5);
export const 无中生有牌堆: Card[] = make('无中生有', 4);
export const 决斗牌堆: Card[] = make('决斗', 3);
export const 万箭齐发牌堆: Card[] = make('万箭齐发', 1);
export const 南蛮入侵牌堆: Card[] = make('南蛮入侵', 3);
export const 桃园结义牌堆: Card[] = make('桃园结义', 1);
export const 五谷丰登牌堆: Card[] = make('五谷丰登', 2);
export const 乐不思蜀牌堆: Card[] = make('乐不思蜀', 1, ['♥']);
export const 兵粮寸断牌堆: Card[] = make('兵粮寸断', 1, ['♣']);
export const 闪电牌堆: Card[] = make('闪电', 2, ['♠']);
export const 无懈可击牌堆: Card[] = make('无懈可击', 4);

export const 锦囊牌堆: Card[] = [
  ...过河拆桥牌堆, ...顺手牵羊牌堆, ...无中生有牌堆, ...决斗牌堆,
  ...万箭齐发牌堆, ...南蛮入侵牌堆, ...桃园结义牌堆, ...五谷丰登牌堆,
  ...乐不思蜀牌堆, ...兵粮寸断牌堆, ...闪电牌堆, ...无懈可击牌堆,
];
