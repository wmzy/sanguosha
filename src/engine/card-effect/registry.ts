// card-effect/registry.ts — CardEffect 注册表与类型定义。
// 每种牌注册一个 CardEffect,包含三层信息(对齐三国杀规则文档):
//   1. 牌面信息:timing(使用时机) + target(使用目标规范)
//   2. 合法性检测:canUse(追加牌特有校验)
//   3. 使用结算:resolve(生效后效果)

import type { ActionContext, ActionPrompt, GameState, Json } from '../types';
import { setCardNameChecker } from '../skill';

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
  /** 延迟类锦囊：置入判定区（而非处理区），使用结算中延迟到判定阶段恢复。
   *  runUseFlow 在 delayed=true 时走完使用结算前（成为目标后）即暂停，
   *  由技能的判定阶段 before-hook 调用 resumeDelayedSettlement 恢复使用结算中。 */
  delayed?: boolean;
  /** 使用结算完成后回调（popFrame 前）。用于 post-use 清理，如杀的出杀次数累加。 */
  onSettle?: (state: GameState, source: number, cardId: string) => Promise<void>;
  /** respond action 逻辑（打出/响应型卡牌：闪/桃(救)/酒/无懈可击 等）。
   *  若声明则使用牌技能按卡名 skillId 注册 respond action，路由到此逻辑。
   *  validate 检查 pending slot + 牌名；execute 执行牌特有响应效果。
   *  未声明 respond 的牌不注册 respond action（如杀只有 use 入口）。 */
  respond?: {
    /** 校验：返回 null=合法，字符串=拒绝理由 */
    validate: (state: GameState, ownerId: number, params: Record<string, Json>) => string | null;
    /** 执行响应效果 */
    execute: (state: GameState, ownerId: number, params: Record<string, Json>) => Promise<void>;
  };
  /** use 执行前的预处理钩子（runUseFlow 调用前）。
   *  用于双目标牌（借刀杀人）：从 params 提取 killTarget 存入 localVars，
   *  返回传给 runUseFlow 的真实 targets（可能少于 params.targets）。
   *  未声明时 targets = params.targets 原样传入。 */
  preUse?: (state: GameState, ownerId: number, params: Record<string, Json>) => number[];
  /** 无效效果目标检查：返回 false 表示此锦囊对该 target 无可抵消的效果（不询问无懈，不结算）。
   *  典型场景：桃园结义对满血角色无回血效果 → 满血目标不询问无懈、不结算。
   *  未声明时视为所有目标均有效果。 */
  hasEffect?: (state: GameState, target: number) => boolean;
  prompt: ActionPrompt;
  /** respond 入口的 UI prompt（若有 respond 字段）。未提供则复用 prompt。 */
  respondPrompt?: ActionPrompt;
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

// 设置卡名检查器（供 skill.ts 的 unloadSkillInstance 跳过卡名同名技能的前缀清理）
setCardNameChecker((id: string) => registry.has(id));

/** 返回所有已注册的 CardEffect（卡名 → effect）。用于使用牌技能按卡名批量注册 action。 */
export function getAllCardEffects(): Map<string, CardEffect> {
  return registry;
}

// ── 「已抵消」标记机制 ──
// 通用机制：闪抵消杀、无懈可击抵消锦囊,都通过设置此标记实现。
// runSettlementPhase 在「生效前」后检查标记：已抵消 → 发出被抵消 atom → 跳过 resolve。
// 响应牌（闪/无懈）的 respond action 设置标记；无双/肉林在 after-hook 中清除标记。

const CANCELLED_PREFIX = '生效前/已抵消/';

export function cancelledKey(cardId: string, target: number): string {
  return `${CANCELLED_PREFIX}${cardId}/${target}`;
}

export function setCancelled(state: GameState, cardId: string, target: number): void {
  state.localVars[cancelledKey(cardId, target)] = true;
}

export function clearCancelled(state: GameState, cardId: string, target: number): void {
  delete state.localVars[cancelledKey(cardId, target)];
}

export function isCancelled(state: GameState, cardId: string, target: number): boolean {
  return state.localVars[cancelledKey(cardId, target)] === true;
}
