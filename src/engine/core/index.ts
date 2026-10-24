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
import { createGameState } from '../types';
import { VirtualClock } from './clock';
import { buildView as buildViewImpl } from '../view/buildView';
import { findActionEntry, findPendingSlot, setSkillInstanceUnload } from './skill';
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

// 规则包(游戏模式)动态加载:core 不静态依赖任何具体模式规则(ADR 0029)。
import { loadRuleset } from '../rules/registry';
import type { GameMode } from '../rules/types';

export interface GameConfig {
  characters: Array<{ name: string; skills: string[] }>;
  playerCount: number;
  seed: number;
  gameId: string;
  handSize?: number;
  /** 操作倒计时秒数(房间配置,绝对值)。正值=秒数; 0=无限。未设置时各 atom 用自身默认秒数。 */
  timeoutSec?: number;
  /** 游戏模式(规则包)。默认 身份局。restore 时用于从快照恢复模式。 */
  mode?: GameMode;
  /** 玩家显示名(座次 i → 昵称)。缺省回退 player-{i}。 */
  playerNames?: string[];
}

/** 解析 state.config 中持久化的模式,缺省回退 身份局(兼容旧快照)。 */
export function resolveGameMode(state: GameState): GameMode {
  return state.config?.mode ?? '身份局';
}

/** 检查游戏是否结束。基于 state.config.mode 加载对应规则包判定(默认身份局)。
 *  异步(动态 import):session 在 onStateChange 中 await。具体判定逻辑见
 *  rules/身份局.ts(身份局与 1v1 共用)——core 层不再内嵌模式规则(ADR 0029)。 */
export async function checkGameOver(
  state: GameState,
): Promise<{ gameOver: boolean; winner?: number }> {
  const ruleset = await loadRuleset(resolveGameMode(state));
  return ruleset.checkGameOver(state);
}
export function create(gameConfig: GameConfig): GameState {
  const playerCount = Math.max(2, Math.min(8, gameConfig.playerCount));
  const stubPlayers = Array.from({ length: playerCount }, (_, i) => ({
    index: i,
    name: gameConfig.playerNames?.[i]?.trim() ?? `player-${i}`,
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
  // config 持久化到 state(随快照序列化):mode 供 checkGameOver/开局 ruleset 解析,
  // timeoutSec 供各 atom 读取。timeoutSec 未设置时仍写入 config(仅含 mode)。
  state.config = {
    ...(gameConfig.timeoutSec !== undefined ? { timeoutSec: gameConfig.timeoutSec } : {}),
    ...(gameConfig.mode !== undefined ? { mode: gameConfig.mode } : {}),
  };
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
  // 规则包(按 gameConfig.mode 动态加载,默认身份局):注册系统规则全局 hooks
  // (添加技能/移除技能/弃置/濒死检查)+ 每座次 选将/弃牌 respond action。
  // core 不静态依赖具体规则实现(ADR 0029);开局 skill 同样经 registry 读
  // ruleset.opening 驱动选将流程。mode 同时持久化到 state.config——
  // 开局 execute/checkGameOver 均从 state.config.mode 解析(快照恢复同样依赖)。
  const mode = gameConfig.mode ?? resolveGameMode(state);
  state.config = { ...state.config, mode };
  const ruleset = await loadRuleset(mode);
  ruleset.onInit(state);
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
  // 旧格式日志(缺陷①修复前)不含 skip 条目:广播槽(无懈可击)被全员快速 skip 的事实
  // 未被记录。兜底:重放非无懈 action 前,若广播槽仍滞留(时间戳未推进到其超时时刻,
  // 说明原局是快速 skip 而非超时 resolve),替所有存活玩家补发 skip,等价原局全员
  // 放弃无懈。新格式日志自带 skip 条目,广播按条目忠实 resolve,不进入此分支。
  const legacyLog = !entries.some((e) => e.message.actionType === 'skip');
  for (const entry of entries) {
    const msg = entry.message;
    // 先推进虚拟时钟到该命令的时间戳:触发所有到期超时。
    // 超时 resolve 上一条 execute 的 slot → 其 resume 到下一个挂起点或完成。
    await clock.advanceTo(entry.timestamp);
    // 「设置手牌顺序」是盲选流程(pick-card-panel.spliceHandOrderEntry)splice 进
    // actionLog 的服务端内部快照,原对局从不走 dispatch(同 session.handleReorderHand
    // 的纯 mutate)。若当普通 action dispatch,findPendingSlot(ownerId) 会误命中该
    // owner 此刻的无关 pending(广播型无懈/选牌面板)并 pause+resolve 它,提前消费
    // pending → 后续 respond 被 validate 拒绝 → 整局发散(UDFJRA 实证)。这里直接
    // mutate 目标手牌(排列校验镜像 handleReorderHand:order 须为当前 hand 的合法
    // 排列,否则说明重放已错位,静默跳过),并把条目原样保留进重放后的 actionLog ——
    // session.restoreState 用 fresh.actionLog 作为后续持久化/再次恢复的权威日志,
    // 丢弃 splice 条目会让二次重启丢失盲选顺序。
    if (msg.actionType === '设置手牌顺序') {
      const target = msg.params?.target;
      const order = msg.params?.order;
      const player = typeof target === 'number' ? state.players[target] : undefined;
      if (
        player &&
        Array.isArray(order) &&
        order.length === player.hand.length &&
        order.every((id) => typeof id === 'string' && player.hand.includes(id))
      ) {
        player.hand = [...(order as string[])];
      }
      state.actionLog.push({ ...entry, id: String(state.actionLog.length) });
      continue;
    }
    if (legacyLog) await autoSkipLingeringBroadcast(state, msg);
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

/** 旧格式日志(无 skip 条目)兜底:重放 msg 前,若广播型槽(无懈可击)滞留且 msg
 *  不是对它的无懈回应,替所有存活玩家补发 skip——原局全员放弃无懈的事实未被记录,
 *  不补发则 msg 会在广播 resolve 前被 validate 拒绝(hasBlockingPending),respond
 *  丢失 → 整局发散。最后一名玩家 skip 后广播 fireTimeoutNow resolve,父 execute 经
 *  settle 排空 resume 到下一挂起点,随后 msg 的 dispatch 不会误命中已消亡的 pending。
 *  补发的 skip 走 dispatch 正常路径,会记入重放后的 actionLog(旧格式自此转为新格式)。 */
async function autoSkipLingeringBroadcast(state: GameState, msg: ClientMessage): Promise<void> {
  const hasBroadcast = () =>
    [...state.pendingSlots.values()].some((s) => {
      const t = (s.atom as { target?: unknown }).target;
      return typeof t === 'number' && t < 0;
    });
  for (let guard = 0; guard < 10; guard++) {
    if (!hasBroadcast()) return;
    // msg 本身是对该广播的无懈回应:直接 dispatch 让它 resolve,不替玩家放弃。
    if (msg.skillId === '无懈可击') return;
    for (const p of state.players) {
      if (!p.alive) continue;
      // 广播可能已被上一条 skip resolve(全员放弃):补发前重新确认仍滞留,
      // 避免误 skip 后续新出现的非广播 pending(如选牌面板)。
      if (!hasBroadcast()) break;
      const { settle } = await dispatch(state, {
        skillId: '__skip',
        actionType: 'skip',
        ownerId: p.index,
        params: {},
        baseSeq: state.seq,
      });
      await settle;
    }
  }
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
  // 注册规则包全局 hooks + 为每个玩家注册选将/弃牌 respond action(与 bootstrap 一致)。
  // 模式取 state.config(测试构造的 state 未走 create 时缺省身份局)。
  const ruleset = await loadRuleset(resolveGameMode(state));
  ruleset.onInit(state);
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

/**
 * 目标形状归一(dispatch 边界)。
 *
 * 客户端对「目标」有两种 wire 形状(见 client/utils/gameViewHelpers.buildPlayParams):
 *   · 普通牌 / 技能代价牌(非延时锦囊)→ { targets: [idx] }
 *   · 延时锦囊 → { target: idx }
 * 回应路径(useCardAndTarget 型 pending)固定发 targets(usePlayInteraction.handleRespond)。
 *
 * 引擎侧各技能读法不一:使用牌 skill 自带 target→targets 归一,但**自带 use/respond action
 * 的技能**(断粮/界断粮/审时/驱虎/天义/界巧说/界陷阵/天香/乱武 …)拿不到它 →
 *   · 只读单数 target 的技能对 targets 形状恒拒(「需要选择目标」);
 *   · 只读 targets 的技能(界火计)对延时锦囊代价牌(单数 target)恒拒。
 * 两者都让整类技能在浏览器与 AI 客户端不可用,且只有手写另一种形状的测试能过。
 *
 * 在消息入口把两种形状补齐(已有值不覆盖;单数只取 targets[0],多目标牌不受影响),
 * 技能读任一形状都成立。preceding 的 params 同样归一(转化技的代价/目标形状一致)。
 */
function normalizeTargetShape(params: Record<string, Json>): Record<string, Json> {
  const target = typeof params.target === 'number' ? params.target : undefined;
  const targets = Array.isArray(params.targets) ? params.targets : undefined;
  if (target !== undefined && targets !== undefined) return params;
  if (target !== undefined) return { ...params, targets: [target] };
  const first = targets && typeof targets[0] === 'number' ? targets[0] : undefined;
  if (first !== undefined) return { ...params, target: first };
  return params;
}

function normalizeMessageTargetShape(message: ClientMessage): ClientMessage {
  const params = normalizeTargetShape(message.params);
  const preceding = message.preceding?.map((p) => ({
    ...p,
    params: normalizeTargetShape(p.params),
  }));
  if (params === message.params && preceding === message.preceding) return message;
  return { ...message, params, ...(preceding ? { preceding } : {}) };
}

const preparingStates = new WeakSet<GameState>();

export async function dispatch(
  state: GameState,
  rawMessage: ClientMessage,
): Promise<DispatchResult> {
  if (preparingStates.has(state)) {
    return { accepted: false, settle: Promise.resolve(undefined) };
  }
  const initialSlot = findPendingSlot(state, rawMessage.ownerId);
  if (initialSlot && (initialSlot.isTimeout || initialSlot.isPaused || initialSlot.isClaimed)) {
    return { accepted: false, settle: Promise.resolve(undefined) };
  }
  const message = normalizeMessageTargetShape(rawMessage);
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
  const settleListeners =
    state.onExecuteSettleListeners ?? (state.onExecuteSettleListeners = new Set());
  let onExecuteSettle: (slot: PendingSlot) => void = () => {};
  const signalSettle = (error?: Error) => {
    if (settled) return;
    settled = true;
    settleListeners.delete(onExecuteSettle);
    settleResolve(error);
  };
  let ownsPreparation = false;
  const releasePreparation = () => {
    if (!ownsPreparation) return;
    preparingStates.delete(state);
    ownsPreparation = false;
  };
  const reject = (error?: Error): DispatchResult => {
    releasePreparation();
    signalSettle(error);
    if (error) state.onError?.(error);
    return { accepted: false, settle };
  };
  const accept = (): DispatchResult => ({ accepted: true, settle });
  // 排空微任务直到 settle(execute resume 后创建 slot 触发 onExecuteSettle)或预算耗尽。
  // skip 触发超时的路径需要:fireTimeoutNow resolve 广播/阻塞 slot → 父 execute 跨微任务
  // resume 到下一挂起点;若不等它,restore 的下一条 action 会在 resume 创建的新 slot
  // 出现前被 validate 拒绝(与下方 respond 路径的 settleAfterDrain 同理)。
  // 预算取宽(1000 次 macrotask ≈ ≥1s):父 resume 链可能含技能模块的首次动态 import,
  // vitest 下按需转换可达数百毫秒,预算不足会让 restore 抢跑(后续条目被静默拒绝)。
  // 排空只影响 settle 信号时机,不触碰任何游戏状态,不破坏重放确定性。
  const drainUntilSettled = async (): Promise<void> => {
    for (let i = 0; i < 1000 && !settled; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  const rollbacks: Array<{ entry: ActionEntry; params: Record<string, Json> }> = [];
  // ── view 缓冲:preceding 的 ViewEvent 缓冲,主 validate 失败时截断 atomHistory,不广播 ──
  const hasPreceding = !!message.preceding?.length;
  const bufferSnapshot = hasPreceding ? state.atomHistory.length : 0;
  const bufferWasActive = state.viewBuffering === true;
  if (hasPreceding) state.viewBuffering = true;
  // ── 有序数组快照:preceding(转化技的 当作/去标记 等)直接 mutate players[i].hand / marks,
  //    而各技能 rollback 回调的恢复方式不一致(多张牌 push 回末尾、单张写回影子卡位置),
  //    两者都会把原牌/原标记挪到数组末尾。手牌与标记顺序是客户端可见状态
  //    (UI 排列 + pickTargetCard 盲选的 handIndex 按位置取值),被拒动作不得改动它 ——
  //    否则在线客户端(增量视图看不到被回滚的 preceding 事件)与权威 buildView 顺序不一致,
  //    玩家按位置选到的牌与点击的不是同一张。回滚后按快照整体还原(内容 + 顺序)。
  const orderedSnapshot = hasPreceding
    ? state.players.map((p) => ({
        hand: [...p.hand],
        marks: structuredClone(p.marks),
        vars: structuredClone(p.vars),
        equipment: { ...p.equipment },
        tags: [...p.tags],
      }))
    : null;
  const cardMapSnapshot = hasPreceding ? { ...state.cardMap } : null;
  const localVarsSnapshot = hasPreceding ? structuredClone(state.localVars) : null;
  const turnVarsSnapshot = hasPreceding ? structuredClone(state.turn.vars) : null;
  const atomStackSnapshot = hasPreceding ? [...state.atomStack] : null;
  const settlementSnapshot = hasPreceding ? [...state.settlementStack] : null;
  const seqSnapshot = state.seq;
  // 回滚 preceding(逆序调用 rollback)+ 截断缓冲的 atomHistory + 恢复 viewBuffering
  // + 还原有序数组快照(hand/marks:技能回调各自恢复顺序不可靠)
  const rollbackPreceding = async (): Promise<void> => {
    try {
      for (let i = rollbacks.length - 1; i >= 0; i--) {
        try {
          await rollbacks[i].entry.rollback?.(state, rollbacks[i].params);
        } catch (error) {
          state.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      if (orderedSnapshot) {
        for (let i = 0; i < orderedSnapshot.length; i++) {
          const p = state.players[i];
          if (!p) continue;
          p.hand = [...orderedSnapshot[i].hand];
          p.marks = structuredClone(orderedSnapshot[i].marks);
          p.vars = structuredClone(orderedSnapshot[i].vars);
          p.equipment = { ...orderedSnapshot[i].equipment };
          // rollback 回调可恢复装备槽位；用装备牌面重建依赖 vars，避免快照中的旧
          // 直接构造状态没有通过「装备」atom而缺少距离变量。
          const weaponId = p.equipment['武器'];
          if (weaponId) {
            const weapon = state.cardMap[weaponId];
            if (weapon?.range !== undefined) p.vars['距离/出杀范围'] = weapon.range;
          }
          p.tags = [...orderedSnapshot[i].tags];
        }
      }
      if (hasPreceding) {
        if (cardMapSnapshot) {
          for (const id of Object.keys(state.cardMap)) {
            if (!(id in cardMapSnapshot)) delete state.cardMap[id];
          }
          Object.assign(state.cardMap, cardMapSnapshot);
        }
        state.localVars = localVarsSnapshot!;
        state.turn.vars = turnVarsSnapshot!;
        state.atomStack = atomStackSnapshot!;
        state.settlementStack = settlementSnapshot!;
        for (const [key, slot] of state.pendingSlots) {
          if (!createdPending.has(slot)) continue;
          state.pendingSlots.delete(key);
          slot.resolve();
          const previous = pendingEntriesSnapshot.get(key);
          if (previous) state.pendingSlots.set(key, previous);
        }
        state.atomHistory.length = bufferSnapshot;
        state.seq = seqSnapshot;
        state.viewBuffering = bufferWasActive;
      }
    }
  };
  const pendingEntriesSnapshot = new Map(state.pendingSlots);
  const pendingSnapshot = new Set(state.pendingSlots.values());
  const createdPending = new Set<PendingSlot>();
  onExecuteSettle = (slot: PendingSlot) => {
    if (!pendingSnapshot.has(slot)) {
      createdPending.add(slot);
      signalSettle();
    }
  };
  if (!hasPreceding) settleListeners.add(onExecuteSettle);
  const trackNewPending = () => {
    for (const slot of state.pendingSlots.values()) {
      if (!pendingSnapshot.has(slot)) createdPending.add(slot);
    }
  };
  // 只清理由本次 preceding 新创建的 slot；旧 slot 可能属于其他玩家正在等待的流程，
  // 绝不能因本次 action 被拒而 resolve/delete。
  const cleanupResidualPending = () => {
    for (const [key, slot] of state.pendingSlots) {
      if (!createdPending.has(slot)) continue;
      if (state.pendingSlots.get(key) === slot) state.pendingSlots.delete(key);
      slot.resolve();
    }
  };
  if (message.preceding?.length) {
    preparingStates.add(state);
    ownsPreparation = true;
    for (const p of message.preceding) {
      const pEntry = findActionEntry(state, p.skillId, message.ownerId, p.actionType);
      let pError: unknown;
      try {
        pError = !pEntry ? new Error('preceding action not found') : pEntry.validate(state, p.params);
      } catch (error) {
        pError = error;
      }
      if (pError !== null) {
        await rollbackPreceding();
        cleanupResidualPending();
        return reject();
      }
      rollbacks.push({ entry: pEntry!, params: p.params });
      try {
        await pEntry!.execute(state, p.params);
      } catch {
        trackNewPending();
        await rollbackPreceding();
        cleanupResidualPending();
        return reject();
      }
      trackNewPending();
    }
  }
  // skip action:玩家放弃当前 pending 的回应(不打出无懈可击等)
  // preceding+skip 是矛盾的(skip 无转化),但安全处理:flush 缓冲
  if (message.actionType === 'skip') {
    if (hasPreceding) {
      await rollbackPreceding();
      cleanupResidualPending();
      return reject();
    }
    // 优先查找广播型 slot(target<0,如无懈可击):出牌阶段 findPendingSlot 可能返回
    // 当前玩家的出牌窗口 slot(target=0),导致 skip 误匹配非广播型 pending。
    const broadcastSlot = [...state.pendingSlots.values()].find((s) => {
      const t = (s.atom as { target?: unknown }).target;
      return typeof t === 'number' && t < 0;
    });
    const slot = broadcastSlot ?? findPendingSlot(state, message.ownerId);
    if (!slot || slot.isTimeout || slot.isPaused || slot.isClaimed) return reject();
    const atomTarget = (slot.atom as { target?: number }).target;
    const isBroadcast = typeof atomTarget === 'number' && atomTarget < 0;
    if (isBroadcast) {
      // 广播型:记录该玩家已 skip,全员 skip 时提前触发超时。
      // skip 是真实玩家决策,记入 actionLog(缺陷①:此前不记录,服务端重启重放时
      // 「全员快速放弃无懈」的事实丢失,只能靠虚拟时钟超时兜底,resolve 时序与原局
      // 错位 → RNG 链发散)。重放时照常 dispatch 这些 skip 条目即可在广播槽上
      // 忠实累积 skippedPlayers 并在全员 skip 时触发超时;旧日志无 skip 条目则由
      // restore 的兜底逻辑补发(向后兼容)。
      logAction(state, message);
      slot.skippedPlayers ??= new Set();
      slot.skippedPlayers.add(message.ownerId);
      const alivePlayers = state.players.filter((p) => p.alive).map((p) => p.index);
      if (alivePlayers.every((idx) => slot.skippedPlayers!.has(idx))) {
        await slot._fireTimeoutNow?.();
        await drainUntilSettled();
      }
      signalSettle();
      return accept();
    }
    // 非广播型阻塞 pending:触发超时(onTimeout 处理,如弃牌自动弃牌)
    if (slot.isBlocking) {
      logAction(state, message);
      await slot._fireTimeoutNow?.();
      await drainUntilSettled();
      signalSettle();
      return accept();
    }
    // 非阻塞型 pending(出牌窗口):不支持 skip,返回 false
    return reject();
  }
  const entry = findActionEntry(state, message.skillId, message.ownerId, message.actionType);
  // 回应路径:定位该玩家对应的 slot。
  const targetKey = message.ownerId;
  const oldSlot = findPendingSlot(state, targetKey);
  if (!oldSlot && message.pendingSeq !== undefined && message.actionType === 'respond') {
    await rollbackPreceding();
    cleanupResidualPending();
    return reject();
  }
  let entryError: unknown;
  try {
    entryError = entry?.validate(state, message.params);
  } catch (error) {
    entryError = error;
  }
  if (!entry || entryError !== null) {
    await rollbackPreceding();
    cleanupResidualPending();
    return reject();
  }
  if (oldSlot) {
    if (oldSlot.isTimeout || oldSlot.isPaused || oldSlot.isClaimed) {
      await rollbackPreceding();
      cleanupResidualPending();
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
      cleanupResidualPending();
      return reject();
    }
    const claim = oldSlot.claim;
    const claimedHere = claim ? claim() : false;
    if (claim && !claimedHere) {
      await rollbackPreceding();
      cleanupResidualPending();
      return reject();
    }
    oldSlot.pause();
  }

  releasePreparation();
  settleListeners.add(onExecuteSettle);
  // ── 全部校验通过:flush 缓冲的 ViewEvent(一次性广播所有积压 event) ──
  if (hasPreceding) {
    state.viewBuffering = bufferWasActive;
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
    oldSlot.releaseClaim?.();
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
    await drainUntilSettled();
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
