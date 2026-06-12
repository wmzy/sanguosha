// src/engine/create-engine.ts
// 引擎主入口(顶层函数,无闭包)。
//
// 主要导出:
//   - create(gameConfig): 建 state → dispatch 开局 start → rebootstrap → 返回 state
//   - dispatch(state, msg): 接受 state,执行 client message
//   - buildView(state, viewer): 接受 state,返回 view
//   - fireTimeout(state): 触发 pending slot 的 onTimeout
//   - resetForTest(): 模块级清空(skill instances + events + activeExecuteP)
//
// 两种 dispatch 路径:
//   1) 主动 action(无 pending slot):→ 调用 entry.execute(api) → 技能内部 pushFrame →
//      apply atom → 等待 fireDispatchReady(挂起点)或 execute 完成。
//   2) 回应 action(有 pending slot):merge message.params →
//      调用 entry.execute(api)(回应技能内部也 pushFrame) → consume pending →
//      等原始 execute 恢复。
//
// 帧由技能在 execute 中显式创建(api.pushFrame)和弹出(api.popFrame);dispatch 不管理帧。
// atomStack / pendingSlot 是 GameState 属性,不是 frame 属性。
// 引擎内部不 try/catch——除 bug 外不应抛错。
// actionLog 由引擎自动记录,session 不直接 mutate state。

import type {
  Atom,
  ClientMessage,
  EngineApi,
  GameState,
  GameView,
  Json,
} from './types';
import { createGameState } from './types';
import { buildView as buildViewImpl } from './view/buildView';
import {
  clearAllSkillInstances,
  findActionEntry,
  rebootstrap as skillRebootstrap,
} from './skill';
import { createEngineApi, type EngineContext } from './engine-api';
import { clearEvents } from './event-stream';
// 必须 import 来注册所有 atom 定义 —— 否则 dispatch 开局会失败("atom type not found")
import './atoms';

export interface DispatchResult {
  error?: string;
  /** 游戏是否结束 */
  gameOver?: boolean;
  /** 获胜者名字(游戏结束时) */
  winner?: string;
}

export interface GameConfig {
  characters: Array<{ name: string; skills: string[] }>;
  playerCount: number;
  seed: number;
  gameId: string;
  handSize?: number;
}

// ==================== 模块级状态(用于回应路径跟踪) ====================

/** 当前活跃的 execute Promise(回应路径上,内嵌 execute 完成后 resolve)。
 *  模块级而非闭包,以便响应内嵌 execute(action 在 apply 期间触发嵌套 action)。 */
let activeExecuteP: Promise<void> | undefined;

// ==================== 模块级 helpers ====================

/** 从 pending atom 中提取等待目标玩家。所有内置等待型 atom 都有 target 字段 */
function extractPendingTarget(atom: Atom): string {
  if ('target' in atom && typeof atom.target === 'string') return atom.target;
  return '';
}

/** 兜底:补全老 state 缺失的字段(原地变更) */
function ensureStateShape(state: GameState): void {
  if (!state.cardWrappers) state.cardWrappers = {};
  if (!state.atomStack) state.atomStack = [];
  if (!state.settlementStack) state.settlementStack = [];
  for (const p of state.players) {
    if (!p.judgeZone) p.judgeZone = [];
    if (!p.tags) p.tags = [];
  }
}

function logAction(state: GameState, message: ClientMessage): void {
  state.actionLog.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now() - state.startedAt,
    message,
    baseSeq: message.baseSeq ?? -1,
  });
}

function checkGameOver(state: GameState): { gameOver: boolean; winner?: string } {
  const aliveCount = state.players.filter((p) => p.alive).length;
  if (aliveCount <= 1) {
    const winner = state.players.find((p) => p.alive);
    return { gameOver: true, winner: winner?.name ?? '无人' };
  }
  return { gameOver: false };
}

function getViewerIndex(state: GameState, ownerName: string): number {
  return state.players.findIndex((p) => p.name === ownerName);
}

// ==================== 公开 API ====================

/**
 * 创建一个新游戏:建 state → dispatch 开局 start → rebootstrap → 返回 state。
 */
export async function create(gameConfig: GameConfig): Promise<GameState> {
  const state = createGameState({ players: [], cardMap: {} });
  ensureStateShape(state);
  state.startedAt = Date.now();
  const params = { ...gameConfig } as Record<string, Json>;
  const result = await dispatch(state, {
    skillId: '开局',
    actionType: 'start',
    ownerId: '主公',
    params,
    baseSeq: 0,
  });
  if (result.error) throw new Error(`开局失败: ${result.error}`);
  rebootstrap(state);
  return state;
}

/**
 * 重新注册 state 中所有玩家的技能实例(用于初始化游戏后)。
 * 直接走 skill.rebootstrap。
 */
export function rebootstrap(state: GameState): void {
  skillRebootstrap(state);
}

/**
 * 执行一条 client message。state 必须由 create() 或外部构造好后传入。
 */
export async function dispatch(state: GameState, message: ClientMessage): Promise<DispatchResult> {
  // === 回应路径(已有 pending slot) ===
  if (state.pendingSlot) {
    const slot = state.pendingSlot;
    const target = extractPendingTarget(slot.atom);
    if (message.ownerId !== target) return {};

    const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
    if (entry) {
      const view = buildView(state, getViewerIndex(state, message.ownerId));
      const err = entry.validate(view, message.params);
      if (err === null) {
        const ctx: EngineContext = {
          state,
          self: message.ownerId,
          messageParams: { ...message.params },
          fireDispatchReady: () => {},
        };
        const api = createEngineApi(ctx);
        await entry.execute(api);
      }
    }
    const resolve = slot.resolve;
    slot.resolve = () => {};
    resolve();

    if (activeExecuteP) await activeExecuteP;
    activeExecuteP = undefined;

    logAction(state, message);
    state.seq += 1;
    const { gameOver, winner } = checkGameOver(state);
    return { gameOver, winner };
  }

  // === 主动 action 路径 ===
  let entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
  if (!entry && message.actionType === 'use') {
    const cardId = message.params?.cardId as string | undefined;
    if (cardId) {
      const card = state.cardMap[cardId];
      if (card?.type === '装备牌') {
        entry = findActionEntry('装备通用', message.ownerId, message.actionType);
      }
    }
  }
  if (!entry) return {};

  const view = buildView(state, getViewerIndex(state, message.ownerId));
  const validationError = entry.validate(view, message.params);
  if (validationError !== null) return { error: validationError };

  // execute 返回前先等 fireDispatchReady(apply 抵达 pending 时触发),
  // 再等整条 executeP 结束(响应/超时后 resolve 收尾)
  let dispatchReadyResolve: () => void = () => {};
  const dispatchReady = new Promise<void>((r) => {
    dispatchReadyResolve = r;
  });
  let fired = false;
  const fireDispatchReady = (): void => {
    if (!fired) {
      fired = true;
      dispatchReadyResolve();
    }
  };
  const ctx: EngineContext = {
    state,
    self: message.ownerId,
    messageParams: { ...message.params, __ownerId: message.ownerId },
    fireDispatchReady,
  };
  const api: EngineApi = createEngineApi(ctx);
  const executeP = entry.execute(api).finally(fireDispatchReady);
  activeExecuteP = executeP;

  await dispatchReady;
  await activeExecuteP;
  activeExecuteP = undefined;

  logAction(state, message);
  state.seq += 1;
  const { gameOver, winner } = checkGameOver(state);
  return { gameOver, winner };
}

/**
 * 构造指定 viewer 视角的 GameView。
 */
export function buildView(state: GameState, viewer: number): GameView {
  return buildViewImpl(state, viewer);
}

/**
 * 立即触发当前 pending slot 的 onTimeout(模拟超时,绕过真实 setTimeout)。
 */
export async function fireTimeout(state: GameState): Promise<DispatchResult> {
  const slot = state.pendingSlot;
  if (!slot) return {};
  await slot._fireTimeoutNow?.();
  if (activeExecuteP) await activeExecuteP;
  activeExecuteP = undefined;
  const { gameOver, winner } = checkGameOver(state);
  return { gameOver, winner };
}

/**
 * 测试用:模块级清空(skill instances + events + activeExecuteP)。
 * 不接 state —— 引擎状态是模块级的。
 */
export function resetForTest(): void {
  clearAllSkillInstances();
  clearEvents();
  activeExecuteP = undefined;
}
