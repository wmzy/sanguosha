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
// dispatch 路径(fire-and-forget):
//   启动 execute 后立即返回,不等 pending 创建。preceding/validate 同步跑完,
//   通过 entry.execute(...).then(resolve) 启动后即返回。
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
 * 执行一条 client message。dispatch 是 fire-and-forget 的输入分发器:
 * 同步跑 preceding/validate,启动 execute 后立即返回,不等 pending 创建。
 * session 不 await dispatch——state 变更通过 applyAtom 末尾的 onStateChange 回调驱动广播。
 *
 * 回应路径(有 pendingSlot):slot.pause() 取消其超时定时器,让 respond execute 独占推进;
 * respond execute 完成后 .then(resolve) 恢复父 execute。若 slot.isTimeout(超时已在处理中),
 * 丢弃该 action,避免超时与用户回应竞态。
 */
export async function dispatch(state: GameState, message: ClientMessage): Promise<void> {
  const rollbacks: Array<{ entry: ActionEntry; params: Record<string, Json> }> = [];
  // 辅助:preceding 阶段抛错 / 失败时,清理可能由 execute 创建的残留 pending slot。
  // execute 是 fire-and-forget 风格的 applyAtom,可能在 pendingSlots 留下未 resolve 的 slot。
  // 若 main 不启动,这些 slot 的父 await 永远不返回 → 死锁。
  const cleanupResidualPending = () => {
    for (const [k, slot] of state.pendingSlots) {
      // preceding execute 不应创建 _keepAlive=true 的 slot(resume 是 respond 路径才调)
      if (slot._keepAlive) continue;
      try { slot.resolve(); } catch { /* safeResolve 已防重入 */ }
      state.pendingSlots.delete(k);
    }
  };
  if (message.preceding) {
    for (const p of message.preceding) {
      const pEntry = findActionEntry(p.skillId, message.ownerId, p.actionType);
      if (!pEntry || pEntry.validate(state, p.params) !== null){
        rollbacks.reverse().forEach(r => r.entry.rollback?.(state, r.params));
        cleanupResidualPending();
        return;
      }
      await pEntry.execute(state, p.params);
      rollbacks.push({ entry: pEntry, params: p.params });
    }
  }
  let entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
  if (!entry || entry.validate(state, message.params) !== null){
    rollbacks.reverse().forEach(r => r.entry.rollback?.(state, r.params));
    return;
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
      return;
    }
    oldSlot.pause();
  }

  const resolve = oldSlot?.resolve ?? (() => {});
  // 注意:不在 execute 前清除 slot——respond execute 需要读 slot 信息
  // (如系统规则弃牌 execute 读 slot.atom.target)。execute 完成后才清除该玩家的 slot。
  logAction(state, message);
  state.seq += 1;
  // fire-and-forget 启动 execute,完成后 resolve 该玩家的 slot。
  // finally 兜底:execute 抛错时(开发期 bug / 测试场景)仍必须释放 slot,避免父 execute 永久卡死。
  return entry.execute(state, message.params).then(() => {
    if (oldSlot) {
      // execute 完成后:如果该 slot 仍未被替换(execute 未创建新 pending),清除它
      // 异常路径:无懈可击 broadcast slot 由 respond execute 调 slot.resume() 主动续期,
      // 此时 _keepAlive 标记为 true,表示该 slot 还要继续接收回应,不要 resolve。
      // 默认() 响应时 _keepAlive=false(其他 respond 仍走原逻辑:清除 + resolve)。
      if (oldSlot._keepAlive) {
        // slot 主动续期了——保持原状,不要 resolve,让定时器自然过期
        return;
      }
      const key = extractPendingTarget(oldSlot.atom);
      if (state.pendingSlots.get(key) === oldSlot) state.pendingSlots.delete(key);
      // 无雕等 target<0 的广播 slot:dispatch 用 ownerId 找不到精确 key,需按 slot 引用清除
      if (key < 0) {
        for (const [k, v] of state.pendingSlots) if (v === oldSlot) { state.pendingSlots.delete(k); break; }
      }
    }
    resolve();
  }).finally(() => {
    // 兜底:execute 抛错路径下,.then 的清理逻辑不会执行,但父 execute 仍必须 resolve + 删 slot,
    // 否则 pendingSlots 永久残留 + 父 await 永远不返回。_keepAlive 已被 onInit 设为 true 的例外保留。
    if (oldSlot && !oldSlot._keepAlive) {
      for (const [k, v] of state.pendingSlots) {
        if (v === oldSlot) { state.pendingSlots.delete(k); break; }
      }
      try { resolve(); } catch { /* resolve 已被 safeResolve 保护 */ }
    }
  });
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

/** 兑底空帧 */
function emptyFrame(): SettlementFrame {
  return { skillId: '', from: -1, params: Object.freeze({}) };
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

  pushEvent({ kind: 'atom', atom: current, viewEvents });
  notifyStateChange(state);

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
    // 等待型 atom:创建 PendingSlot(单 target) 或多个 slot(并行回应多 target)。
    // 并行回应 为每个 target 创建独立 slot,Promise.all 等全部 resolve(语义同 Promise.all)。
    const isParallel = current.type === '并行回应';
    const targets: number[] = isParallel
      ? (current as unknown as { targets: number[] }).targets
      : [extractPendingTarget(current)];

    // 为每个 target 构造一个单 target 的虚拟 atom(并行回应拆分;单 target 原样)
    const slotAtoms: Atom[] = isParallel
      ? targets.map(t => ({
          ...current,
          type: '请求回应' as const,
          target: t,
        } as unknown as Atom))
      : [current];

    const slotPromises: Promise<void>[] = [];
    for (let i = 0; i < slotAtoms.length; i++) {
      const slotAtom = slotAtoms[i];
      const slotTarget = targets[i];
      slotPromises.push(createAndAwaitSlot(state, slotAtom, def, slotTarget));
    }
    await Promise.all(slotPromises);
  }
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
      resolve: safeResolve,
      get isTimeout() { return timedOut; },
      pause() {
        if (timedOut) return;
        paused = true;
        clearTimeout(timer);
      },
      // 恢复定时器(由 respond execute 调用):重置为满 timeout,让广播型 slot 在被
      // respond 后还能继续接受反无懈等更多回应。已超时或已 resolve 则无效。
      resume() {
        if (timedOut || resolveCalled) return;
        paused = false;
        clearTimeout(timer);
        const newDeadline = Date.now() - state.startedAt + timeoutMs;
        slot.deadline = newDeadline;
        slot.startTime = Date.now() - state.startedAt;
        slot._keepAlive = true;
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        timer = setTimeout(fireTimeoutNow, timeoutMs);
      },
    };
    const fireTimeoutNow = async (): Promise<void> => {
      if (state.pendingSlots.get(target) !== slot) return;
      if (paused) return;
      timedOut = true;
      clearTimeout(timer);
      try {
        await applyAtom(state, pending.onTimeout);
        // 弃牌 pending 超时:自动弃超出手牌
        const slotAtom = atom as { requestType?: string; target?: number };
        if (slotAtom.requestType === '__弃牌' && typeof slotAtom.target === 'number') {
          const p = state.players[slotAtom.target];
          if (p && p.hand.length > p.maxHealth) {
            const excess = p.hand.length - p.maxHealth;
            const toDiscard = p.hand.slice(-excess);
            await applyAtom(state, { type: '弃置', player: slotAtom.target, cardIds: toDiscard });
          }
        }
        notifyStateChange(state);
      } finally {
        // 兑底:applyAtom 抛错时仍必须清理 slot 并 resolve 父 execute,避免死锁。
        if (state.pendingSlots.get(target) === slot) state.pendingSlots.delete(target);
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
