// types/card-effect.ts — CardEffect 接口与相关类型。
// 对齐 atom 分层:类型在 types/,数据聚合在 skills/cards/,帧状态操作在 core/frame.ts。
// skills/cards 只依赖 types(类型) + core/frame(帧操作),core 不反向依赖 skills,无循环依赖。

import type { GameState, Json } from './state';
import type { ActionContext, ActionPrompt } from './prompt';

// ── 抵消配置 ──
/** 声明一张牌能被什么牌抵消。 */
export interface CancellableBy {
  /** 抵消牌名（如 '闪'/'无懈可击'） */
  cardName: string;
  /** true=广播询问（无懈可击，所有玩家可回应）；false=定向询问（闪，仅杀目标） */
  broadcast: boolean;
}

// 使用时机
export type CardTiming =
  | '出牌阶段' // 杀/锦囊/装备/桃Ⅰ/酒Ⅰ
  | '生效前'; // 纯回应牌：在某效果生效前打出（闪=杀生效前，无懈可击=锦囊生效前）

// 使用目标规范
export type CardTargetSpec =
  | { kind: 'self' } // 自己（酒Ⅰ、无中生有）
  | { kind: 'inAttackRange'; min: 1; max: number } // 攻击范围内（杀）
  | { kind: 'distance'; dist: number; min: 1; max: 1 } // 距离N内（顺手牵羊=1）
  | { kind: 'allOthers' } // 所有其他角色（万箭/南蛮）
  | { kind: 'allPlayers' } // 所有角色（桃园/五谷）
  | { kind: 'any'; min: 1; max: number } // 任意角色（含自己，铁索连环）
  | { kind: 'other'; min: 1; max: number } // 任意其他角色（决斗）
  | { kind: 'wounded'; min: 0; max: 1 } // 已受伤角色（桃）
  | { kind: 'effect' }; // 目标是当前生效中的效果（杀/锦囊），由 respond 上下文隐式指定（闪/无懈可击）

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
  /** 延时锦囊判定生效后跳过的阶段。无此字段=不跳过(如闪电)。 */
  skipPhase?: { tag: string; phase: '出牌' | '摸牌' };
  /** 使用结算完成后回调（popFrame 前）。用于 post-use 清理，如杀的出杀次数累加。 */
  onSettle?: (state: GameState, source: number, cardId: string) => Promise<void>;
  /** 延时锦囊被无懈可击抵消时的善后（仅 delayed 牌生效，判定阶段钩子调用）。
   *  默认（未声明）由调用方移除弃置——适用于乐不思蜀/兵粮寸断。
   *  闪电声明此项：被抵消时不弃置，而是传递给下家。 */
  onCancelled?: (state: GameState, target: number, cardId: string) => Promise<void>;
  /** respond action 逻辑（打出/响应型卡牌：闪/桃(救)/酒/无懈可击 等）。 */
  respond?: {
    validate: (state: GameState, ownerId: number, params: Record<string, Json>) => string | null;
    execute: (state: GameState, ownerId: number, params: Record<string, Json>) => Promise<void>;
  };
  /** use 执行前的预处理钩子（runUseFlow 调用前）。
   *  用于双目标牌（借刀杀人）：从 params 提取 killTarget 存入 localVars，
   *  返回传给 runUseFlow 的真实 targets。 */
  preUse?: (state: GameState, ownerId: number, params: Record<string, Json>) => number[];
  /** 无效效果目标检查：返回 false 表示此锦囊对该 target 无可抵消的效果。 */
  hasEffect?: (state: GameState, target: number) => boolean;
  /** 声明本牌能被什么牌抵消。未声明时：锦囊牌自动推导为 { 无懈可击, broadcast }，其他牌不可被抵消。 */
  cancelledBy?: CancellableBy;
  prompt: ActionPrompt;
  /** respond 入口的 UI prompt（若有 respond 字段）。未提供则复用 prompt。 */
  respondPrompt?: ActionPrompt;
  label: string;
  style: 'danger' | 'primary' | 'default';
  activeWhen?: (ctx: ActionContext) => boolean;
}
