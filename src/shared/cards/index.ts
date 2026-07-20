// shared/cards/index.ts — barrel 转发现同目录 CardDef 定义（basic / tricks / equipment）
export { 基本牌列表, 杀, 闪, 桃, 酒 } from './basic';
export {
  锦囊牌列表,
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
} from './tricks';
export {
  装备牌列表,
  武器列表,
  防具列表,
  马列表,
} from './equipment';
export type { CardDef } from '../types';
