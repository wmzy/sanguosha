// src/engine/create-engine.ts
// 引擎主入口(顶层函数,无闭包)。
//
// 主要导出:
//   - create(gameConfig): 同步建 state(预创建 playerCount 个空玩家槽位),返回骨架 state
//   - bootstrap(state, gameConfig): 异步 —— 加载 开局 skill → onInit → dispatch 开局 start → rebootstrap
//   - dispatch(state, msg): 接受 state,执行 client message
//   - buildView(state, viewer): 接受 state,返回 view
//   - fireTimeout(state): 触发 pending slot 的 onTimeout
//   - resetForTest(): 模块级清空(skill instances + events)
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
  AtomAfterContext,
  AtomBeforeContext,
  ClientMessage,
  GameState,
  GameView,
  Json,
  NotifyEvent,
  PendingSlot,
  SettlementFrame,
} from './types';
import { createGameState } from './types';
import { buildView as buildViewImpl } from './view/buildView';
import {
  clearAllSkillInstances,
  findActionEntry,
  getAfterHooks,
  getBeforeHooks,
  rebootstrap as skillRebootstrap,
} from './skill';
import { applyAtom as applyAtomImpl, getAtomDef, resolveViewEvents } from './atom';
import { clearEvents, pushEvent } from './event-stream';
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


// ==================== 模块级 helpers ====================

/**
 * system 命名空间占位 ownerId。客户端不会用此值(WS handler 注入真实玩家名),
 * engine 内部 dispatch 只在 system skill 触发路径(如 bootstrap)用到。
 */
const SYSTEM_OWNER = '系统';

/** 从 pending atom 中提取等待目标玩家。所有内置等待型 atom 都有 target 字段 */
function extractPendingTarget(atom: Atom): string {
  if ('target' in atom && typeof atom.target === 'string') return atom.target;
  return '';
}

/** 解析当前 _waitForStable Promise(若存在)。通知 stable point 事件已发生。 */
function resolveStable(state: GameState): void {
  // 任务 1 中间态:在 _waitForStable 尚未被任何路径 await 的情况下,
  // 也转发到旧的模块级 notifier,保持 dispatch() 的行为不变。
  // Task 2-4 把 dispatch/response/fireTimeout 改用 state._waitForStable 后,
  // 这条 fallback 路径变成死代码,Task 5 会和模块级 notifier 一起删除。
  notifyDispatchReady();
  const r = state._resolveStable;
  if (r) {
    r();
    state._waitForStable = undefined;
    state._resolveStable = undefined;
  }
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
 *   2. 调 开局.onInit(skill, ownerId) 注册 start action(从 state._gameConfig 读配置)
 *   3. dispatch 开局 start → 跑完抽身份/选将/洗牌/发牌/启动第一回合
 *   4. rebootstrap(state) 给每个 player 的 skills 注册实例
 *
 * restore 路径不调 bootstrap —— 直接用 replay 出来的 state 即可。
 *
 * config 不通过参数传 —— 由 create(config) 时已 stash 到 state._gameConfig,这里读 state。
 */
export async function bootstrap(state: GameState): Promise<void> {
  const gameConfig = (state as GameState & { _gameConfig?: GameConfig })._gameConfig;
  if (!gameConfig) {
    throw new Error('bootstrap: state._gameConfig 缺失(请用 create(config) 创建 state)');
  }

  const 开局mod = await import('./skills/开局');
  const syntheticSkill = 开局mod.default.createSkill('开局', SYSTEM_OWNER);
  // 开局.onInit(skill, state) 是 system skill 的特殊接口
  // @ts-ignore 开局的 onInit 签名是 (skill, state),不是 SkillModule 标准 (skill, ownerId)
  开局mod.onInit(syntheticSkill, state);

  // 2. dispatch 开局 start
  const result = await dispatch(state, {
    skillId: '开局',
    actionType: 'start',
    ownerId: SYSTEM_OWNER,
    params: { ...gameConfig } as Record<string, Json>,
    baseSeq: 0,
  });
  if (result.error) throw new Error(`开局失败: ${result.error}`);

  // 3. 给每个 player 的 skills 注册实例(开局时玩家技能已通过 选将 atom 注入)
  await skillRebootstrap(state);
}

/**
 * 重新注册 state 中所有玩家的技能实例(用于初始化游戏后)。
 * 通过 skillLoaders 动态 import 加载技能模块。
 */
export async function rebootstrap(state: GameState): Promise<void> {
  await skillRebootstrap(state);
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
      const err = entry.validate(state, message.params);
      if (err === null) {
        await entry.execute(state, message.params);
      }
    } else {
      // 无匹配 entry(如 confirm/distribute):merge message.params 到 topFrame,
      // 让原始 execute 恢复后能通过 ctx.params 读到回应数据
      const frame = state.settlementStack[state.settlementStack.length - 1];
      if (frame) {
        Object.assign(frame.params, message.params);
      }
    }
    const resolve = slot.resolve;
    slot.resolve = () => {};
    resolve();

    // 等稳定点:重新建立 per-state stable wait,捕捉原 execute 续跑后的
    // .finally(完成)或 applyAtom 创建新 pending 事件。
    let resolveStableLocal: () => void = () => {};
    state._waitForStable = new Promise<void>((r) => { resolveStableLocal = r; });
    state._resolveStable = resolveStableLocal;
    await state._waitForStable;
    if (!state.pendingSlot) state._activeExecuteP = undefined
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

  const validationError = entry.validate(state, message.params);
  if (validationError !== null) return { error: validationError };

  // 主动 action 路径:启动 execute,await per-state stable wait。
  // 通知触发点:execute 完成(.finally) / 新 pending 创建(applyAtom via resolveStable)。
  let resolveStableLocal: () => void = () => {};
  state._waitForStable = new Promise<void>((r) => { resolveStableLocal = r; });
  state._resolveStable = resolveStableLocal;

  const executeP = entry.execute(state, message.params).finally(() => {
    resolveStable(state);    // execute 完成 → 稳定点
  });
  state._activeExecuteP = executeP;

  // 等到稳定点(execute 完成 OR 新 pending 创建)就返回当前 state。
  // 不 await executeP 本身 —— execute 可能挂在 pending slot 上。
  await state._waitForStable;
  // activeExecuteP 挂在 pending 处,不等它;回应路径 dispatch 会 await 它

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
  // 不等 activeExecuteP:execute 恢复后可能产生新 pending 或完成,
  // 下一次 dispatch/fireTimeout 会处理。仅当 execute 已完成时清理。
  if (state._activeExecuteP) {
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (state.pendingSlot) { clearInterval(timer); resolve(); }
          }, 0);
          state._activeExecuteP!.then(() => { clearInterval(timer); resolve(); });
        });
      }
  if (!state.pendingSlot) state._activeExecuteP = undefined
  const { gameOver, winner } = checkGameOver(state);
  return { gameOver, winner };
}

/**
 * 测试用:模块级清空(skill instances + events)。
 * state 上的字段（pendingSlot、_activeExecuteP 等）随 state 生死，不需要在这里清理。
 */
export function resetForTest(): void {
  clearAllSkillInstances();
  clearEvents();
}

// ==================== 从 engine-api.ts 合并的导出 ====================
// 以下函数原属 engine-api.ts,现已合并到本文件。skill 文件通过 import from '../create-engine' 使用。

// ─── 模块级 dispatch ready 通知器 ──────────────────────────────

let currentDispatchReady: () => void = () => {};

export function setDispatchReady(fn: () => void): void {
  currentDispatchReady = fn;
}

export function clearDispatchReady(): void {
  currentDispatchReady = () => {};
}

function notifyDispatchReady(): void {
  currentDispatchReady();
}

// ─── 帧管理 ──────────────────────────────────────────────────

/** 创建帧并压入 state.settlementStack,返回帧引用 */
export function pushFrame(
  state: GameState,
  skillId: string,
  from: string,
  params?: Record<string, Json>,
): SettlementFrame {
  const frame: SettlementFrame = {
    skillId,
    from,
    params: params ? { ...params } : {},
    cards: [],
  };
  state.settlementStack.push(frame);
  return frame;
}

/** 弹出栈顶帧 */
export function popFrame(state: GameState): void {
  if (state.settlementStack.length > 0) state.settlementStack.pop();
}

/** 取栈顶帧(只读引用) */
export function topFrame(state: GameState): SettlementFrame | undefined {
  return state.settlementStack[state.settlementStack.length - 1];
}

/** 兜底空帧 */
function emptyFrame(): SettlementFrame {
  return { skillId: '', from: '', params: Object.freeze({}), cards: [] };
}

// ─── Drop 标志 ───────────────────────────────────────────────

/** 在 before 钩子中调 dropAtom(state) 会让当前 atom 的 validate/apply 跳过。 */
export function dropAtom(state: GameState): void {
  state._dropNext = true;
}

// ─── Notify 事件 ────────────────────────────────────────────

/** 推送 notify 事件(不改变 state) */
export function pushNotify(_state: GameState, event: NotifyEvent): void {
  pushEvent({ kind: 'notify', ...event });
}

// ─── Atom apply 管线 ────────────────────────────────────────

/** 判定 atom:apply 后从牌堆顶翻一张到目标玩家 judgeZone */
function moveJudgeCardToZone(state: GameState, atom: { player: string; judgeType: string }): void {
  if (state.zones.deck.length === 0) return;
  const topCardId = state.zones.deck.shift()!;
  const target = state.players.find((p) => p.name === atom.player);
  if (target) target.judgeZone.push(topCardId);
}

/** 判定 atom 收尾:把目标 judgeZone 顶部牌移入弃牌堆 */
function cleanupJudgeZone(state: GameState, atom: { player: string; judgeType: string }): void {
  const target = state.players.find((p) => p.name === atom.player);
  if (!target || target.judgeZone.length === 0) return;
  const topId = target.judgeZone.pop()!;
  state.zones.discardPile.push(topId);
}

/**
 * 应用一个 atom:走完整 pipeline(before hooks → validate → apply → emit event → after hooks → pending)。
 * 等待型 atom 的 Promise 会挂起直到回应/超时。
 */
export async function applyAtom(state: GameState, atom: Atom): Promise<void> {
  state._dropNext = false;
  state.atomStack.push(atom);

  const beforeHooks = getBeforeHooks(atom.type);
  for (const h of beforeHooks) {
    if (state._dropNext) break;
    const frame = topFrame(state) ?? emptyFrame();
    const beforeCtx: AtomBeforeContext = {
      state,
      atom,
      ownerId: h.ownerId,
      frame,
      params: (frame.params ?? {}) as Record<string, Json>,
    };
    await h.handler(beforeCtx);
  }

  if (state._dropNext) {
    state.atomStack.pop();
    state._dropNext = false;
    return;
  }

  const def = getAtomDef(atom.type);
  const error = def.validate(state, atom);
  if (error !== null) {
    state.atomStack.pop();
    return;
  }

  // toViewEvents 必须在 apply 之前调用——此时 state 尚未变更
  const viewEvents = resolveViewEvents(state, atom);

  applyAtomImpl(state, atom);

  pushEvent({ kind: 'atom', atom, viewEvents });

  if (atom.type === '判定') {
    moveJudgeCardToZone(state, atom);
  }

  const afterHooks = getAfterHooks(atom.type);
  for (const h of afterHooks) {
    const curFrame = topFrame(state) ?? emptyFrame();
    const afterCtx: AtomAfterContext = {
      state,
      atom,
      ownerId: h.ownerId,
      frame: curFrame,
      params: (curFrame.params ?? {}) as Record<string, Json>,
    };
    await h.handler(afterCtx);
  }

  state.atomStack.pop();

  if (atom.type === '判定') {
    cleanupJudgeZone(state, atom);
  }

  if (def.pending) {
    await new Promise<void>((resolve) => {
      const pending = def.pending!;
      const timeoutMs = pending.timeout * 1000;
      let resolveCalled = false;
      const safeResolve = () => {
        if (resolveCalled) return;
        resolveCalled = true;
        clearTimeout(timer);
        resolve();
      };
      const slot: PendingSlot = {
        atom,
        definition: def,
        startTime: Date.now(),
        deadline: Date.now() + timeoutMs,
        resolve: safeResolve,
      };
      if (state.pendingSlot) {
        state.pendingSlot.resolve();
        state.pendingSlot = undefined;
      }
      state.pendingSlot = slot;

      const fireTimeoutNow = async (): Promise<void> => {
        if (state.pendingSlot !== slot) return;
        clearTimeout(timer);
        state.pendingSlot = undefined;
        await applyAtom(state, pending.onTimeout);
        safeResolve();
      };
      slot._fireTimeoutNow = fireTimeoutNow;

      const timer = setTimeout(fireTimeoutNow, timeoutMs);
      resolveStable(state);
    });
  }
}
