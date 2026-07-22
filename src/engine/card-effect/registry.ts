// card-effect/registry.ts — CardEffect 注册表与类型定义。
// 每种牌注册一个 CardEffect,包含三层信息(对齐三国杀规则文档):
//   1. 牌面信息:timing(使用时机) + target(使用目标规范)
//   2. 合法性检测:canUse(追加牌特有校验)
//   3. 使用结算:resolve(生效前响应 + 生效后效果)

import type { ActionContext, ActionPrompt, GameState, Json } from '../types';

// 使用时机
export type CardTiming =
  | '出牌阶段' // 杀/锦囊/装备/桃Ⅰ/酒Ⅰ
  | '濒死时' // 桃Ⅱ/酒Ⅱ
  | '杀生效前'; // 闪

// 使用目标规范
export type CardTargetSpec =
  | { kind: 'none' } // 无目标（无中生有）
  | { kind: 'self' } // 自己（酒Ⅰ）
  | { kind: 'inAttackRange'; min: 1; max: number } // 攻击范围内（杀）
  | { kind: 'distance'; dist: number; min: 1; max: 1 } // 距离N内（顺手牵羊=1）
  | { kind: 'allOthers' } // 所有其他角色（万箭/南蛮）
  | { kind: 'allPlayers' } // 所有角色（桃园/五谷）
  | { kind: 'other'; min: 1; max: number } // 任意其他角色（决斗）
  | { kind: 'wounded'; min: 0; max: 1 }; // 已受伤角色（桃）

// resolve 上下文
export interface ResolveCtx {
  state: GameState;
  source: number;
  target: number;
  cardId: string;
  targetIndex: number;
}

// CardEffect 接口
export interface CardEffect {
  timing: CardTiming;
  target: CardTargetSpec;
  canUse?: (state: GameState, ownerId: number, params: Record<string, Json>) => string | null;
  resolve: (ctx: ResolveCtx) => Promise<void>;
  prompt: ActionPrompt;
  label: string;
  style: 'danger' | 'primary' | 'default';
  activeWhen?: (ctx: ActionContext) => boolean;
}

const registry = new Map<string, CardEffect>();

export function registerCardEffect(cardName: string, effect: CardEffect): void {
  registry.set(cardName, effect);
}

export function getCardEffect(cardName: string): CardEffect | undefined {
  return registry.get(cardName);
}

export function requireCardEffect(cardName: string): CardEffect {
  const effect = registry.get(cardName);
  if (!effect) throw new Error(`CardEffect 未注册: ${cardName}`);
  return effect;
}

export function hasCardEffect(cardName: string): boolean {
  return registry.has(cardName);
}
