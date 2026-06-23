// src/engine/create-engine.ts
// 引擎主入口(顶层函数,无闭包)。
//
// 主要导出:
//   - create(gameConfig): 同步建 state(预创建 playerCount 个空玩家槽位),返回骨架 state
//   - bootstrap(state, gameConfig): 异步 —— 加载 开局 skill → onInit → dispatch 开局 start → registerSkillsFromState
//   - dispatch(state, msg): 接受 state,执行 client message
//   - buildView(state, viewer): 接受 state,返回 view
//   - fireTimeout(state): 触发 pending slot 的 onTimeout
//   - resetForTest(): 模块级清空(skill instances)
//
// create 是同步的(不依赖任何 IO),bootstrap 是异步的(可能要动态 import 模块)。
// 两者解耦是为了让 restoreFromLog 的路径可以跳过 bootstrap —— 恢复出来的 state 已经
// 完成了开局,不需要再 dispatch 开局 start。
//
// dispatch 路径(Promise<boolean>):
//   同步跑 preceding/validate;通过则启动 fire-and-forget execute 并返回 true,
//   拒绝则 rollback 并返回 false。execute 内 await pending slot 可能阻塞,但 dispatch 本身立即返回。
//   1) 主动 action(无 pending slot):execute 跑到 applyAtom 建 pending 时自然挂起。
//   2) 回应 action(有 pending slot):slot.pause() 取消定时器 → respond execute 跑完
//      → .then(resolve) 恢复父 execute。递归 pending(如无纶递归)下 respond execute
//      会挂在新 pending 上,旧 slot 待整条链 resolve 后才恢复。
//
// session 不 await dispatch;state 变化通过 applyAtom 末尾的 onStateChange 回调驱动广播。
// 旧 _pendingSignal / _waitForStable / Promise.race 机制已全部移除。
//
// 帧由技能在 execute 中显式创建(api.pushFrame)和弹出(api.popFrame);dispatch 不管理帧。
// atomStack / pendingSlot 是 GameState 属性,不是 frame 属性。
// 引擎内部不 try/catch——除 bug 外不应抛错。
// actionLog 由引擎自动记录,session 不直接 mutate state。

import type {
  ActionEntry,
  ActionLogEntry,
  ActionPrompt,
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

import { clearSlashMaxProviders } from './slash-quota';
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

/** 从 pending atom 中提取等待目标玩家(座次下标)。所有内置等待型 atom 都有 target 字段。
 *  返回 -1 表示系统(广播/系统级 pending),不抛错以兼容多 owner 场景。
 *  注意:与 SYSTEM_OWNER 同值,广播型 pending slot 的 Map key 就会是 -1,
 *  任何依赖 ownerId 精确查找 slot 的代码需先用 fallback 找 target<0 的 slot。 */
function extractPendingTarget(atom: Atom): number {
  if ('target' in atom && typeof atom.target === 'number') return atom.target;
  return SYSTEM_OWNER;
}

/** 通知 session:state 已变更(每次 applyAtom 结束后触发)。 */
function notifyStateChange(state: GameState): void {
  state.onStateChange?.();
}

/** 通知前端:某 pending slot 已 resolve(respond 完成 / 超时),前端应清除 view.pending。
 *  事件流模式下 view.pending 不再由 buildView 每次重建,而由 applyView 增量维护,
 *  因此 slot 的删除(服务端静默 mutation)必须显式发事件,否则前端 pending 永驻。
 *  target<0 = 广播型 slot(如无懈可击),所有 viewer 都应清除。 */
function notifyPendingResolved(state: GameState, slot: PendingSlot): void {
  const target = extractPendingTarget(slot.atom);
  state.seq += 1;
  state.atomHistory.push({
    kind: 'notify',
    seq: state.seq,
    timestamp: Date.now() - state.startedAt,
    skillId: '',
    eventType: 'pendingResolved',
    data: { target, atomType: slot.atom.type },
  });
  notifyStateChange(state);
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
    id: String(state.actionLog.length),
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
  const lord = state.players.find(p => p.identity === '主公');
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
 *   2. 调 开局.onInit(skill, state) 注册 start action
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
  const off开局 = 开局mod.onInit(syntheticSkill, state);
  // 登记实例 unload,使 unloadSkillInstance/clearAllSkillInstances 能正确清理 开局:系统
  setSkillInstanceUnload('开局', SYSTEM_OWNER, typeof off开局 === 'function' ? off开局 : () => {});

  // 3. dispatch 开局 start(dispatch 返回 boolean:validate 拒绝返回 false,开局失败通过后续 state 检查暴露)
  // 先为每个玩家注册选将/弃牌 respond action(注册到具体座次,开局流程内会等待这些 respond)
  const 系统规则mod = await import('./skills/系统规则');
  for (const player of state.players) {
    系统规则mod.registerSystemRespondActions(player.index);
  }
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

/** 测试/工具用:给预构造 state(未走 bootstrap)注册所有 player.skills 实例 + 选将/弃牌 respond action */
export async function registerSkillsFromState(state: GameState): Promise<void> {
  const { registerSkillsFromState: registerSkills } = await import('./skill');
  await registerSkills(state);
  // 为每个玩家注册选将/弃牌 respond action(与 bootstrap 一致)
  const 系统规则mod = await import('./skills/系统规则');
  for (const player of state.players) {
    系统规则mod.registerSystemRespondActions(player.index);
  }
}

/**
 * 执行一条 client message。同步跑 preceding/validate;通过则启动 fire-and-forget execute 并返回 true,
 * 拒绝则 rollback 并返回 false。execute 内部 await pending slot 可能阻塞,但 dispatch 本身不等 execute 完成。
 * session 根据返回值决定 ACK/NAK;state 变更通过 applyAtom 末尾的 onStateChange 回调驱动广播。
 *
 * 回应路径(有 pendingSlot):slot.pause() 取消其超时定时器,让 respond execute 独占推进;
 * respond execute 完成后 .then(resolve) 恢复父 execute。若 slot.isTimeout(超时已在处理中),
 * 丢弃该 action,避免超时与用户回应竞态。
 */
export async function dispatch(state: GameState, message: ClientMessage): Promise<boolean> {
  const rollbacks: Array<{ entry: ActionEntry; params: Record<string, Json> }> = [];
  // 辅助:preceding 阶段抛错 / 失败时,清理可能由 execute 创建的残留 pending slot。
  // execute 是 fire-and-forget 风格的 applyAtom,可能在 pendingSlots 留下未 resolve 的 slot。
  // 若 main 不启动,这些 slot 的父 await 永远不返回 → 死锁。
  const cleanupResidualPending = () => {
    const resolved: PendingSlot[] = [];
    for (const [k, slot] of state.pendingSlots) {
      try { slot.resolve(); } catch { /* safeResolve 已防重入 */ }
      state.pendingSlots.delete(k);
      resolved.push(slot);
    }
    for (const slot of resolved) notifyPendingResolved(state, slot);
  };
  if (message.preceding) {
    for (const p of message.preceding) {
      const pEntry = findActionEntry(p.skillId, message.ownerId, p.actionType);
      if (!pEntry || pEntry.validate(state, p.params) !== null){
        rollbacks.reverse().forEach(r => r.entry.rollback?.(state, r.params));
        cleanupResidualPending();
        return false;
      }
      await pEntry.execute(state, p.params);
      rollbacks.push({ entry: pEntry, params: p.params });
    }
  }
  let entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
  if (!entry || entry.validate(state, message.params) !== null){
    rollbacks.reverse().forEach(r => r.entry.rollback?.(state, r.params));
    return false;
  }
  // 回应路径:定位该玩家对应的 slot。
  // 单 target 询问(询问闪/杀/弃牌):Map 只有该 target 一个 slot → 直接 ownerId 命中。
  // 并行询问(拼点/选将):Map 有多个 slot,各自独立 resolve → ownerId 各自命中。
  // 无懈可击广播型(target=-2):任意玩家 respond 都命中同一 slot(先到先得)。
  //   先按 ownerId 查(支持常规 single-target),未命中时查找唯一的 broadcast slot
  //   (atom.target < 0,如无懈可击 target=-2)。
  const targetKey = message.ownerId;
  const oldSlot = state.pendingSlots.get(targetKey)
    ?? (state.pendingSlots.size === 1 ? [...state.pendingSlots.values()][0] : undefined)
    ?? [...state.pendingSlots.values()].find(s => {
      const t = (s.atom as { target?: unknown }).target;
      return typeof t === 'number' && t < 0;
    });
  if (oldSlot) {
    if (oldSlot.isTimeout) {
      rollbacks.reverse().forEach(r => r.entry.rollback?.(state, r.params));
      return false;
    }
    // pending-scoped 版本校验：只影响 respond 路径
    // pendingSeq 不匹配 = 客户端响应了过期窗口（已被 close-reopen 替换）→ 拒绝
    // pendingSeq 缺省跳过校验（向后兼容旧客户端；新客户端应始终传 pendingSeq）
    if (message.pendingSeq !== undefined && oldSlot.createdSeq !== message.pendingSeq) {
      rollbacks.reverse().forEach(r => r.entry.rollback?.(state, r.params));
      return false;
    }
    oldSlot.pause();
  }

  const resolve = oldSlot?.resolve ?? (() => {});
  logAction(state, message);
  // 统一 slot 清理 helper：按 key 精确匹配 → 引用遍历兜底 → resolve
  const cleanupSlot = () => {
    if (!oldSlot) return;
    const key = extractPendingTarget(oldSlot.atom);
    let deleted = false;
    if (state.pendingSlots.get(key) === oldSlot) { state.pendingSlots.delete(key); deleted = true; }
    if (!deleted) {
      for (const [k, v] of state.pendingSlots) {
        if (v === oldSlot) { state.pendingSlots.delete(k); deleted = true; break; }
      }
    }
    if (deleted) notifyPendingResolved(state, oldSlot);
    resolve();
  };
  // fire-and-forget 启动 execute,完成后 resolve 该玩家的 slot.
  // then/finally 都走 cleanupSlot。safeResolve 防重入 + 删除幂等 → 无副作用重复执行。
  // 注意:不 return execute 的 promise——execute 内 await pending slot 可能阻塞到玩家回应,
  // 如果 dispatch 返回该 promise,session/harness 的 await 会死锁。
  // dispatch 返回 true 表示"已接受"(validate 通过+execute 已启动),不等 execute 完成。
  entry.execute(state, message.params).then(cleanupSlot).finally(cleanupSlot).catch(() => {});
  return true;
}

/**
 * 构造指定 viewer 视角的 GameView。
 */
export function buildView(state: GameState, viewer: number, debug = false): GameView {
  return buildViewImpl(state, viewer, debug);
}

/**
 * 立即触发当前 pending slot 的 onTimeout(模拟超时,绕过真实 setTimeout)。
 * 触发后 slot resolve → 父 execute 恢复。广播由 applyAtom 内部的 onStateChange 驱动。
 */
export async function fireTimeout(state: GameState): Promise<void> {
  // 触发所有活跃 slot 的 onTimeout。串行执行:多个 slot 超时可能并行 mutate state
  // (如两个 __弃牌 slot 同时读 players[p].hand 后同时调弃置 → 数据竞争)。
  // 串行避免该问题,且超时本身不属于热路径(测试/调试使用),性能不是首要考虑。
  const slots = [...state.pendingSlots.values()];
  if (slots.length === 0) return;
  for (const s of slots) {
    await s._fireTimeoutNow?.();
  }
}

/** 测试用:模块级清空(skill instances + slash quota providers)。 */
export function resetForTest(): void {
  clearAllSkillInstances();
  clearSlashMaxProviders();
  // 重新注册系统规则全局 hooks(被 clearAllSkillInstances 清掉了)
  init系统规则({ id: '系统规则', ownerId: -1, name: '系统规则', description: '' }, createGameState({ players: [], cardMap: {} }));
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

/** 兑底空帧 */
function emptyFrame(): SettlementFrame {
  return { skillId: '', from: -1, params: Object.freeze({}) };
}


// ─── Notify 事件 ────────────────────────────────────────────

/** 推送 notify 事件(不改变 state) */
export function pushNotify(state: GameState, event: NotifyEvent): void {
  state.seq += 1;
  state.atomHistory.push({ kind: 'notify', seq: state.seq, timestamp: Date.now() - state.startedAt, ...event });
}

// ─── Atom apply 管线 ────────────────────────────────────────

/** 运行 after hooks:系统级 hooks(ownerId=-1)最后执行,
 *  确保遗计/反馈等“受伤害后”技能先于濒死检查触发。 */
async function runAfterHooks(state: GameState, atom: Atom): Promise<void> {
  const sortedHooks = [...getAfterHooks(atom.type)].sort((a, b) => {
    if (a.ownerId === -1 && b.ownerId !== -1) return 1;
    if (a.ownerId !== -1 && b.ownerId === -1) return -1;
    return 0;
  });
  for (const h of sortedHooks) {
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
    notifyStateChange(state);
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

  // seq 在每次 push atomHistory 前递增:一次 dispatch 内可能有多个 applyAtom
  // (如 respond → 分配武将 → 并行选将),它们必须有各自唯一的 seq,
  // 否则 broadcastNewState 的水位过滤会跳过同 seq 的后续事件(选将 bug 根因)。
  state.seq += 1;
  state.atomHistory.push({ kind: 'atom', seq: state.seq, timestamp: Date.now() - state.startedAt, atom: current, viewEvents: viewEvents! });
  notifyStateChange(state);

  if (def.pending) {
    // 等待型 atom:创建 PendingSlot(单 target) 或多个 slot(并行回应/并行选将多 target)。
    // 并行回应 / 并行选将 为每个 target 创建独立 slot,Promise.all 等全部 resolve(语义同 Promise.all)。
    const isParallelRespond = current.type === '并行回应';
    const isParallelSelect = current.type === '并行选将';
    const isParallel = isParallelRespond || isParallelSelect;

    // 拆分目标列表 + 每个 target 对应的虚拟 slot atom
    let targets: number[];
    let slotAtoms: Atom[];
    if (isParallelRespond) {
      // 并行回应:所有 target 共用同一 prompt/requestType,拆成 请求回应
      const cur = current as unknown as { targets: number[]; requestType: string; prompt: ActionPrompt; defaultChoice?: Json; timeout?: number };
      targets = cur.targets;
      slotAtoms = targets.map(t => ({
        ...cur,
        type: '请求回应' as const,
        target: t,
      } as unknown as Atom));
    } else if (isParallelSelect) {
      // 并行选将:每个 target 有各自的 candidates,拆成 选将询问(保留各自候选人)
      const cur = current as unknown as { selections: Array<{ target: number; candidates: Array<{ name: string; skills: string[] }> }> };
      targets = cur.selections.map(s => s.target);
      slotAtoms = cur.selections.map(s => ({
        type: '选将询问' as const,
        target: s.target,
        candidates: s.candidates,
      } as unknown as Atom));
    } else {
      // 单 target:原样
      targets = [extractPendingTarget(current)];
      slotAtoms = [current];
    }

    const slotPromises: Promise<void>[] = [];
    for (let i = 0; i < slotAtoms.length; i++) {
      const slotAtom = slotAtoms[i];
      const slotTarget = targets[i];
      // 并行选将拆出的 slot 是 选将询问 类型,用其 def;其他用当前 atom 的 def
      const slotDef = isParallelSelect ? getAtomDef('选将询问') : def;
      slotPromises.push(createAndAwaitSlot(state, slotAtom, slotDef, slotTarget));
    }
    await Promise.all(slotPromises);

    // 等待型 atom:技能 after hooks 和 def.afterHooks 都在 pending resolve 之后跑
    // ——这样贯石斧/青龙偃月刀等技能能在看到 P2 出完闪/不出后再做决策。
    await runAfterHooks(state, current);

    if (def.afterHooks) {
      def.afterHooks(state, current);
    }

    state.atomStack.pop();
    return;
  }

  // 非等待型 atom:技能 after hooks 立即跑(原顺序)
  await runAfterHooks(state, current);

  // atom 自身的后处理(在技能 after hooks 之后):如判定牌从处理区移入弃牌堆
  if (def.afterHooks) {
    def.afterHooks(state, current);
  }

  state.atomStack.pop();
}

/** 为单个 target 创建 PendingSlot 并 await 到它 resolve。 */
function createAndAwaitSlot(
  state: GameState,
  atom: Atom,
  def: AtomDefinition,
  target: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const pending = def.pending!;
    const atomTimeout = (atom as Record<string, unknown>).timeout;
    const timeoutSec = typeof atomTimeout === 'number' ? atomTimeout : pending.timeout;
    const timeoutMs = timeoutSec * 1000;
    let resolveCalled = false;
    let timedOut = false;
    let paused = false;
    const safeResolve = () => {
      if (resolveCalled) return;
      resolveCalled = true;
      clearTimeout(timer);
      resolve();
    };
    const slot: PendingSlot = {
      atom,
      definition: def,
      startTime: Date.now() - state.startedAt,
      deadline: Date.now() - state.startedAt + timeoutMs,
      createdSeq: state.seq,
      resolve: safeResolve,
      get isTimeout() { return timedOut; },
      pause() {
        if (timedOut) return;
        paused = true;
        clearTimeout(timer);
      },
    };
    const fireTimeoutNow = async (): Promise<void> => {
      if (state.pendingSlots.get(target) !== slot) return;
      if (paused) return;
      timedOut = true;
      clearTimeout(timer);
      try {
        // 超时行为优先用动态钩子(onTimeoutDynamic),可读 state 决定超时做什么;
        // 未实现或返回 undefined 时回退到静态 onTimeout。
        // 业务逻辑(弃牌超时/选将超时等)由各自 atom 定义声明,引擎核心只管调度。
        const timeoutAtom = pending.onTimeoutDynamic?.(state, atom) ?? pending.onTimeout;
        await applyAtom(state, timeoutAtom);
        notifyStateChange(state);
      } finally {
        // 兑底:applyAtom 抛错时仍必须清理 slot 并 resolve 父 execute,避免死锁。
        let deleted = false;
        if (state.pendingSlots.get(target) === slot) { state.pendingSlots.delete(target); deleted = true; }
        if (deleted) notifyPendingResolved(state, slot);
        safeResolve();
      }
    };
    slot._fireTimeoutNow = fireTimeoutNow;
    let timer: ReturnType<typeof setTimeout> = setTimeout(fireTimeoutNow, timeoutMs);

    // 存入 pendingSlots Map(按 target 索引)。不同 target 的 slot 共存,各自独立 resolve。
    state.pendingSlots.set(target, slot);
    notifyStateChange(state);
  });
}
