// src/engine/create-engine.ts
// 引擎主入口(顶层函数,无闭包)。
//
// 主要导出:
//   - create(gameConfig): 同步建 state(预创建 playerCount 个空玩家槽位),返回骨架 state
//   - bootstrap(state, gameConfig): 异步 —— 加载 开局 skill → onInit → dispatch 开局 start → registerSkillsFromState
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
  ActionEntry,
  ActionLogEntry,
  Atom,
  AtomAfterContext,
  AtomBeforeContext,
  AtomDefinition,
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
  registerSkillsFromState as skillRebootstrap,
  setSkillInstanceUnload,
  unloadSkillInstance,
} from './skill';
import { applyAtom as applyAtomImpl, getAtomDef, resolveViewEvents } from './atom';
import { clearEvents, pushEvent } from './event-stream';
// 必须 import 来注册所有 atom 定义 —— 否则 dispatch 开局会失败("atom type not found")
import './atoms';
// 必须 import skills/index 来设置 skillModuleResolver + 注册系统规则全局 hooks
import './skills';
import { onInit as init系统规则 } from './skills/系统规则';



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


// ==================== 公开 API ====================

/** 检查游戏是否结束。纯函数,基于 state 计算。
 *  结束条件:存活 ≤ 1 人,或主公死亡。 */
export function checkGameOver(state: GameState): { gameOver: boolean; winner?: number } {
  // 主公死亡 → 游戏立即结束
  const lord = state.players.find(p => p.identity === '主公' || p.vars['身份'] === '主公');
  if (lord && !lord.alive) {
    return { gameOver: true, winner: undefined };
  }
  const aliveCount = state.players.filter((p) => p.alive).length;
  if (aliveCount <= 1) {
    const winner = state.players.find((p) => p.alive);
    return { gameOver: true, winner: winner?.index };
  }
  return { gameOver: false };
}
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
  }));

  const state = createGameState({ players: stubPlayers, cardMap: {} });
  ensureStateShape(state);
  state.startedAt = Date.now();
  return state;
}

/**
 * 异步 bootstrap:在 state 上跑完开局流程。**不可重入**——开局一旦执行,
 * 抽身份/选将/洗牌/发牌的状态变更就开始了,无法回滚。对已开局的 state 再调
 * bootstrap 是调用方 bug,直接抛错暴露,而非"幂等"重跑。
 *
 *   1. 动态 import 开局 skill 模块
 *   2. 调 开局.onInit(skill, gameConfig) 注册 start action
 *   3. dispatch 开局 start → 跑完抽身份/选将/洗牌/发牌/启动第一回合
 *   4. registerSkillsFromState(state) 给每个 player 的 skills 注册实例
 *
 * restore 路径不调 bootstrap —— 直接用 replay 出来的 state 即可。
 */
export async function bootstrap(state: GameState, gameConfig: GameConfig): Promise<void> {
  // 防重入:开局已执行过(玩家已发牌)→ 抛错。不是"幂等"——状态变更不可回滚。
  if (state.players.some(p => p.hand.length > 0)) {
    throw new Error('bootstrap: state 已开局(玩家已有手牌),不可重复 bootstrap');
  }
  const 开局mod = await import('./skills/开局');
  const syntheticSkill = 开局mod.createSkill('开局', SYSTEM_OWNER);
  // 全局注册表幂等:先卸载旧实例(await import 之后、onInit 之前),避免
  // 跨 session/跨 test 时因微任务交织导致 "already registered" 抛错。
  unloadSkillInstance('开局', SYSTEM_OWNER);
  // 开局.onInit(skill, gameConfig) 是 system skill 的特殊接口
  // @ts-ignore 开局的 onInit 签名是 (skill, gameConfig),不是 SkillModule 标准 (skill, ownerId)
  const off开局 = 开局mod.onInit(syntheticSkill, gameConfig);
  // 登记实例 unload,使 unloadSkillInstance/clearAllSkillInstances 能正确清理 开局:系统
  setSkillInstanceUnload('开局', SYSTEM_OWNER, typeof off开局 === 'function' ? off开局 : () => {});

  // 3. dispatch 开局 start(dispatch void:非法 action 静默丢弃,开局失败通过后续 state 检查暴露)
  await dispatch(state, {
    skillId: '开局',
    actionType: 'start',
    ownerId: SYSTEM_OWNER,
    params: { ...gameConfig } as Record<string, Json>,
    baseSeq: 0,
  });
}

/**
 * 从持久化数据恢复游戏:create(config) → bootstrap → 重放 actionLog(跳过开局条目,
 * bootstrap 会重新生成)。确定性地重建完整 state + skill 注册。
 *
 * actionLog[0] 是 开局 start(bootstrap 重新生成),从 [1] 开始重放。
 */
export async function restore(state: GameState, gameConfig: GameConfig, actionLog: ActionLogEntry[]): Promise<GameState> {
  for (const entry of actionLog.slice(1)) {
    await dispatch(state, entry.message);
  }
  return state;
}

/** 测试/工具用:给预构造 state(未走 bootstrap)注册所有 player.skills 实例 */
export { registerSkillsFromState } from './skill';

/**
 * 执行一条 client message:查找合法 action 并调用。
 * - 主动 action:validate 通过 → 执行;否则静默丢弃
 * - 回应 action(pending 存在):先 resolve pending,再执行回应 execute
 * 无返回值——游戏结束等状态由调用方从 state 自行读取(checkGameOver)。
 */
export async function dispatch(state: GameState, message: ClientMessage): Promise<void> {
  // === 回应路径(已有 pending slot) ===
  if (state.pendingSlot) {
    const slot = state.pendingSlot;
    const requestType = (slot.atom as { requestType?: string }).requestType;

    // 特殊:选择询问 pending(多个询问竞争时让用户选先响应哪个)
    if (requestType === '__选择询问') {
      const choiceIdx = (message.params.choice as number) ?? 0;
      promoteChoice(state, choiceIdx);
      setupStableWait(state);
      await state._waitForStable;
      if (!state.pendingSlot) state._activeExecuteP = undefined;
      logAction(state, message);
      state.seq += 1;
      return;
    }

    // 广播 pending(无懈可击等):任何存活玩家可回应。单目标 pending:只 target 可回应。
    const isBroadcast = requestType === '无懈可击';
    if (!isBroadcast && message.ownerId !== extractPendingTarget(slot.atom)) return;
    if (isBroadcast && !state.players[message.ownerId]?.alive) return;

    const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
    if (entry && entry.validate(state, message.params) === null) {
      await entry.execute(state, message.params);
    }
    const resolve = slot.resolve;
    slot.resolve = () => {};
    resolve();
    // 当前 slot 消费后,检查 choiceQueue 是否有下一个待处理询问
    promoteChoiceQueue(state);
    setupStableWait(state);
    await state._waitForStable;
    if (!state.pendingSlot) state._activeExecuteP = undefined;
    logAction(state, message);
    state.seq += 1;
    return;
  }

  // === 主动 action 路径 ===
  // 1. 执行 preceding(转化类):逐个 validate+execute。
  //    全部成功后,主 action validate 能看到 preceding 改变后的状态(如武圣转化后杀.validate 看到"杀")。
  //    主 action validate 失败 → 对已执行的 preceding 按逆序 rollback 恢复 state。
  const executedPreceding: Array<{ entry: ActionEntry; params: Record<string, Json> }> = [];
  if (message.preceding) {
    for (const p of message.preceding) {
      const pEntry = findActionEntry(p.skillId, message.ownerId, p.actionType);
      if (!pEntry) return;
      const pErr = pEntry.validate(state, p.params);
      if (pErr !== null) return;
      await pEntry.execute(state, p.params);
      executedPreceding.push({ entry: pEntry, params: p.params });
    }
  }

  // 2. 主 action:validate
  const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
  if (!entry) {
    // 主 action 不存在 → 回滚 preceding
    rollbackPreceding(state, executedPreceding);
    return;
  }
  const validationError = entry.validate(state, message.params);
  if (validationError !== null) {
    // 主 action validate 失败 → 回滚 preceding
    rollbackPreceding(state, executedPreceding);
    return;
  }

  // 3. 主 action:execute
  setupStableWait(state);
  const executeP = entry.execute(state, message.params).finally(() => {
    resolveStable(state);
  });
  state._activeExecuteP = executeP;
  await state._waitForStable;
  logAction(state, message);
  state.seq += 1;
}

/** 对已执行的 preceding 按逆序调用 rollback(若有)。 */
function rollbackPreceding(state: GameState, executed: Array<{ entry: ActionEntry; params: Record<string, Json> }>): void {
  for (let i = executed.length - 1; i >= 0; i--) {
    const { entry, params } = executed[i];
    if (entry.rollback) entry.rollback(state, params);
  }
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
export async function fireTimeout(state: GameState): Promise<void> {
  const slot = state.pendingSlot;
  if (!slot) return;
  await slot._fireTimeoutNow?.();
  // 选择 slot 的 _fireTimeoutNow 内部会 promoteChoice;普通 slot 超时后检查队列
  if (!state.pendingSlot || state.pendingSlot === slot) {
    promoteChoiceQueue(state);
  }
  setupStableWait(state);
  await state._waitForStable;
  if (!state.pendingSlot) state._activeExecuteP = undefined;
}

/** 测试用:模块级清空(skill instances + events)。 */
export function resetForTest(): void {
  clearAllSkillInstances();
  clearEvents();
  // 重新注册系统规则全局 hooks(被 clearAllSkillInstances 清掉了)
  init系统规则({ id: '系统规则', ownerId: -1, name: '系统规则', description: '' }, -1);
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

/**
 * 多询问:choiceQueue 中有 2+ 个 slot 时,创建"选择先响应哪个"的 pending slot。
 * 用户通过 respond {choice: index} 选择。选完后被选中的 slot 晋升为 pendingSlot。
 */
function makeChoiceSlot(state: GameState): PendingSlot {
  const queue = state.choiceQueue ?? [];
  const choices = queue.map((s, i) => {
    const atom = s.atom as Record<string, unknown>;
    return { index: i, type: s.atom.type, requestType: atom.requestType, target: extractPendingTarget(s.atom) };
  });
  const slot: PendingSlot = {
    atom: { type: '请求回应', requestType: '__选择询问', target: choices[0]?.target ?? 0, prompt: { type: 'choosePlayer' as const, title: '请选择先响应哪个询问', min: 1, max: 1 }, defaultChoice: 0, timeout: 30 } as unknown as Atom,
    definition: { type: '请求回应', validate: () => null, apply: () => {} } as unknown as AtomDefinition,
    startTime: Date.now() - state.startedAt,
    deadline: Date.now() - state.startedAt + 30000,
    resolve: () => {},
    _fireTimeoutNow: async () => {
      // 选择超时:默认选第一个
      promoteFirstChoice(state);
    },
  };
  state.localVars['__choiceOptions'] = JSON.parse(JSON.stringify(choices)) as Json;
  return slot;
}

/** 从 choiceQueue 中选出第 index 个 slot 晋升为 pendingSlot,其余留在队列 */
function promoteChoice(state: GameState, index: number): void {
  const queue = state.choiceQueue ?? [];
  if (index < 0 || index >= queue.length) return;
  const chosen = queue.splice(index, 1)[0];
  state.pendingSlot = chosen;
}

/** 选择超时:默认选第一个 */
function promoteFirstChoice(state: GameState): void {
  promoteChoice(state, 0);
}

/**
 * 当前 pendingSlot resolve 后,检查 choiceQueue 是否还有待处理 slot。
 * 有 1 个 → 直接晋升;有 2+ 个 → 创建新的"选择"pending。
 */
function promoteChoiceQueue(state: GameState): void {
  const queue = state.choiceQueue ?? [];
  state.pendingSlot = undefined;
  if (queue.length === 0) return;
  if (queue.length === 1) {
    state.pendingSlot = queue.shift();
  } else {
    state.pendingSlot = makeChoiceSlot(state);
  }
}


// ─── Notify 事件 ────────────────────────────────────────────

/** 推送 notify 事件(不改变 state) */
export function pushNotify(_state: GameState, event: NotifyEvent): void {
  pushEvent({ kind: 'notify', ...event });
}

// ─── Atom apply 管线 ────────────────────────────────────────

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
  for (const h of [...getBeforeHooks(atom.type)]) {
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

  const afterHooks = getAfterHooks(current.type);
  // 系统级 hooks(ownerId=-1)最后执行——确保遗计/反馈等"受伤害后"技能先触发
  const sortedHooks = [...afterHooks].sort((a, b) => {
    if (a.ownerId === -1 && b.ownerId !== -1) return 1;
    if (a.ownerId !== -1 && b.ownerId === -1) return -1;
    return 0;
  });
  for (const h of sortedHooks) {
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

  // atom 自身的后处理(在技能 after hooks 之后):如判定牌从处理区移入弃牌堆
  if (def.afterHooks) {
    def.afterHooks(state, current);
  }

  state.atomStack.pop();

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
      const fireTimeoutNow = async (): Promise<void> => {
        if (state.pendingSlot !== slot) return;
        clearTimeout(timer);
        await applyAtom(state, pending.onTimeout);
        promoteChoiceQueue(state);
        safeResolve();
      };
      slot._fireTimeoutNow = fireTimeoutNow;
      const timer = setTimeout(fireTimeoutNow, timeoutMs);

      // 多询问处理:pendingSlot 已被占 → 新 slot 入 choiceQueue,创建"选择"pending
      if (state.pendingSlot) {
        if (!state.choiceQueue) state.choiceQueue = [];
        state.choiceQueue.push(state.pendingSlot);
        state.choiceQueue.push(slot);
        state.pendingSlot = makeChoiceSlot(state);
      } else {
        state.pendingSlot = slot;
      }
      resolveStable(state);
    });
  }
}
