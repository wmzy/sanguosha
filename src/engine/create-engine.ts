// src/engine/create-engine.ts
// 引擎主入口(顶层函数,无闭包)。
//
// 主要导出:
//   - create(gameConfig): 同步建 state(预创建 playerCount 个空玩家槽位),返回骨架 state
//   - bootstrap(state, gameConfig): 异步 —— 加载 开局 skill → onInit → dispatch 开局 start → rebootstrap
//   - dispatch(state, msg): 接受 state,执行 client message
//   - buildView(state, viewer): 接受 state,返回 view
//   - fireTimeout(state): 触发 pending slot 的 onTimeout
//   - resetForTest(): 模块级清空(skill instances + events + activeExecuteP)
//
// create 是同步的(不依赖任何 IO),bootstrap 是异步的(可能要动态 import 模块)。
// 两者解耦是为了让 restoreFromLog 的路径可以跳过 bootstrap —— 恢复出来的 state 已经
// 完成了开局,不需要再 dispatch 开局 start。
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
// 必须 import 来注册所有 skill 模块(武将技能/装备技能) —— 否则 rebootstrap 在
// 遍历 state.players[i].skills 时会抛 "Skill module X not registered"。
import './skills';

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
 * 同步创建一个新游戏的骨架 state:建 playerCount 个空玩家槽位 + 初始 state shape。
 * 不会触发任何 dispatch / 初始化流程 —— 那是 bootstrap 的事。
 *
 * 调用模式:
 *   const state = create(config);
 *   await bootstrap(state, config);  // 触发 开局 start action
 *
 * 这样解耦的好处:restore 路径可以从 actionLog replay 出来一个 state,直接使用,不需要 bootstrap。
 */
export function create(gameConfig: GameConfig): GameState {
  const playerCount = Math.max(2, Math.min(8, gameConfig.playerCount));
  const stubPlayers = Array.from({ length: playerCount }, (_, i) => ({
    index: i,
    name: `player-${i}`,
    character: '',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [] as string[],
    equipment: {},
    skills: [] as string[],
    vars: {} as Record<string, Json>,
    marks: [],
    pendingTricks: [],
    judgeZone: [] as string[],
  }));

  const state = createGameState({ players: stubPlayers, cardMap: {} });
  ensureStateShape(state);
  state.startedAt = Date.now();
  // 存 gameConfig 进 state(bootstrap 阶段需要,例如 开局 skill 可能直接读它)
  // 实际 bootstrap 不需要 —— 它从 gameConfig 参数里读 —— 但存进 state 方便调试和 restore
  (state as GameState & { _gameConfig?: GameConfig })._gameConfig = gameConfig;
  return state;
}

/**
 * 异步 bootstrap:在 state 上跑完开局流程。
 *   1. 动态 import 开局 skill 模块
 *   2. 调 开局.onInit(skill, state) 注册 start action
 *   3. dispatch 开局 start → 跑完抽身份/选将/洗牌/发牌/启动第一回合
 *   4. rebootstrap(state) 给每个 player 的 skills 注册实例
 *
 * restore 路径不调 bootstrap —— 直接用 replay 出来的 state 即可。
 */
export async function bootstrap(state: GameState, gameConfig: GameConfig): Promise<void> {
  // 1. 动态 import 开局 skill 模块(其它 skill 在 ./skills 里,这里只需要开局)
  const 开局 = await import('./skills/开局');
  const syntheticSkill = 开局.createSkill('开局', '主公');
  开局.onInit(syntheticSkill, state);

  // 2. dispatch 开局 start
  const params = { ...gameConfig } as Record<string, Json>;
  const result = await dispatch(state, {
    skillId: '开局',
    actionType: 'start',
    ownerId: '主公',
    params,
    baseSeq: 0,
  });
  if (result.error) throw new Error(`开局失败: ${result.error}`);

  // 3. 给每个 player 的 skills 注册实例(开局时玩家技能已通过 选将 atom 注入)
  skillRebootstrap(state);
}

/**
 * 重新注册 state 中所有玩家的技能实例(用于初始化游戏后)。
 * 直接走 skill.rebootstrap。
 */
export function rebootstrap(state: GameState): void {
  skillRebootstrap(state);
}

/**
 * 执行一条 client message。state 必须由 create() + bootstrap() 或外部构造好后传入。
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

  // 等到 execute 抵达 pending 挂起点(fireDispatchReady 触发)就返回当前 state。
  // 不 await executeP 本身 —— execute 可能挂在 pending slot 上,要等回应或
  // fireTimeout 推进,主动 action 的调用方不需要阻塞等待。
  await dispatchReady;

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
