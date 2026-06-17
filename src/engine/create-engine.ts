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

/** 从 pending atom 中提取等待目标玩家(座次下标)。所有内置等待型 atom 都有 target 字段 */
function extractPendingTarget(atom: Atom): number {
  if ('target' in atom && typeof atom.target === 'number') return atom.target;
  return -1;
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
  if (message.preceding) {
    for (const p of message.preceding) {
      const pEntry = findActionEntry(p.skillId, message.ownerId, p.actionType);
      if (!pEntry || pEntry.validate(state, p.params) !== null){
        rollbacks.reverse().forEach(r => r.entry.rollback?.(state, r.params));
        return;
      }
      await pEntry.execute(state, p.params);
      rollbacks.push({ entry: pEntry, params: p.params });
    }
  }
  let entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
  // 系统级 respond 回退:玩家 ownerId 找不到时,尝试系统级(-1)注册
  // 仅在有 pendingSlot 时(即 respond 路径)启用,use() 路径不受影响
  if (!entry && message.actionType === 'respond' && state.pendingSlot) {
    entry = findActionEntry(message.skillId, -1, message.actionType);
  }
  if (!entry || entry.validate(state, message.params) !== null){
    rollbacks.reverse().forEach(r => r.entry.rollback?.(state, r.params));
    return;
  }
  // 回应路径:若 pending slot 的超时已在处理中(isTimeout),丢弃该 action;否则 pause 取消定时器
  const oldSlot = state.pendingSlot;
  if (oldSlot) {
    if (oldSlot.isTimeout) {
      rollbacks.reverse().forEach(r => r.entry.rollback?.(state, r.params));
      return;
    }
    oldSlot.pause();
  }

  const resolve = oldSlot?.resolve ?? (() => {});
  // 注意:不在 execute 前清除 pendingSlot——respond execute 需要读 slot 信息
  // (如系统规则弃牌 execute 读 slot.atom.target)。execute 完成后才清除旧 slot
  // (仅当 execute 未创建新 pending 时)。
  logAction(state, message);
  state.seq += 1;
  // fire-and-forget 启动 execute,完成后 resolve 旧 slot(父 execute 恢复)。
  // 返回 execute promise:session 不 await(继续 fire-and-forget),
  // 测试可 await 它等到 respond execute 跑完;父 execute resume 跑到下一个 pending
  // 需调用方再让出一个微任务(见 harness 的 flush)。
  return entry.execute(state, message.params).then(() => {
    // execute 完成后:如果 pendingSlot 未被替换(execute 未创建新 pending),清除旧 slot
    if (state.pendingSlot === oldSlot) state.pendingSlot = undefined;
    // respond 完成后:如果有 choiceQueue 剩余,推进下一个 slot 为 pending
    if (!state.pendingSlot) promoteChoiceQueue(state);
    resolve();
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
  const slot = state.pendingSlot;
  if (!slot) return;
  await slot._fireTimeoutNow?.();
  // 只在旧 slot 仍活跃时 promote choiceQueue。
  // 如果 execute 恢复后创建了新 pending(state.pendingSlot 已变为新 slot),不 promote。
  if (!state.pendingSlot || state.pendingSlot === slot) {
    promoteChoiceQueue(state);
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
    isTimeout: false,
    pause: () => {},
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
    await new Promise<void>((resolve) => {
      const pending = def.pending!;
      // 优先读 atom 上的 timeout 字段(如 请求回应 的 timeout),fallback 到 def.pending.timeout
      const atomTimeout = (current as Record<string, unknown>).timeout;
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
        atom: current,
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
      };
      const fireTimeoutNow = async (): Promise<void> => {
        if (state.pendingSlot !== slot) return;
        if (paused) return;
        timedOut = true;
        clearTimeout(timer);
        await applyAtom(state, pending.onTimeout);
        // 弃牌 pending 超时:自动弃超出手牌
        const slotAtom = slot.atom as { requestType?: string; target?: number };
        if (slotAtom.requestType === '__弃牌' && typeof slotAtom.target === 'number') {
          const p = state.players[slotAtom.target];
          if (p && p.hand.length > p.maxHealth) {
            const excess = p.hand.length - p.maxHealth;
            const toDiscard = p.hand.slice(-excess);
            await applyAtom(state, { type: '弃置', player: slotAtom.target, cardIds: toDiscard });
          }
        }
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
      notifyStateChange(state);
    });
  }
}
