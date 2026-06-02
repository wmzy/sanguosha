// shared/cards/index.ts — v2 引擎的卡牌定义（CardDef 声明式）
// 与 shared/cards.ts（v1 数据）共存；v2 引擎和 engine/validate.ts 使用本目录。
export { 基本牌列表, 杀, 闪, 桃 } from './basic';
export { 锦囊牌列表, 过河拆桥, 顺手牵羊, 无中生有, 决斗, 万箭齐发, 南蛮入侵, 桃园结义, 五谷丰登, 乐不思蜀, 兵粮寸断, 闪电, 无懈可击 } from './tricks';
export { 装备牌列表, 武器列表, 防具列表, 马列表 } from './equipment';
export type { CardDef } from '../types';
