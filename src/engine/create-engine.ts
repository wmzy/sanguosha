// src/engine/create-engine.ts
// 引擎主入口(顶层函数,无闭包)。
//
// 主要导出:
//   - create(gameConfig): 同步建 state(预创建 playerCount 个空玩家槽位),返回骨架 state
//   - bootstrap(state, gameConfig): 异步 —— 加载 开局 skill → onInit → dispatch 开局 start → registerSkillsFromState
//   - dispatch(state, msg): 接受 state,执行 client message
//   - buildView(state, viewer): 接受 state,返回 view
//   - fireTimeout(state): 触发 pending slot 的 onTimeout
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
  Card,
} from './types';
import { createGameState, TARGET_SYSTEM } from './types';
import { buildView as buildViewImpl } from './view/buildView';
import { assertCardInvariants } from './invariants';
import {
  findActionEntry,
  findPendingSlot,
  getAfterHooks,
  getBeforeHooks,
  getJudgeModifierMap,
  setSkillInstanceUnload,
  unloadSkillInstance,
} from './skill';
import { applyAtom as applyAtomImpl, getAtomDef, resolveViewEvents } from './atom';
import { createStandardDeck } from '../shared/deck';
import { isHookSuppressed } from './skill-suppression';

// slash-quota 已改为 state-bound(WeakMap 外挂),无模块级状态,无需在此清理。
// 必须 import 来注册所有 atom 定义 —— 否则 dispatch 开局会失败("atom type not found")
import './atoms';
// 系统规则 用静态导入而非 await import：系统规则 与本模块互依（系统规则 import applyAtom），
// 动态导入会让打包器（Rollup inlineDynamicImports）因循环依赖拆出独立 chunk，无法生成单文件发布包。
// 系统规则模块顶层无副作用，静态/动态加载语义等价（ESM live binding 解析循环）。
import * as 系统规则mod from './skills/系统规则';
// 必须 import skills/index 来设置 skillModuleResolver
import './skills';

export interface GameConfig {
  characters: Array<{ name: string; skills: string[] }>;
  playerCount: number;
  seed: number;
  gameId: string;
  handSize?: number;
  /** pending 超时倍率(房间配置)。1=默认; <1 更快; >1 更慢; Infinity=无限。 */
  timeoutScale?: number;
}

/** 计算应用了房间配置后的 pending 超时毫秒数。
 *  scale=Infinity(无限)时返回 24 小时(有效无限),定时器实际不会触发。
 *  slot 创建(createAndAwaitSlot)与 view deadline(applyView/toViewEvents)共用此函数,
 *  保证后端真实定时器与前端倒计时口径一致。 */
export function resolveTimeoutMs(state: GameState, baseSeconds: number, isBroadcast = false): number {
  const scale = state.config?.timeoutScale ?? 1;
  // setTimeout 的 delay 参数上限为 2^31-1 ms(32 位有符号整数)。
  // 超出会触发 TimeoutOverflowWarning 并被截断为 1ms,导致 pending 立即超时。
  // 24 小时 = 86_400_000ms,远低于上限且对游戏而言等效于无限。
  const MAX_TIMEOUT_MS = 86_400_000;
  if (!Number.isFinite(scale)) {
    // 广播型 pending(如无懈可击)不受 Infinity 影响:使用 base timeout,避免单座次场景死锁
    if (isBroadcast) return baseSeconds * 1000;
    return MAX_TIMEOUT_MS;
  }
  const sec = baseSeconds * scale;
  return Math.min(sec * 1000, MAX_TIMEOUT_MS);
}

// ==================== 模块级 helpers ====================

/**
 * system 命名空间占位座次。引擎只认座次下标,玩家真实 ID 由 session 层映射。
 * TARGET_SYSTEM(-1) = 系统(开局 action),不对应任何真实玩家槽位。
 */
const SYSTEM_OWNER = TARGET_SYSTEM;

/** 从 pending atom 中提取等待目标玩家(座次下标)。所有内置等待型 atom 都有 target 字段。
 *  返回 TARGET_SYSTEM(-1)表示系统(开局 action),不对应任何真实玩家槽位。
 *  注意:TARGET_SYSTEM 与广播型 target(TARGET_BROADCAST=-2)不同,
 *  广播型 slot 本身已携带 target=TARGET_BROADCAST,能被此函数准确提取。
 *  出牌窗口 atom 用 player 字段而非 target,此处兼容。 */
function extractPendingTarget(atom: Atom): number {
  if ('target' in atom && typeof atom.target === 'number') return atom.target;
  if ('player' in atom && typeof atom.player === 'number') return atom.player;
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
 *  结束条件:存活 ≤ 1 人,或主公死亡。
 *  胜方判定:winner 为某阵营代表座次,前端按其 identity 推导获胜阵营文案。
 *  - 主公阵亡:反贼仍存活 → 反贼胜;反贼全灭且内奸存活(内奸清场单挑残局)→ 内奸胜;
 *    极端(反贼/内奸均无存活)→ 仍判反贼胜。
 *  - 仅剩一人存活:winner=存活者(主公→主公方,反贼→反贼,内奸→内奸)。 */
export function checkGameOver(state: GameState): { gameOver: boolean; winner?: number } {
  // 主公死亡 → 游戏立即结束
  const lord = state.players.find((p) => p.identity === '主公');
  if (lord && !lord.alive) {
    const aliveRebel = state.players.find((p) => p.alive && p.identity === '反贼');
    if (aliveRebel) return { gameOver: true, winner: aliveRebel.index };
    const aliveRenegade = state.players.find((p) => p.alive && p.identity === '内奸');
    if (aliveRenegade) return { gameOver: true, winner: aliveRenegade.index };
    // 极端(反贼/内奸均无存活,如闪电连劈)→ 仍判反贼获胜,取任一反贼座次作阵营代表
    const anyRebel = state.players.find((p) => p.identity === '反贼');
    return { gameOver: true, winner: anyRebel?.index };
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
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
  }));

  // 预填充 cardMap(所有标准牌),确保 initialView 在 bootstrap execute 之前发出时
  // cardMap 不为空。applyView 的 移动牌 通用 fallback 依赖 cardMap 查卡牌对象,
  // 若 cardMap 为空且后续被 state.cardMap = {} 替换引用,视图的 cardMap 引用就永远空了。
  const allCards = createStandardDeck();
  const cardMap: Record<string, Card> = {};
  for (const c of allCards) cardMap[c.id] = c;

  const state = createGameState({ players: stubPlayers, cardMap });
  state.startedAt = Date.now();
  if (gameConfig.timeoutScale !== undefined) {
    state.config = { timeoutScale: gameConfig.timeoutScale };
  }
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
  if (state.players.some((p) => p.hand.length > 0)) {
    throw new Error('bootstrap: state 已开局(玩家已有手牌),不可重复 bootstrap');
  }
  const 开局mod = await import('./skills/开局');
  const syntheticSkill = 开局mod.createSkill('开局', SYSTEM_OWNER);
  // state-bound 注册表幂等:先卸载旧实例(await import 之后、onInit 之前),避免
  // 重入时因微任务交织导致重复注册。
  unloadSkillInstance(state, '开局', SYSTEM_OWNER);
  const off开局 = 开局mod.onInit(syntheticSkill, state);
  // 登记实例 unload,使 unloadSkillInstance 能正确清理 开局:系统
  setSkillInstanceUnload(
    state,
    '开局',
    SYSTEM_OWNER,
    typeof off开局 === 'function' ? off开局 : () => {},
  );

  // 3. dispatch 开局 start(dispatch 返回 boolean:validate 拒绝返回 false,开局失败通过后续 state 检查暴露)
  // 先为每个玩家注册选将/弃牌 respond action(注册到具体座次,开局流程内会等待这些 respond)
  // 系统规则mod 为模块顶部静态导入(见文件头)
  // 注册系统规则全局 hooks(添加技能/移除技能/弃置/濒死检查)到本 state(state-bound 注册表)
  系统规则mod.onInit(系统规则mod.createSkill('系统规则', TARGET_SYSTEM), state);
  for (const player of state.players) {
    系统规则mod.registerSystemRespondActions(state, player.index);
  }
  // 注册酒的全局「造成伤害」before-hook(消费增伤标记)
  const { registerWineHook } = await import('./card-effects/酒');
  registerWineHook(state);
  // 注册延时锦囊（乐不思蜀/兵粮寸断/闪电）的判定阶段 + 跳过阶段 before-hook
  const { registerDelayedTrickHooks } = await import('./card-effect/use-card');
  registerDelayedTrickHooks(state);
  await dispatch(state, {
    skillId: '开局',
    actionType: 'start',
    ownerId: SYSTEM_OWNER,
    params: { ...gameConfig },
    baseSeq: 0,
  });
}

/**
 * 从持久化数据恢复游戏:create(config) → bootstrap → 重放 actionLog(跳过开局条目,
 * bootstrap 会重新生成)。确定性地重建完整 state + skill 注册。
 *
 * actionLog[0] 是 开局 start(bootstrap 重新生成),从 [1] 开始重放。
 */
export async function restore(
  state: GameState,
  gameConfig: GameConfig,
  actionLog: ActionLogEntry[],
): Promise<GameState> {
  for (const entry of actionLog.slice(1)) {
    await dispatch(state, entry.message);
  }
  return state;
}

/** 测试/工具用:给预构造 state(未走 bootstrap)注册所有 player.skills 实例 + 选将/弃牌 respond action */
export async function registerSkillsFromState(state: GameState): Promise<void> {
  // 注入统一卡牌入口技能（使用牌/打出牌）到每个玩家的 skills 数组开头（若缺失）。
  // 放开头保证先于角色技能实例化，让 界乱击/界火计 等覆盖能生效（后注册覆盖先注册）。
  // unloadSkillInstance 已通过 cardNameChecker 跳过卡名同名技能的前缀清理，
  // 不会误删使用牌按卡名注册的 use action。
  for (const p of state.players) {
    p.skills = [
      ...(p.skills.includes('使用牌') ? [] : ['使用牌']),
      ...(p.skills.includes('打出牌') ? [] : ['打出牌']),
      ...p.skills,
    ];
  }
  const { registerSkillsFromState: registerSkills } = await import('./skill');
  await registerSkills(state);
  // 注册系统规则全局 hooks + 为每个玩家注册选将/弃牌 respond action(与 bootstrap 一致)
  // 系统规则mod 为模块顶部静态导入(见文件头)
  系统规则mod.onInit(系统规则mod.createSkill('系统规则', TARGET_SYSTEM), state);
  for (const player of state.players) {
    系统规则mod.registerSystemRespondActions(state, player.index);
  }
  // 注册酒的全局「造成伤害」before-hook(消费增伤标记)
  const { registerWineHook } = await import('./card-effects/酒');
  registerWineHook(state);
  // 注册延时锦囊（乐不思蜀/兵粮寸断/闪电）的判定阶段 + 跳过阶段 before-hook
  const { registerDelayedTrickHooks } = await import('./card-effect/use-card');
  registerDelayedTrickHooks(state);
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
      slot.resolve();
      state.pendingSlots.delete(k);
      resolved.push(slot);
    }
    for (const slot of resolved) notifyPendingResolved(state, slot);
  };
  if (message.preceding) {
    for (const p of message.preceding) {
      const pEntry = findActionEntry(state, p.skillId, message.ownerId, p.actionType);
      if (pEntry?.validate(state, p.params) !== null) {
        rollbacks.reverse().forEach((r) => r.entry.rollback?.(state, r.params));
        cleanupResidualPending();
        return false;
      }
      await pEntry.execute(state, p.params);
      rollbacks.push({ entry: pEntry, params: p.params });
    }
  }
  // skip action:玩家放弃当前 pending 的回应(不打出无懈可击等)
  if (message.actionType === 'skip') {
    // 优先查找广播型 slot(target<0,如无懈可击):出牌阶段 findPendingSlot 可能返回
    // 当前玩家的出牌窗口 slot(target=0),导致 skip 误匹配非广播型 pending。
    const broadcastSlot = [...state.pendingSlots.values()].find((s) => {
      const t = (s.atom as { target?: unknown }).target;
      return typeof t === 'number' && t < 0;
    });
    const slot = broadcastSlot ?? findPendingSlot(state, message.ownerId);
    if (!slot || slot.isTimeout) return false;
    const atomTarget = (slot.atom as { target?: number }).target;
    const isBroadcast = typeof atomTarget === 'number' && atomTarget < 0;
    if (isBroadcast) {
      // 广播型:记录该玩家已 skip,全员 skip 时提前触发超时
      slot.skippedPlayers ??= new Set();
      slot.skippedPlayers.add(message.ownerId);
      const alivePlayers = state.players.filter((p) => p.alive).map((p) => p.index);
      if (alivePlayers.every((idx) => slot.skippedPlayers!.has(idx))) {
        await slot._fireTimeoutNow?.();
      }
      return true;
    }
    // 非广播型阻塞 pending:触发超时(onTimeout 处理,如弃牌自动弃牌)
    if (slot.isBlocking) {
      await slot._fireTimeoutNow?.();
      return true;
    }
    // 非阻塞型 pending(出牌窗口):不支持 skip,返回 false
    return false;
  }
  const entry = findActionEntry(state, message.skillId, message.ownerId, message.actionType);
  if (entry?.validate(state, message.params) !== null) {
    rollbacks.reverse().forEach((r) => r.entry.rollback?.(state, r.params));
    return false;
  }
  // 回应路径:定位该玩家对应的 slot。
  // 单 target 询问(询问闪/杀/弃牌):Map 只有该 target 一个 slot → 直接 ownerId 命中。
  // 并行询问(拼点/选将):Map 有多个 slot,各自独立 resolve → ownerId 各自命中。
  // 无瓣可击广播型(target===TARGET_BROADCAST):任意玩家 respond 都命中同一 slot(先到先得)。
  //   findPendingSlot 负责按 ownerId→广播→唯一 slot 的 fallback 顺序查找。
  const targetKey = message.ownerId;
  const oldSlot = findPendingSlot(state, targetKey);
  if (oldSlot) {
    if (oldSlot.isTimeout) {
      rollbacks.reverse().forEach((r) => r.entry.rollback?.(state, r.params));
      return false;
    }
    // pending-scoped 版本校验：只影响 respond 路径(阻塞型 pending 如 请求回应/询问闪)
    // 出牌窗口是非阻塞 pending，主动出牌/用技不应校验 pendingSeq
    // pendingSeq 不匹配 = 客户端响应了过期窗口（已被 close-reopen 替换）→ 拒绝
    // pendingSeq 缺省跳过校验（向后兼容旧客户端；新客户端应始终传 pendingSeq）
    // 放宽为 >= 而非 ===：并行询问(选将)场景下,多个 slot 同时存在,客户端 _lastSeq
    // 是最后一个 atom 的 seq,可能大于当前 slot 的 createdSeq。只要 >= 就说明客户端
    // 的状态不比 slot 创建时旧,可以安全接受。
    if (
      oldSlot.isBlocking &&
      message.pendingSeq !== undefined &&
      message.pendingSeq < oldSlot.createdSeq
    ) {
      rollbacks.reverse().forEach((r) => r.entry.rollback?.(state, r.params));
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
    if (state.pendingSlots.get(key) === oldSlot) {
      state.pendingSlots.delete(key);
      deleted = true;
    }
    if (!deleted) {
      for (const [k, v] of state.pendingSlots) {
        if (v === oldSlot) {
          state.pendingSlots.delete(k);
          deleted = true;
          break;
        }
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
  // execute 无人 await,其 rejection 只能通过 onError 回调暴露——绝不静默吞掉。
  entry
    .execute(state, message.params)
    .then(cleanupSlot)
    .finally(cleanupSlot)
    .catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      state.onError?.(e);
      throw err;
    });
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

// ==================== 从 engine-api.ts 合并的导出 ====================
// 以下函数原属 engine-api.ts,现已合并到本文件。skill 文件通过 import from '../create-engine' 使用。

// ─── 帧管理 ──────────────────────────────────────────────────

/** 创建帧并压入 state.settlementStack,返回帧引用。
 *
 *  走 applyAtom({ type: '结算帧入栈' }) 管线,保证 view.settlementStack 与后端同步。
 *  返回被压入的 frame 引用(从栈顶取,与入栈 atom apply 写入的是同一对象)。
 *  变为 async(applyAtom 是 async);技能 execute 已是 async,加 await 即可。 */
export async function pushFrame(
  state: GameState,
  skillId: string,
  from: number,
  params?: Record<string, Json>,
): Promise<SettlementFrame> {
  await applyAtom(state, { type: '结算帧入栈', skillId, from, params });
  // 入栈 atom 的 apply 已将帧压入栈,返回栈顶引用
  return state.settlementStack[state.settlementStack.length - 1];
}

/** 弹出栈顶帧。
 *
 *  走 applyAtom({ type: '结算帧出栈' }) 管线,保证 view.settlementStack 同步。
 *  变为 async;技能 execute 加 await。 */
export async function popFrame(state: GameState): Promise<void> {
  await applyAtom(state, { type: '结算帧出栈' });
}

/** 取栈顶帧(只读引用) */
export function topFrame(state: GameState): SettlementFrame | undefined {
  return state.settlementStack[state.settlementStack.length - 1];
}

/** 取栈顶帧的牌区(替代全局 zones.processing)。
 *  无栈时回退到 state.zones.processing(仅用于无帧上下文的兼容场景)。 */
export function frameCards(state: GameState): string[] {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  return frame ? frame.cards : state.zones.processing;
}

/** 兜底空帧 */
function emptyFrame(): SettlementFrame {
  return { skillId: '', from: TARGET_SYSTEM, params: Object.freeze({}), cards: [], cancelled: false };
}

// ─── Notify 事件 ────────────────────────────────────────────

/** 推送 notify 事件(不改变 state) */
export function pushNotify(state: GameState, event: NotifyEvent): void {
  state.seq += 1;
  state.atomHistory.push({
    kind: 'notify',
    seq: state.seq,
    timestamp: Date.now() - state.startedAt,
    ...event,
  });
}

// ─── Atom apply 管线 ────────────────────────────────────────

// 非锁定技失效扩展点(skill-suppression.ts)提供,引擎核心不感知具体技能/标签。
// 提供者由各技能自行注册(义绝/界铁骑/界完杀 等),predicate 内部读自己的 tag/vars。

/** 运行 after hooks。
 *  默认:系统级 hooks(ownerId===TARGET_SYSTEM)最后执行,确保遗计/反馈等
 *  “受伤害后”技能先于濒死检查触发。
 *  模块 P:伤害结算结束后(连环传导时机)改为按 ownerId 逆时针排列
 *  (当前回合角色起,系统级 hook ownerId<0 排最前)。 */
async function runAfterHooks(state: GameState, atom: Atom): Promise<void> {
  const sortedHooks = [...getAfterHooks(state, atom.type)];

  // 模块 P:伤害结算结束后(连环传导时机)的 after-hook 按 ownerId 逆时针排列——
  // 当前回合角色起逆时针,系统级 hook(ownerId<0,如连环传导)排最前。
  // 其他 atom 维持原有"系统级 hook 排最后"顺序,确保遗计/反馈等"受伤害后"
  // 技能先于濒死检查触发(与 runBeforeHooks 模块 L 摸牌修正写法一致)。
  if (atom.type === '伤害结算结束后' && sortedHooks.length > 1) {
    const cur = state.currentPlayerIndex;
    const n = state.players.length;
    sortedHooks.sort((a, b) => {
      const distA = a.ownerId < 0 ? -1 : (a.ownerId - cur + n) % n;
      const distB = b.ownerId < 0 ? -1 : (b.ownerId - cur + n) % n;
      return distA - distB;
    });
  } else {
    sortedHooks.sort((a, b) => {
      if (a.ownerId === TARGET_SYSTEM && b.ownerId !== TARGET_SYSTEM) return 1;
      if (a.ownerId !== TARGET_SYSTEM && b.ownerId === TARGET_SYSTEM) return -1;
      return 0;
    });
  }
  for (const h of sortedHooks) {
    // 界铁骑:目标本回合非锁定技失效 → 跳过非锁定技 hook
    if (isHookSuppressed(state, h.ownerId, h.skillId)) continue;
    const curFrame = topFrame(state) ?? emptyFrame();
    const afterCtx: AtomAfterContext = {
      state,
      atom,
      ownerId: h.ownerId,
      frame: curFrame,
      params: curFrame.params,
    };
    await h.handler(afterCtx);
  }
}

/** 运行判定改判钩子(鬼才/鬼道):从当前判定角色起,逆时针依次询问每个
 *  存活玩家的改判能力。在 判定 atom 的 afterApply 阶段调用。
 *
 *  与 runAfterHooks 的区别:遍历顺序不依赖 hook 注册序,而由判定目标座次
 *  逆时针推导,确保「改判方座次靠后于消费方也能生效」——旧实现挂在判定
 *  after-hook 靠注册序混排,改判方须座次靠前才能生效,此处彻底修正。
 */
export async function runJudgeModifiers(state: GameState): Promise<void> {
  // 从 atomStack 栈顶取当前判定 atom(afterApply 在 push 之后、pop 之前调用)
  const atom = state.atomStack[state.atomStack.length - 1];
  if (!atom) return;
  const player = (atom as { player?: number }).player;
  if (typeof player !== 'number') return;
  const modifiers = getJudgeModifierMap(state);
  if (modifiers.size === 0) return;
  const n = state.players.length;
  // 从判定目标起逆时针遍历(含目标自身:目标自带鬼才/鬼道也要问)
  for (let i = 0; i < n; i++) {
    const idx = (player - i + n) % n;
    const entry = modifiers.get(idx);
    if (!entry) continue;
    const p = state.players[idx];
    if (!p?.alive) continue;
    const curFrame = topFrame(state) ?? emptyFrame();
    const afterCtx: AtomAfterContext = {
      state,
      atom,
      ownerId: entry.ownerId,
      frame: curFrame,
      params: curFrame.params,
    };
    await entry.handler(afterCtx);
  }
}

/**
 * 应用一个 atom:走完整 pipeline(before hooks → validate → apply → emit event → after hooks → pending)。
 * 等待型 atom 的 Promise 会挂起直到回应/超时。
 */
export async function applyAtom(state: GameState, atom: Atom): Promise<boolean> {
  state.atomStack.push(atom);

  // before 阶段:折叠(folding)语义。hooks 按注册顺序(座次序)依次跑,
  // 每个 hook 可 pass/modify/cancel。modify 叠加(藤甲-1 后白银狮子看到减过的值);
  // cancel 终止(仁王盾/检测有效性 cancel 后后续 hook 不跑,atom 不进入 validate/apply/after)。
  let current = atom;
  let cancelled = false;
  // 摸牌修正类 before-hook 按 ownerId 逆时针排列(当前回合角色起),
  // 近似规则的"修正后任意顺序叠加"(模块 L)。其他 atom 维持注册序+座次序不变。
  // 系统级 hook(ownerId<0,如酒的全局增伤)排最前。
  const hooks = [...getBeforeHooks(state, atom.type)];
  if (atom.type === '摸牌' && hooks.length > 1) {
    const cur = state.currentPlayerIndex;
    const n = state.players.length;
    hooks.sort((a, b) => {
      const distA = a.ownerId < 0 ? -1 : (a.ownerId - cur + n) % n;
      const distB = b.ownerId < 0 ? -1 : (b.ownerId - cur + n) % n;
      return distA - distB;
    });
  }
  for (const h of hooks) {
    // 界铁骑:目标本回合非锁定技失效 → 跳过非锁定技 hook
    if (isHookSuppressed(state, h.ownerId, h.skillId)) continue;
    const frame = topFrame(state) ?? emptyFrame();
    const beforeCtx: AtomBeforeContext = {
      state,
      atom: current,
      ownerId: h.ownerId,
      frame,
      params: frame.params,
    };
    const result = await h.handler(beforeCtx);
    if (result === undefined) continue; // void = pass(向后兼容)
    if (result.kind === 'cancel') {
      cancelled = true;
      break;
    }
    if (result.kind === 'modify') {
      current = result.atom;
    } // 后续 hook + validate + apply 用新值
  }

  if (cancelled) {
    state.atomStack.pop();
    // cancel 非静默:推 notify 事件让前端感知(技能可据此显示"伤害被取消"/"目标无效")
    pushNotify(state, { skillId: '', eventType: 'atomCancelled', data: { atomType: atom.type } });
    notifyStateChange(state);
    return false; // 被 before hook cancel(如仁王盾:目标无效)
  }

  const def = getAtomDef(current.type);
  const error = def.validate(state, current);
  if (error !== null) {
    state.atomStack.pop();
    throw new Error(`applyAtom validate 失败: ${current.type} → ${error}`);
  }

  // toViewEvents 必须在 apply 之前调用——此时 state 尚未变更
  const viewEvents = resolveViewEvents(state, current);

  applyAtomImpl(state, current);

  // seq 在每次 push atomHistory 前递增:一次 dispatch 内可能有多个 applyAtom
  // (如 respond → 分配武将 → 并行选将),它们必须有各自唯一的 seq,
  // 否则 broadcastNewState 的水位过滤会跳过同 seq 的后续事件(选将 bug 根因)。
  state.seq += 1;
  state.atomHistory.push({
    kind: 'atom',
    seq: state.seq,
    timestamp: Date.now() - state.startedAt,
    atom: current,
    viewEvents: viewEvents!,
  });

  if (def.pending) {
    // 等待型 atom:创建 PendingSlot(单 target) 或多个 slot(并行回应/并行选将多 target)。
    // parallelSplit 声明在 atom 定义上,引擎不再硬编码 type 偏序。
    let targets: number[];
    let slotAtoms: Atom[];
    const splits = def.parallelSplit?.(current);
    if (splits && splits.length > 0) {
      // 并行型:拆出多个 slotAtom,各自类型不同(如 请求回应/选将询问),用各自的 def
      targets = splits.map((s) => s.target);
      slotAtoms = splits.map((s) => s.slotAtom);
    } else {
      // 单 target:原样
      targets = [extractPendingTarget(current)];
      slotAtoms = [current];
    }

    const slotPromises: Promise<void>[] = [];
    for (let i = 0; i < slotAtoms.length; i++) {
      const slotAtom = slotAtoms[i];
      const slotTarget = targets[i];
      // 每个 slot 用自己 atom type 对应的 def(并行回应→请求回应,并行选将→选将询问)
      const slotDef = slotAtom.type !== current.type ? getAtomDef(slotAtom.type) : def;
      slotPromises.push(createAndAwaitSlot(state, slotAtom, slotDef, slotTarget));
    }
    await Promise.all(slotPromises);

    // 等待型 atom:技能 after hooks 和 def.afterHooks 都在 pending resolve 之后跑
    // ——这样贯石斧/青龙偃月刀等技能能在看到 P2 出完闪/不出后再做决策。
    if (def.afterApply) await def.afterApply(state, current);
    await runAfterHooks(state, current);

    if (def.afterHooks) {
      def.afterHooks(state, current);
    }

    state.atomStack.pop();
    // 正常完成路径(等待型 atom):受 state.assertInvariants 开关保护,护栏牌重复 bug。
    // cancel/validate 失败路径不检查(状态已回滚)。
    if (state.assertInvariants) assertCardInvariants(state);
    return true;
  }

  // 非等待型 atom:push 后立即广播。必须在 after hooks 之前——after hooks 内
  // 嵌套的 applyAtom 会各自广播并推进 seq,若此处延后到 after hooks 之后才广播,
  // 当前 atom(seq 较小)会被 broadcastNewState 的水位过滤(sinceSeq)吞掉。
  // (等待型 atom 不在此广播——其 notifyStateChange 由 createAndAwaitSlot 在
  // pendingSlots.set 之后触发,确保 buildView.pending 已含候选将等 slot 数据。)
  notifyStateChange(state);
  // afterApply:apply+广播之后、技能 after hooks 之前的「就地改写」阶段。
  // 典型:判定 atom 在此触发改判钩子(鬼才/鬼道),改判完成后消费方 after hook 读到的即为最终牌。
  if (def.afterApply) await def.afterApply(state, current);
  // 非等待型 atom:技能 after hooks 立即跑(原顺序)
  await runAfterHooks(state, current);

  // atom 自身的后处理(在技能 after hooks 之后):如判定牌从处理区移入弃牌堆
  if (def.afterHooks) {
    def.afterHooks(state, current);
  }

  state.atomStack.pop();
  // 正常完成路径(非等待型 atom):受 state.assertInvariants 开关保护,护栏牌重复 bug。
  // cancel/validate 失败路径不检查(状态已回滚)。
  if (state.assertInvariants) assertCardInvariants(state);
  return true;
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
    // 应用房间配置的 timeoutScale(Infinity=无限)。
    // 广播型 pending(target<0,如无懈可击)在 Infinity 时仍使用 base timeout,避免死锁。
    const isBroadcast = target < 0;
    const timeoutMs = resolveTimeoutMs(state, timeoutSec, isBroadcast);
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
      isBlocking: pending.isBlocking !== false,
      resolve: safeResolve,
      get isTimeout() {
        return timedOut;
      },
      get isPaused() {
        return paused;
      },
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
        // 超时行为:调用 atom 定义的 onTimeout 编排函数。
        // 内部可自由编排 applyAtom(支持多步操作),每个 applyAtom 走完整 pipeline(hooks 正常触发)。
        // 业务逻辑(弃牌超时/选将超时/出牌超时等)由各自 atom 定义声明,引擎核心只管调度。
        await pending.onTimeout(state, atom);
        notifyStateChange(state);
      } finally {
        // 错误恢复边界(非防御性编程):onTimeout 内部编排若抛错,引擎状态已不可信,
        // 但仍必须清理 pendingSlots + resolve 父 execute 的 Promise,否则 execute
        // 永远 await → 游戏死锁。异常本身会通过 dispatch 的 .catch→onError 上报。
        let deleted = false;
        if (state.pendingSlots.get(target) === slot) {
          state.pendingSlots.delete(target);
          deleted = true;
        }
        if (deleted) notifyPendingResolved(state, slot);
        safeResolve();
      }
    };
    slot._fireTimeoutNow = fireTimeoutNow;
    const timer: ReturnType<typeof setTimeout> = setTimeout(fireTimeoutNow, timeoutMs);

    // 存入 pendingSlots Map(按 target 索引)。不同 target 的 slot 共存,各自独立 resolve。
    state.pendingSlots.set(target, slot);
    notifyStateChange(state);
  });
}
