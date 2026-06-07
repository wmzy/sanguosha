import type { CardDef } from '../types';

export const 杀: CardDef = {
  name: '杀',
  type: '基本牌',
  subtype: '杀',
  targetFilter: { type: 'inRange' },
  effect: { type: 'damage', amount: 1 },
  responseWindow: 'kill_response',
  usageLimit: { perTurn: 1 },
};

export const 闪: CardDef = {
  name: '闪',
  type: '基本牌',
  subtype: '闪',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
};

export const 桃: CardDef = {
  name: '桃',
  type: '基本牌',
  subtype: '桃',
  targetFilter: { type: 'self' },
  effect: { type: '回复体力', amount: 1 },
};

export const 基本牌列表: CardDef[] = [杀, 闪, 桃];
