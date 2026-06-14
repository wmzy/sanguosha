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
//      apply atom → 等稳定点(execute 完成 OR 新 pending 创建,通过 resolveStable(state) 通知)。
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
  instantiateSkill,
  rebootstrap as skillRebootstrap,
  setSkillInstanceUnload,
  unloadSkillInstance,
} from './skill';
import { applyAtom as applyAtomImpl, getAtomDef, resolveViewEvents } from './atom';
import { clearEvents, pushEvent } from './event-stream';
// 必须 import 来注册所有 atom 定义 —— 否则 dispatch 开局会失败("atom type not found")
import './atoms';

export interface DispatchResult {
  error?: string;
  /** 游戏是否结束 */
  gameOver?: boolean;
  /** 获胜者座次下标(游戏结束时) */
  winner?: number;
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
 * system 命名空间占位座次。引擎只认座次下标,玩家真实 ID 由 session 层映射。
 * -1 = 系统(开局 action),不对应任何真实玩家槽位。
 */
const SYSTEM_OWNER = -1;

/** 从 pending atom 中提取等待目标玩家(座次下标)。所有内置等待型 atom 都有 target 字段 */
function extractPendingTarget(atom: Atom): number {
  if ('target' in atom && typeof atom.target === 'number') return atom.target;
  return -1;
}

/** 解析当前 _waitForStable Promise(若存在)。通知 stable point 事件已发生。 */
function resolveStable(state: GameState): void {
  const r = state._resolveStable;
  if (r) {
    r();
    state._waitForStable = undefined;
    state._resolveStable = undefined;
  }
}

/**
 * 建立 per-execute stable wait:创建新 _waitForStable Promise + _resolveStable resolver。
 * 每个 execute lifecycle 调用一次。续跑路径(回应/fireTimeout)必须重新调用,
 * 因为上一轮 wait 已被 applyAtom 触发 resolveStable 清掉。
 */
function setupStableWait(state: GameState): void {
  let resolveStableLocal: () => void = () => {};
  state._waitForStable = new Promise<void>((r) => { resolveStableLocal = r; });
  state._resolveStable = resolveStableLocal;
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
    id: String(state.seq),
    timestamp: Date.now() - state.startedAt,
    message,
    baseSeq: message.baseSeq ?? -1,
  });
}

function checkGameOver(state: GameState): { gameOver: boolean; winner?: number } {
  const aliveCount = state.players.filter((p) => p.alive).length;
  if (aliveCount <= 1) {
    const winner = state.players.find((p) => p.alive);
    return { gameOver: true, winner: winner?.index };
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
  return state;
}

/**
 * 异步 bootstrap:在 state 上跑完开局流程。
 *   1. 动态 import 开局 skill 模块
 *   2. 调 开局.onInit(skill, gameConfig) 注册 start action
 *   3. dispatch 开局 start → 跑完抽身份/选将/洗牌/发牌/启动第一回合
 *   4. rebootstrap(state) 给每个 player 的 skills 注册实例
 *
 * restore 路径不调 bootstrap —— 直接用 replay 出来的 state 即可。
 */
export async function bootstrap(state: GameState, gameConfig: GameConfig): Promise<void> {
  // 幂等:若 bootstrap 重入(如 restore 路径误调),先卸载旧的 开局:系统 实例,避免重复注册抛错
  unloadSkillInstance('开局', SYSTEM_OWNER);
  const 开局mod = await import('./skills/开局');
  const syntheticSkill = 开局mod.default.createSkill('开局', SYSTEM_OWNER);
  // 开局.onInit(skill, gameConfig) 是 system skill 的特殊接口
  // @ts-ignore 开局的 onInit 签名是 (skill, gameConfig),不是 SkillModule 标准 (skill, ownerId)
  const off开局 = 开局mod.onInit(syntheticSkill, gameConfig);
  // 登记实例 unload,使 unloadSkillInstance/clearAllSkillInstances 能正确清理 开局:系统
  setSkillInstanceUnload('开局', SYSTEM_OWNER, typeof off开局 === 'function' ? off开局 : () => {});

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
    // 回应路径:找到 entry 且校验通过 → 执行回应;否则视为"未有效回应"。
    // 关键:无论是否有效回应都必须 resolve slot——pending 目标若不出牌/无法回应,
    // 父 execute(如 杀)需继续结算。slot 保持挂起 = 死锁。
    if (entry) {
      const err = entry.validate(state, message.params);
      if (err === null) {
        await entry.execute(state, message.params);
      }
    }
    const resolve = slot.resolve;
    slot.resolve = () => {};
    resolve();

    // 等稳定点:重新建立 per-state stable wait,捕捉原 execute 续跑后的
    // .finally(完成)或 applyAtom 创建新 pending 事件。
    setupStableWait(state);
    await state._waitForStable;
    if (!state.pendingSlot) state._activeExecuteP = undefined
    logAction(state, message);
    state.seq += 1;
    const { gameOver, winner } = checkGameOver(state);
    return { gameOver, winner };
  }

  // === 主动 action 路径 ===
  // 纯路由:匹配不到 → 丢弃;校验失败 → 丢弃。dispatch 不认识"装备牌"等业务概念。
  const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
  if (!entry) return {};

  const validationError = entry.validate(state, message.params);
  if (validationError !== null) return { error: validationError };

  // 主动 action 路径:启动 execute,await per-state stable wait。
  // 通知触发点:execute 完成(.finally) / 新 pending 创建(applyAtom via resolveStable)。
  setupStableWait(state);

  const executeP = entry.execute(state, message.params).finally(() => {
    resolveStable(state);    // execute 完成 → 稳定点
  });
  state._activeExecuteP = executeP;
  await state._waitForStable;

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
  // 续跑路径:重新建立 stable wait 捕捉原 execute 续跑后的事件(同 dispatch 回应路径)
  setupStableWait(state);
  await state._waitForStable;
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

// ─── 帧管理 ──────────────────────────────────────────────────

/** 创建帧并压入 state.settlementStack,返回帧引用 */
export function pushFrame(
  state: GameState,
  skillId: string,
  from: number,
  params?: Record<string, Json>,
): SettlementFrame {
  const frame: SettlementFrame = {
    skillId,
    from,
    params: params ? { ...params } : {},
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
  return { skillId: '', from: -1, params: Object.freeze({}) };
}


// ─── Notify 事件 ────────────────────────────────────────────

/** 推送 notify 事件(不改变 state) */
export function pushNotify(_state: GameState, event: NotifyEvent): void {
  pushEvent({ kind: 'notify', ...event });
}

// ─── Atom apply 管线 ────────────────────────────────────────

/** 判定 atom:apply 后从牌堆顶翻一张到目标玩家 judgeZone */
function moveJudgeCardToZone(state: GameState, atom: { player: number; judgeType: string }): void {
  if (state.zones.deck.length === 0) return;
  const topCardId = state.zones.deck.shift()!;
  const target = state.players[atom.player];
  if (target) target.judgeZone.push(topCardId);
}

/** 判定 atom 收尾:把目标 judgeZone 顶部牌移入弃牌堆 */
function cleanupJudgeZone(state: GameState, atom: { player: number; judgeType: string }): void {
  const target = state.players[atom.player];
  if (!target || target.judgeZone.length === 0) return;
  const topId = target.judgeZone.pop()!;
  state.zones.discardPile.push(topId);
}

/**
 * 应用一个 atom:走完整 pipeline(before hooks → validate → apply → emit event → after hooks → pending)。
 * 等待型 atom 的 Promise 会挂起直到回应/超时。
 */
export async function applyAtom(state: GameState, atom: Atom): Promise<void> {
  state.atomStack.push(atom);

  // before 阶段:折叠(folding)语义。hooks 按注册顺序(座次序)依次跑,
  // 每个 hook 可 pass/modify/cancel。modify 叠加(藤甲-1 后白银狮子看到减过的值);
  // cancel 终止(仁王盾取消后后续 hook 不跑,atom 不进入 validate/apply/after)。
  let current = atom;
  let cancelled = false;
  for (const h of getBeforeHooks(atom.type)) {
    const frame = topFrame(state) ?? emptyFrame();
    const beforeCtx: AtomBeforeContext = {
      state,
      atom: current,
      ownerId: h.ownerId,
      frame,
      params: (frame.params ?? {}) as Record<string, Json>,
    };
    const result = await h.handler(beforeCtx);
    if (result === undefined) continue;             // void = pass(向后兼容)
    if (result.kind === 'cancel') { cancelled = true; break; }
    if (result.kind === 'modify') { current = result.atom; }  // 后续 hook + validate + apply 用新值
  }

  if (cancelled) {
    state.atomStack.pop();
    // cancel 非静默:推 notify 事件让前端感知(技能可据此显示"伤害被取消")
    pushNotify(state, { skillId: '', eventType: 'atomCancelled', data: { atomType: atom.type } });
    return;
  }

  const def = getAtomDef(current.type);
  const error = def.validate(state, current);
  if (error !== null) {
    state.atomStack.pop();
    return;
  }

  // toViewEvents 必须在 apply 之前调用——此时 state 尚未变更
  const viewEvents = resolveViewEvents(state, current);

  applyAtomImpl(state, current);

  pushEvent({ kind: 'atom', atom: current, viewEvents });

  if (current.type === '判定') {
    moveJudgeCardToZone(state, current);
  }


  // 技能生命周期:添加技能/移除技能 atom apply 后,同步注册/卸载 skill 实例。
  // 与 判定 同属"引擎管理的 atom 特殊处理"(技能生命周期是引擎职责,不是 atom 自身职责)。
  // apply 是同步的(只改 player.skills 列表),实例化涉及动态 import 故在此异步补注册。
  if (current.type === '添加技能') {
    await instantiateSkill(current.skillId, current.player);
  } else if (current.type === '移除技能') {
    unloadSkillInstance(current.skillId, current.player);
  }

  const afterHooks = getAfterHooks(current.type);
  for (const h of afterHooks) {
    const curFrame = topFrame(state) ?? emptyFrame();
    const afterCtx: AtomAfterContext = {
      state,
      atom: current,
      ownerId: h.ownerId,
      frame: curFrame,
      params: (curFrame.params ?? {}) as Record<string, Json>,
    };
    await h.handler(afterCtx);
  }

  state.atomStack.pop();

  if (current.type === '判定') {
    cleanupJudgeZone(state, current);
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
        atom: current,
        definition: def,
        startTime: Date.now() - state.startedAt,
        deadline: Date.now() - state.startedAt + timeoutMs,
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
