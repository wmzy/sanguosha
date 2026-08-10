// skills/cards/index.ts — CardEffect 静态注册表与查表函数。
// 类型定义在 types/card-effect.ts;帧状态操作(isCancelled 等)在 core/frame.ts。
// 新增卡牌效果时在 skills/cards/ 下创建文件并在此 cardEffectMap 添加条目。
import type { CardEffect } from '../../types';
import { arrowVolleyEffect } from './万箭齐发';
import { indulgenceEffect } from './乐不思蜀';
import { bountifulHarvestEffect } from './五谷丰登';
import { borrowedSwordEffect } from './借刀杀人';
import { supplyShortageEffect } from './兵粮寸断';
import { duelEffect } from './决斗';
import { barbarianInvasionEffect } from './南蛮入侵';
import { exNihiloEffect } from './无中生有';
import { nullificationEffect } from './无懈可击';
import { slashEffect } from './杀';
import { peachEffect } from './桃';
import { peachGardenEffect } from './桃园结义';
import { fireAttackEffect } from './火攻';
import { dismantleEffect } from './过河拆桥';
import { wineEffect } from './酒';
import { chainEffect } from './铁索连环';
import { dodgeEffect } from './闪';
import { lightningEffect } from './闪电';
import { snatchEffect } from './顺手牵羊';

export const cardEffectMap: Record<string, CardEffect> = {
  '万箭齐发': arrowVolleyEffect,
  '乐不思蜀': indulgenceEffect,
  '五谷丰登': bountifulHarvestEffect,
  '借刀杀人': borrowedSwordEffect,
  '兵粮寸断': supplyShortageEffect,
  '决斗': duelEffect,
  '南蛮入侵': barbarianInvasionEffect,
  '无中生有': exNihiloEffect,
  '无懈可击': nullificationEffect,
  '杀': slashEffect,
  '桃': peachEffect,
  '桃园结义': peachGardenEffect,
  '火攻': fireAttackEffect,
  '过河拆桥': dismantleEffect,
  '酒': wineEffect,
  '铁索连环': chainEffect,
  '闪': dodgeEffect,
  '闪电': lightningEffect,
  '顺手牵羊': snatchEffect,
};

export function getCardEffect(cardName: string): CardEffect | undefined {
  return cardEffectMap[cardName];
}

export function requireCardEffect(cardName: string): CardEffect {
  const effect = cardEffectMap[cardName];
  if (!effect) throw new Error(`CardEffect 未注册: ${cardName}`);
  return effect;
}

export function hasCardEffect(cardName: string): boolean {
  return cardName in cardEffectMap;
}

export function getAllCardEffects(): [string, CardEffect][] {
  return Object.entries(cardEffectMap);
}
