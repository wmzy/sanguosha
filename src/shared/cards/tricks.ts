import type { CardDef } from '../types';

export const 过河拆桥: CardDef = {
  name: '过河拆桥',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'other', condition: (p) => p.hand.length > 0 },
  effect: { type: '弃置', source: 'hand', count: 1, target: 'selected' },
  responseWindow: 'trick_response',
};

export const 顺手牵羊: CardDef = {
  name: '顺手牵羊',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'inRange' },
  effect: { type: '获得', from: 'player', source: 'selected' },
  responseWindow: 'trick_response',
};

export const 无中生有: CardDef = {
  name: '无中生有',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'self' },
  effect: { type: '摸牌', count: 2 },
  responseWindow: 'trick_response',
};

export const 决斗: CardDef = {
  name: '决斗',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'other' },
  effect: { type: 'damage', amount: 1 },
  responseWindow: 'trick_response',
};

export const 万箭齐发: CardDef = {
  name: '万箭齐发',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'none' },
  effect: { type: 'damage', amount: 1 },
  aoeResponse: '闪',
};

export const 南蛮入侵: CardDef = {
  name: '南蛮入侵',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'none' },
  effect: { type: 'damage', amount: 1 },
  aoeResponse: '杀',
};

export const 桃园结义: CardDef = {
  name: '桃园结义',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'none' },
  effect: { type: '回复体力', amount: 1 },
};

export const 五谷丰登: CardDef = {
  name: '五谷丰登',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'none' },
  effect: { type: '摸牌', count: 1 },
};

export const 乐不思蜀: CardDef = {
  name: '乐不思蜀',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'other' },
  effect: { type: '添加延时锦囊', trickName: '乐不思蜀', target: 'selected' },
  responseWindow: 'trick_response',
};

export const 兵粮寸断: CardDef = {
  name: '兵粮寸断',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'other' },
  effect: { type: '添加延时锦囊', trickName: '兵粮寸断', target: 'selected' },
  responseWindow: 'trick_response',
};

export const 闪电: CardDef = {
  name: '闪电',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'self' },
  effect: { type: '添加延时锦囊', trickName: '闪电', target: 'self' },
};

export const 无懈可击: CardDef = {
  name: '无懈可击',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
};

export const 铁索连环: CardDef = {
  name: '铁索连环',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'other' },
  effect: { type: 'sequence', steps: [] },
  responseWindow: 'trick_response',
};

export const 火攻: CardDef = {
  name: '火攻',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'other', condition: (p) => p.hand.length > 0 },
  effect: { type: 'damage', amount: 1, damageType: '火焰' },
  responseWindow: 'trick_response',
};

// 借刀杀人(标准包普通锦囊)。引擎技能见 engine/skills/借刀杀人.ts。
// CardDef 仅声明类型;多槽位目标(持武器者 + 被杀者)由借刀杀人.ts 的 onMount defineAction 驱动。
export const 借刀杀人: CardDef = {
  name: '借刀杀人',
  type: '锦囊牌',
  subtype: '锦囊',
  targetFilter: { type: 'other' },
  effect: { type: 'sequence', steps: [] },
  responseWindow: 'trick_response',
};

export const 锦囊牌列表: CardDef[] = [
  过河拆桥,
  顺手牵羊,
  无中生有,
  决斗,
  万箭齐发,
  南蛮入侵,
  桃园结义,
  五谷丰登,
  乐不思蜀,
  兵粮寸断,
  闪电,
  无懈可击,
  铁索连环,
  火攻,
  借刀杀人,
];
