// src/engine/cards/基础.ts — 基本牌模板
import type { Card } from '../types';

const allSuits: Card['suit'][] = ['♠', '♥', '♣', '♦'];
const redSuits: Card['suit'][] = ['♥', '♦'];
const allRanks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function make(name: string, count: number, suits: Card['suit'][], subtype?: string): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    const suit = suits[i % suits.length];
    const rank = allRanks[i % allRanks.length];
    cards.push({ id: `${name}-${suit}-${rank}-${i}`, name, suit, rank, type: '基本牌', subtype });
  }
  return cards;
}

export const 杀牌堆: Card[] = make('杀', 30, allSuits);
export const 闪牌堆: Card[] = make('闪', 15, redSuits);
export const 桃牌堆: Card[] = make('桃', 8, redSuits);

export const 基本牌堆: Card[] = [...杀牌堆, ...闪牌堆, ...桃牌堆];
