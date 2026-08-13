// core/index.ts — 引擎门面 API + 副作用注册。
// 消费者(session 层)通过顶层 engine/index.ts re-export 访问门面 API。
// 内部消费者(skills/atoms/card-effects)直接 import core/apply, core/frame 等。
import type {
  ActionEntry,
  ActionLogEntry,
  ClientMessage,
  GameState,
  GameView,
  Json,
  PendingSlot,
  Card,
} from '../types';
import { createGameState, TARGET_SYSTEM } from '../types';
import { VirtualClock } from './clock';
import { buildView as buildViewImpl } from '../view/buildView';
import {
  findActionEntry,
  findPendingSlot,
  setSkillInstanceUnload,
} from './skill';
// unloadSkillInstance 已迁至 skills/lifecycle.ts（可直接访问 skillLoaders/cardEffectMap）
import { unloadSkillInstance } from '../skills/lifecycle';
import { createStandardDeck } from './deck';
import { SYSTEM_OWNER } from './notify';
import {
  notifyStateChange,
  notifyPendingResolved,
  extractPendingTarget,
  logAction,
} from './notify';

import * as 系统规则mod from '../skills/系统规则';

export interface GameConfig {
  characters: Array<{ name: string; skills: string[] }>;
  playerCount: number;
  seed: number;
  gameId: string;
  handSize?: number;
  /** 操作倒计时秒数(房间配置,绝对值)。正值=秒数; 0=无限。未设置时各 atom 用自身默认秒数。 */
  timeoutSec?: number;
}

/** 检查游戏是否结束。纯函数,基于 state 计算。
 *  结束条件:主公死亡,或主公存活但所有反贼/内奸均已死亡,或存活 ≤ 1 人。
 *  胜方判定:winner 为某阵营代表座次,前端按其 identity 推导获胜阵营文案。
 *  - 主公阵亡:反贼仍存活 → 反贼胜;反贼全灭且内奸存活(内奸清场单挑残局)→ 内奸胜;
 *    极端(反贼/内奸均无存活)→ 仍判反贼胜。
 *  - 主公存活但反贼/内奸全灭:主公方(主忠)胜,winner=主公座次。
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
  // 主公存活:所有反贼和内奸均已死亡 → 主公方(主忠)获胜
  if (lord && lord.alive) {
    const aliveEnemy = state.players.find(
      (p) => p.alive && (p.identity === '反贼' || p.identity === '内奸'),
    );
    if (!aliveEnemy) return { gameOver: true, winner: lord.index };
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
  state.startedAt = state.clock.now();
  if (gameConfig.timeoutSec !== undefined) {
    state.config = { timeoutSec: gameConfig.timeoutSec };
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
 * restore 路径同样调 bootstrap —— JSON 快照无法恢复运行时内存状态(skill 实例/hooks/
 * respond actions/pending slot 函数),必须靠 bootstrap 重建,再由 restore 重放 actionLog
 * 推进到正确状态。见 ADR 0027 决策 7 修订。
 */
export async function bootstrap(state: GameState, gameConfig: GameConfig): Promise<void> {
  // 防重入:开局已执行过(玩家已发牌)→ 抛错。不是"幂等"——状态变更不可回滚。
  if (state.players.some((p) => p.hand.length > 0)) {
    throw new Error('bootstrap: state 已开局(玩家已有手牌),不可重复 bootstrap');
  }
  const 开局mod = await import('../skills/开局');
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
  // 酒增伤/延时锦囊判定/连环传导 全局 hooks 由 使用牌 skill 的 onInit 注册
  // (首次实例化时注册,后续座次跳过)
  // dispatch 后 await settle:等开局 execute 挂起(选将 slot 创建)再返回。
  // 正常对局保证 broadcastNewState 时选将 pending 已就绪;restore 保证重放前 slot 已建。
  const { settle } = await dispatch(state, {
    skillId: '开局',
    actionType: 'start',
    ownerId: SYSTEM_OWNER,
    params: { ...gameConfig },
    baseSeq: 0,
  });
  const settleError = await settle;
  if (settleError) throw settleError;
}

/**
 * 从持久化数据恢复游戏:重放 actionLog(跳过开局条目,bootstrap 会重新生成)推进到正确状态。
 * 确定性重建完整 state + skill 注册。
 *
 * actionLog[0] 是 开局 start(bootstrap 重新生成),从 [1] 开始重放。
 *
 * state.clock 必须是 VirtualClock(session 在 bootstrap 前注入):
 *   - 重放按 actionLog 时间戳确定性推进虚拟时钟,到期超时自然触发(onTimeout 编排),
 *     替代旧 drainUnresolvedBlockingSlots 的「猜超时」逻辑。
 *   - dispatch 返回 settle 信号(execute 挂起或完成),替代旧的轮询
 *     (waitForResponsiveSlot / waitForPendingOrDone / waitForSeqStable)。
 */
export async function restore(
  state: GameState,
  _gameConfig: GameConfig,
  actionLog: ActionLogEntry[],
): Promise<GameState> {
  const clock = state.clock as VirtualClock;
  const entries = actionLog.slice(1);
  for (const entry of entries) {
    const msg = entry.message;
    // 先推进虚拟时钟到该命令的时间戳:触发所有到期超时。
    // 超时 resolve 上一条 execute 的 slot → 其 resume 到下一个挂起点或完成。
    await clock.advanceTo(entry.timestamp);
    // 重放该命令:dispatch 后等 execute 挂起(slot 创建)或执行完成。
    const { settle } = await dispatch(state, msg);
    const settleError = await settle;
    if (settleError) throw settleError;
  }
  // 重放完毕:排空开局 execute 的异步 resume 链,并触发残留阻塞型 pending 的超时。
  // 开局 execute 跨多个 respond 的 resume 不被任何单次 settle 覆盖(settle 只覆盖
  // 「当前 dispatch 的 execute」),需在此排空微任务让其推进到下一个挂起点。
  // 阻塞型 pending(如界放权询问)在原对局中被超时处理(fireTimeout 副作用不在 actionLog),
  // 触发其超时让 execute 继续;非阻塞 pending(出牌窗口)不触发——restore 停在正常游戏状态。
  for (let guard = 0; guard < 200; guard++) {
    // 排空微任务队列:让挂起的 execute resume 链推进到下一个 await 挂起点或完成。
    await new Promise((r) => setTimeout(r, 0));
    const blocking = [...state.pendingSlots.values()].filter((s) => s.isBlocking);
    if (blocking.length === 0) break;
    for (const slot of blocking) {
      await slot._fireTimeoutNow?.();
    }
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
  const { registerSkillsFromState: registerSkills } = await import('../skills/lifecycle');
  await registerSkills(state);
  // 注册系统规则全局 hooks + 为每个玩家注册选将/弃牌 respond action(与 bootstrap 一致)
  // 系统规则mod 为模块顶部静态导入(见文件头)
  系统规则mod.onInit(系统规则mod.createSkill('系统规则', TARGET_SYSTEM), state);
  for (const player of state.players) {
    系统规则mod.registerSystemRespondActions(state, player.index);
  }
  // 酒增伤/延时锦囊判定/连环传导 全局 hooks 由 使用牌 skill 的 onInit 注册
  // (registerSkills 内部按座次逐个实例化,首次实例化的座次负责注册)
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
export interface DispatchResult {
  /** validate 通过且 execute 已启动(或 skip 已处理)。false = 拒绝。 */
  accepted: boolean;
  /** execute 到达挂起点(slot 创建)或执行完成时 resolve;resolve 时若 execute 抛错则携带该错误,否则为 undefined。validate 拒绝路径立即 resolve(undefined)。 */
  settle: Promise<Error | undefined>;
}

export async function dispatch(state: GameState, message: ClientMessage): Promise<DispatchResult> {
  // settle 信号:execute 是 fire-and-forget,restore 需要知道它何时「挂起或完成」。
  // 挂起点由 createAndAwaitSlot 在 slot 入 pendingSlots 后调 state.onExecuteSettle 通知;
  // 执行完成由下方 .finally(settleAfterDrain) 通知。两处竞争,settled 防重入只 resolve 一次。
  // settle 携带 execute 错误(若有):挂起点(onExecuteSettle)与 validate 拒绝(reject)
  // 都是无错误路径,resolve(undefined);只有 execute 自身抛错才 resolve(error)。
  let settleResolve!: (error?: Error) => void;
  const settle = new Promise<Error | undefined>((r) => {
    settleResolve = r;
  });
  let settled = false;
  const signalSettle = (error?: Error) => {
    if (settled) return;
    settled = true;
    state.onExecuteSettle = null;
    settleResolve(error);
  };
  state.onExecuteSettle = signalSettle;
  const reject = (): DispatchResult => {
    signalSettle();
    return { accepted: false, settle };
  };
  const accept = (): DispatchResult => ({ accepted: true, settle });

  const rollbacks: Array<{ entry: ActionEntry; params: Record<string, Json> }> = [];
  // ── view 缓冲:preceding 的 ViewEvent 缓冲,主 validate 失败时截断 atomHistory,不广播 ──
  const hasPreceding = !!message.preceding?.length;
  const bufferSnapshot = hasPreceding ? state.atomHistory.length : 0;
  if (hasPreceding) state.viewBuffering = true;
  // 回滚 preceding(逆序调用 rollback)+ 截断缓冲的 atomHistory + 恢复 viewBuffering
  const rollbackPreceding = async (): Promise<void> => {
    for (let i = rollbacks.length - 1; i >= 0; i--) {
      await rollbacks[i].entry.rollback?.(state, rollbacks[i].params);
    }
    if (hasPreceding) {
      state.atomHistory.length = bufferSnapshot;
      state.viewBuffering = false;
    }
  };
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
        await rollbackPreceding();
        cleanupResidualPending();
        return reject();
      }
      await pEntry.execute(state, p.params);
      rollbacks.push({ entry: pEntry, params: p.params });
    }
  }
  // skip action:玩家放弃当前 pending 的回应(不打出无懈可击等)
  // preceding+skip 是矛盾的(skip 无转化),但安全处理:flush 缓冲
  if (message.actionType === 'skip') {
    if (hasPreceding) {
      state.viewBuffering = false;
      notifyStateChange(state);
    }
    // 优先查找广播型 slot(target<0,如无懈可击):出牌阶段 findPendingSlot 可能返回
    // 当前玩家的出牌窗口 slot(target=0),导致 skip 误匹配非广播型 pending。
    const broadcastSlot = [...state.pendingSlots.values()].find((s) => {
      const t = (s.atom as { target?: unknown }).target;
      return typeof t === 'number' && t < 0;
    });
    const slot = broadcastSlot ?? findPendingSlot(state, message.ownerId);
    if (!slot || slot.isTimeout) return reject();
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
      signalSettle();
      return accept();
    }
    // 非广播型阻塞 pending:触发超时(onTimeout 处理,如弃牌自动弃牌)
    if (slot.isBlocking) {
      await slot._fireTimeoutNow?.();
      signalSettle();
      return accept();
    }
    // 非阻塞型 pending(出牌窗口):不支持 skip,返回 false
    return reject();
  }
  const entry = findActionEntry(state, message.skillId, message.ownerId, message.actionType);
  if (entry?.validate(state, message.params) !== null) {
    await rollbackPreceding();
    return reject();
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
      await rollbackPreceding();
      return reject();
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
      await rollbackPreceding();
      return reject();
    }
    oldSlot.pause();
  }

  // ── 全部校验通过:flush 缓冲的 ViewEvent(一次性广播所有积压 event) ──
  if (hasPreceding) {
    state.viewBuffering = false;
    notifyStateChange(state);
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
  // dispatch 返回 { accepted, settle }。execute 抛错由链首 .catch 捕获:同步 onError 上报,
  // 并记到 executeError;不 rethrow(避免无人 await 的 unhandled rejection)。
  // settle 在「execute 完成/挂起且排空父 execute 的异步 resume」后 resolve:
  //   respond execute 的 cleanupSlot resolve 旧 slot,触发父 execute(如开局)的异步 resume 链。
  //   若直接 signalSettle,restore 的下一条 respond 会在父 resume 创建的新 slot 出现前被拒。
  //   故先排空微任务让 resume 推进到下一个挂起点(slot 创建触发 onExecuteSettle)或完成。
  //   settleAfterDrain 把 executeError 传给 signalSettle,使 await settle 方能感知 execute 错误。
  let executeError: Error | undefined;
  const settleAfterDrain = async (): Promise<void> => {
    for (let i = 0; i < 20 && !settled; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    signalSettle(executeError);
  };
  entry
    .execute(state, message.params)
    .catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      state.onError?.(e);
      executeError = e;
    })
    .then(cleanupSlot)
    .finally(cleanupSlot)
    .finally(settleAfterDrain);
  return accept();
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
