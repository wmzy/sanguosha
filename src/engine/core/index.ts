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
import { buildView as buildViewImpl } from '../view/buildView';
import {
  findActionEntry,
  findPendingSlot,
  setSkillInstanceUnload,
  unloadSkillInstance,
} from './skill';
import { createStandardDeck } from './deck';
import { SYSTEM_OWNER } from './notify';
import {
  notifyStateChange,
  notifyPendingResolved,
  extractPendingTarget,
  logAction,
} from './notify';

// atom 注册副作用:必须 import 来注册所有 atom 定义(后端 dispatch 依赖)。
// 前端通过 client/engine-imports.ts 的 `import '../engine/atoms'` 触发同一注册。
import '../atoms';
// 系统规则 与本模块互依(系统规则 import applyAtom),用静态导入避免打包器循环依赖拆 chunk。
// 系统规则模块顶层无副作用,静态/动态加载语义等价(ESM live binding 解析循环)。
import * as 系统规则mod from '../skills/系统规则';
// skills/index.ts 设置 skillModuleResolver。
import '../skills';

export interface GameConfig {
  characters: Array<{ name: string; skills: string[] }>;
  playerCount: number;
  seed: number;
  gameId: string;
  handSize?: number;
  /** pending 超时倍率(房间配置)。1=默认; <1 更快; >1 更慢; Infinity=无限。 */
  timeoutScale?: number;
}

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
  // 注册酒的全局「造成伤害」before-hook(消费增伤标记)
  const { registerWineHook } = await import('../card-effects/酒');
  registerWineHook(state);
  // 注册延时锦囊（乐不思蜀/兵粮寸断/闪电）的判定阶段 + 跳过阶段 before-hook
  const { registerDelayedTrickHooks } = await import('./card-effect/use-card');
  registerDelayedTrickHooks(state);
  // 注册连环传导全局 after-hook（属性伤害联动横置状态）
  const { registerChainConductionHook } = await import('../flows/face-down');
  registerChainConductionHook(state);
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
 *
 * 重放同步(settle) + 超时推进(fireTimeout):
 * dispatch 是 fire-and-forget —— execute 在后台异步跑到等待型 atom 才创建 pending slot。
 * 1. respond 类 action(选将/respond/skip/confirm)重放前等目标 slot 出现(waitForResponsiveSlot)。
 * 2. dispatch 后等 execute 创建 pending 或跑完(waitForPendingOrDone)。
 * 3. isBlocking pending(询问闪/请求回应等)若不被剩余 actionLog respond,说明原对局中
 *    是被超时处理的(fireTimeout 的扣血/弃牌副作用不在 actionLog),主动 fireTimeout
 *    它(用 slot._fireTimeoutNow,只触发该 slot,不误伤出牌窗口等非阻塞 pending)。
 *    fireTimeout 后等 execute resume 推进完成(waitForSeqStable)。
 * 4. 重放完毕后 fireTimeout 残留 isBlocking pending。
 * 不做这一步则 isBlocking pending 永不 resolve → 挂起 execute 堆积 → OOM。
 */
const settleSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** respond 类 actionType:重放时需要目标 pending slot 存在才能被 dispatch 接受。 */
const RESPONSIVE_ACTION_TYPES = new Set(['选将', 'respond', 'skip', 'confirm']);

/** 等待目标玩家的 pending slot 出现(fire-and-forget execute 推进到挂起点)。 */
async function waitForResponsiveSlot(
  state: GameState,
  ownerId: number,
  timeoutMs = 5000,
): Promise<void> {
  const hasSlot = (): boolean => {
    if (state.pendingSlots.has(ownerId)) return true;
    // 广播型 slot(无懈可击 target<0):任意 ownerId respond 都命中同一 slot
    for (const slot of state.pendingSlots.values()) {
      const t = (slot.atom as { target?: number }).target;
      if (typeof t === 'number' && t < 0) return true;
    }
    return false;
  };
  if (hasSlot()) return;
  for (let i = 0; i < timeoutMs / 5 && !hasSlot(); i++) await settleSleep(5);
}

/** 等 fire-and-forget execute 创建 pending(挂起点)或跑完(atomStack 空)。
 *  用 setTimeout(0) yield 到微任务队列,让 execute 推进。 */
async function waitForPendingOrDone(state: GameState, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 0));
    if (state.pendingSlots.size > 0) return;
    if (state.atomStack.length === 0) return;
  }
}

/** 等 seq 稳定(连续 3 次采样不变)。fireTimeout resolve slot 后,父 execute 从 await
 *  恢复继续跑;seq 稳定说明 execute 已到达下一个 await 或彻底完成。 */
async function waitForSeqStable(state: GameState, timeoutMs = 3000): Promise<void> {
  let lastSeq = state.seq;
  let stable = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await settleSleep(5);
    if (state.seq === lastSeq) {
      if (++stable >= 3) return;
    } else {
      stable = 0;
      lastSeq = state.seq;
    }
  }
}

/** fireTimeout 不被剩余 actionLog respond 的 isBlocking pending。
 *  这些 pending 在原对局中是被超时处理的(fireTimeout 副作用不在 actionLog),
 *  重放时必须主动 fireTimeout 推进 execute,否则 pending 永不 resolve → 堆积 OOM。
 *  用 slot._fireTimeoutNow 只触发该 slot,不误伤出牌窗口等非阻塞 pending。 */
async function drainUnresolvedBlockingSlots(
  state: GameState,
  remaining: ActionLogEntry[],
): Promise<void> {
  for (const slot of [...state.pendingSlots.values()].filter((s) => s.isBlocking)) {
    const sp = (slot.atom as { player?: number; target?: number }).player ??
      (slot.atom as { target?: number }).target;
    if (typeof sp !== 'number') continue;
    const handledLater = remaining.some(
      (e) => RESPONSIVE_ACTION_TYPES.has(e.message.actionType) && e.message.ownerId === sp,
    );
    if (!handledLater) {
      await slot._fireTimeoutNow?.();
      await waitForSeqStable(state);
    }
  }
}

export async function restore(
  state: GameState,
  gameConfig: GameConfig,
  actionLog: ActionLogEntry[],
): Promise<GameState> {
  const entries = actionLog.slice(1);
  for (let i = 0; i < entries.length; i++) {
    const msg = entries[i].message;
    const remaining = entries.slice(i + 1);
    // respond 类(选将/弃牌/请求回应/skip/confirm):等 fire-and-forget execute 创建目标 slot
    if (RESPONSIVE_ACTION_TYPES.has(msg.actionType)) {
      await waitForResponsiveSlot(state, msg.ownerId);
    }
    await dispatch(state, msg);
    await waitForPendingOrDone(state);
    // isBlocking pending 不被剩余 actionLog respond → fireTimeout 推进(模拟原对局超时)
    await drainUnresolvedBlockingSlots(state, remaining);
  }
  // 重放完毕:fireTimeout 残留 isBlocking pending(原对局中已被超时处理)
  for (let guard = 0; guard < 50; guard++) {
    const blocking = [...state.pendingSlots.values()].filter((s) => s.isBlocking);
    if (blocking.length === 0) break;
    for (const slot of blocking) await slot._fireTimeoutNow?.();
    await waitForSeqStable(state);
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
  const { registerWineHook } = await import('../card-effects/酒');
  registerWineHook(state);
  // 注册延时锦囊（乐不思蜀/兵粮寸断/闪电）的判定阶段 + 跳过阶段 before-hook
  const { registerDelayedTrickHooks } = await import('./card-effect/use-card');
  registerDelayedTrickHooks(state);
  // 注册连环传导全局 after-hook（属性伤害联动横置状态）
  const { registerChainConductionHook } = await import('../flows/face-down');
  registerChainConductionHook(state);
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
        return false;
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
    await rollbackPreceding();
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
      await rollbackPreceding();
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
      await rollbackPreceding();
      return false;
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
