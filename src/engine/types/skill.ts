// Skill 类型:技能定义/结算帧/pending slot/registry/事件 envelope。
// 原 src/engine/types.ts 的 Skill/Registry/SkillDef 段(PendingView 已移至 view.ts)。

import type { Card, CardWrapper, GameState, Json } from './state';
import type {
  Atom,
  AtomAfterContext,
  AtomBeforeContext,
  AtomDefinition,
  AtomEffect,
  HookResult,
  ViewEvent,
  ViewEventSplit,
} from './atom';
import type { GameView } from './view';
import type { ActionActiveWhen, ActionPrompt } from './prompt';

// ==================== Skill ====================

export interface Skill {
  id: string;
  ownerId: number;
  name: string;
  description: string;
}

/**
 * 结算帧:execute 本地状态。纯数据——所有状态变更通过顶层函数 applyAtom/pushNotify。
 * 技能通过 pushFrame 创建并压入 settlementStack;技能负责 popFrame 配对弹出。
 *
 * `params` 的两层语义:
 *  - **配置数据**(cardId/targets 等):pushFrame 时初始化,后续只读。
 *  - **可变结算状态**(如 resolvedTargets):允许 mutate 数组元素(引用语义),
 *    用于被动技能在 hook 中修改结算目标。典型:流离在 成为目标 after hook 中
 *    改写 frame.params.resolvedTargets[i],杀在后续结算循环读到新目标。
 *    这种 mutate 绑定在特定帧上,天然支持嵌套(南蛮→杀→流离 各有独立帧),
 *    优于迁到全局 localVars(会被嵌套同名帧覆盖)。
 *  - 不要替换 params 对象本身,只改内部字段。
 *
 * 跨 atom 通信的一般途径是 state 观察(zones/tags/marks/localVars);
 * params 的可变字段是针对"结算目标在 hook 中被改写"这一场景的特设机制。
 */
export interface SettlementFrame {
  skillId: string;
  from: number;
  /** execute 本地参数。pushFrame 时初始化;配置字段只读,resolvedTargets 等可变字段允许 mutate 元素。 */
  params: Record<string, Json>;
  /** 本帧的牌区(替代全局 zones.processing)。牌的进出通过 移动牌 atom({ zone: '处理区' }) 隐式操作栈顶帧的此字段。
   *  嵌套结算时各帧各自独立——天然隔离,无需 find(name) 脆弱区分。 */
  cards: string[];
}

/** Pending 区——等待玩家操作的 slot */
export interface PendingSlot {
  atom: Atom;
  definition: AtomDefinition;
  startTime: number;
  deadline: number;
  /** 是否为阻塞型 pending。非阻塞型(出牌窗口)不阻止玩家出牌/用技,不计入 hasBlockingPending。 */
  isBlocking: boolean;
  /** 创建时的 state.seq，作为 pending 窗口版本号。
   *  respond 路径用 action.pendingSeq 与此对比：不匹配 = 响应了过期窗口 → 拒绝。
   *  close-reopen 时新 slot 会有新 createdSeq。 */
  createdSeq: number;
  resolve: () => void;
  /** 超时定时器是否已触发(已被 fireTimeout 接管)。dispatch 据 this 丢弃竞态中的用户 action */
  isTimeout: boolean;
  /** 取消超时定时器(不触发)。dispatch 走用户 action 路径前调用,让 respond execute 独占推进 */
  pause: () => void;
  /** 内部:由引擎创建 pending 时挂上,供 fireTimeout 立即触发 onTimeout(绕过真实 setTimeout) */
  _fireTimeoutNow?: () => Promise<void>;
  /** 广播型 pending 中已放弃回应的玩家集合(skip 机制)。
  *  全员 skip 时提前触发超时,不必等真实定时器。仅广播型 slot 使用。 */
  skippedPlayers?: Set<number>;
}

export interface ClientMessage {
  skillId: string;
  actionType: string;
  ownerId: number;
  params: Record<string, Json>;
  baseSeq: number;
  /** 可选：respond 响应的 pending 窗口 seq。
   *  服务端校验 slot.createdSeq === pendingSeq：不匹配 = 响应了过期窗口 → 拒绝。
   *  主动 action 不带此字段（不影响）。 */
  pendingSeq?: number;
  /**
   * 可选:在主 action 前顺序执行的前置 action 序列(转化类)。
   * dispatch 逐个 validate+execute;主 action validate 失败时,对已执行的 preceding
   * 按逆序调用 rollback 恢复 state。典型:武圣转化(红牌→杀) 在 杀.use 之前。
   */
  preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>;
}

export interface NotifyEvent {
  skillId: string;
  eventType: string;
  data: Json;
  views?: ReadonlyMap<string, Json>;
}

export interface ActionLogEntry {
  id: string;
  timestamp: number;
  message: ClientMessage;
  baseSeq: number;
}
// ==================== 内部 Registry 类型 ====================

export interface ActionEntry {
  skillId: string;
  ownerId: number;
  actionType: string;
  /**
   * 验证消息合法性:返回 null 表示通过,返回字符串为错误信息。
   * ownerId 已在 entry.ownerId 上,无需重复传入。
   */
  validate: (state: GameState, params: Record<string, Json>) => string | null;
  /**
   * 技能 execute:顶层函数式 API。
   * ownerId 已在 entry.ownerId 上,无需重复传入。
   */
  execute: (state: GameState, params: Record<string, Json>) => Promise<void>;
  /**
   * 可选:回滚 execute 的副作用。仅"可组合 action"(用于 preceding)需要实现。
   * dispatch 执行 preceding 序列时,若主 action 或后续 preceding 的 validate 失败,
   * 对已执行的 preceding 按逆序调用 rollback,恢复 state。
   * 普通非组合 action 不实现(undefined)。
   */
  rollback?: (state: GameState, params: Record<string, Json>) => void;
}

export interface AtomHookEntry {
  skillId: string;
  ownerId: number;
  atomType: string;
  phase: 'before' | 'after';
  /** before 钩子可返回 HookResult(pass/modify/cancel);after 钩子返回 void */
  handler: (ctx: AtomBeforeContext | AtomAfterContext) => Promise<HookResult | void>;
}

// ==================== SkillDef ====================

/**
 * 旧 BackendAPI(给 onInit 传闭包)已删除。
 * 新版 onInit 签名:`(skill: Skill, ownerId: number) => (() => void) | void`。
 * ownerId 是座次下标(与 PlayerState.index 一致)。
 * skill 内部直接 import { registerAction, registerBeforeHook, registerAfterHook } from '../skill'
 * 并调用,ownerId 由 onInit 第二参数注入。
 */
export interface SkillModule {
  createSkill: (id: string, ownerId: number) => Skill;
  onInit?: (skill: Skill, state: GameState) => (() => void) | void;
  onMount?: (skill: Skill, api: FrontendAPI) => (() => void) | void;
}

export interface FrontendAPI {
  viewer: number;
  onEvent(handler: (event: GameEvent, view: GameView) => void): () => void;
  defineAction(
    actionType: string,
    opts: {
      label: string;
      style?: 'primary' | 'danger' | 'default' | 'passive';
      prompt: ActionPrompt;
      transform?: (card: Card) => CardWrapper;
      /** 激活谓词:声明该 action 何时该被前端渲染为可交互控件。
       *  缺省(undefined)时的语义由前端集中实现:出牌类(use)缺省 = 出牌阶段+当前视角回合+无 pending。
       *  主动技(confirm/distribute/转化)按需声明更宽或更窄的条件。 */
      activeWhen?: ActionActiveWhen;
      /** respond action 服务的 pending requestType(如 '桃/求桃')。
       *  前端据此区分"同种回应的不同 rescue 路径":求桃时桃/酒/急救均可救援,
       *  但各自的 respond action cardFilter 不同,需按此标记合并筛选并路由 skillId。 */
      respondFor?: string;
    },
  ): void;
  playEffect(effect: AtomEffect): void;
}

export type GameEvent =
  | { kind: 'atom'; seq: number; atom: Atom; viewEvents?: ViewEventSplit }
  | {
      kind: 'notify';
      seq: number;
      skillId: string;
      eventType: string;
      data: Json;
      views?: ReadonlyMap<string, Json>;
    };

/** 引擎唯一权威事件源条目。apply 时写入，不可变。
 *  替代旧的模块级 event-stream 单例。 */
export type AppliedAtomEntry =
  | { kind: 'atom'; seq: number; timestamp: number; atom: Atom; viewEvents: ViewEventSplit }
  | {
      kind: 'notify';
      seq: number;
      timestamp: number;
      skillId: string;
      eventType: string;
      data: Json;
      views?: ReadonlyMap<string, Json>;
    };

/** 事件 envelope(per-viewer 已分叉)。session 广播用。
 *  从 engine/types 导出避免 engine→server 循环依赖。 */
export interface GameEventEnvelope {
  seq: number;
  /** 事件 timestamp,相对 game startedAt */
  timestamp: number;
  /** atom 事件(per-viewer 分叉后的视图事件) */
  view?: ViewEvent;
  /** 通知事件(per-viewer 分叉后的 data) */
  notify?: { skillId: string; eventType: string; data: Json };
}
