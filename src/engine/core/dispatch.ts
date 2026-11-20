// core/dispatch.ts — client message 派发:dispatch 本体 + 目标形状归一/skip 槽位解析等私属 helper。
// 自 core/index.ts 拆出(逐字搬移,逻辑零改动):导出经 index re-export,import 方零改动。
// bootstrap(create.ts)在函数体内调用本模块;本模块不反向依赖 create.ts,无循环依赖。
import type {
  ActionEntry,
  ClientMessage,
  GameState,
  Json,
  PendingSlot,
} from '../types';
import { findActionEntry, findPendingSlot } from './skill';
import { beginRun, currentIdleCount, whenIdle, whenIdleSince } from './run-tracker';
import { snapshotState, restoreState } from './rollback';
import {
  notifyStateChange,
  removePendingSlot,
  extractPendingTarget,
  logAction,
} from './notify';

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

/** skip action 的槽位解析结果(dispatch 的 skip 分支专用;kind 为实现层判别器)。
 *  - broadcast:广播型 slot(target<0,如无懈可击)→ 累积 skippedPlayers,全员 skip 触发超时
 *  - blocking:非广播型阻塞 pending(如弃牌)→ 直接触发超时
 *  - unsupported:槽缺失/超时/暂停/被认领,或非阻塞型 pending(出牌窗口不支持 skip)→ 拒绝 */
type SkipSlotResolution =
  | { kind: 'broadcast'; slot: PendingSlot }
  | { kind: 'blocking'; slot: PendingSlot }
  | { kind: 'unsupported' };

/** 解析 skip action 应作用的 pending slot。**纯同步只读、无副作用**——skip 块首个
 *  真实 await 之前的段不得引入任何微任务让出(零挂起契约,见 dispatch 内注释),
 *  故抽为同步 helper 由调用方直接调用,而非 async helper + await。
 *  优先查找广播型 slot(target<0,如无懈可击):出牌阶段 findPendingSlot 可能返回
 *  当前玩家的出牌窗口 slot(target=0),导致 skip 误匹配非广播型 pending。
 *  (extractPendingTarget:内置等待型 atom 必有 target 或 player 字段,player≥0。) */
function resolveSkipSlot(state: GameState, ownerId: number): SkipSlotResolution {
  const broadcastSlot = [...state.pendingSlots.values()].find(
    (s) => extractPendingTarget(s.atom) < 0,
  );
  const slot = broadcastSlot ?? findPendingSlot(state, ownerId);
  if (!slot || slot.isTimeout || slot.isPaused || slot.isClaimed) {
    return { kind: 'unsupported' };
  }
  if (extractPendingTarget(slot.atom) < 0) return { kind: 'broadcast', slot };
  return slot.isBlocking ? { kind: 'blocking', slot } : { kind: 'unsupported' };
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
  // 见下方 execute 启动处:settle 在引擎到达稳定点(无 active run)时 resolve。
  let settleResolve!: (error?: Error) => void;
  const settle = new Promise<Error | undefined>((r) => {
    settleResolve = r;
  });
  let settled = false;
  const signalSettle = (error?: Error) => {
    if (settled) return;
    settled = true;
    settleResolve(error);
  };
  let ownsPreparation = false;
  const releasePreparation = () => {
    if (!ownsPreparation) return;
    preparingStates.delete(state);
    ownsPreparation = false;
  };
  let rollbackFailure: Error | undefined;
  const reject = (error?: Error): DispatchResult => {
    error ??= rollbackFailure;
    releasePreparation();
    signalSettle(error);
    if (error) state.onError?.(error);
    return { accepted: false, settle };
  };
  const accept = (): DispatchResult => ({ accepted: true, settle });
  const rollbacks: Array<{ entry: ActionEntry; params: Record<string, Json> }> = [];
  const hasPreceding = !!message.preceding?.length;
  // ── 有序数组快照:preceding(转化技的 当作/去标记 等)直接 mutate players[i].hand / marks,
  //    而各技能 rollback 回调的恢复方式不一致(多张牌 push 回末尾、单张写回影子卡位置),
  //    两者都会把原牌/原标记挪到数组末尾。手牌与标记顺序是客户端可见状态
  //    (UI 排列 + pickTargetCard 盲选的 handIndex 按位置取值),被拒动作不得改动它 ——
  //    否则在线客户端(增量视图看不到被回滚的 preceding 事件)与权威 buildView 顺序不一致,
  //    玩家按位置选到的牌与点击的不是同一张。回滚后按快照整体还原(内容 + 顺序)。
  // 玩家逐字段快照 + 顶层字段快照 + pending 基线,统一封装在 core/rollback.ts。
  // 玩家不整对象替换:在线 execute 可能持有 player/zone 引用,替换引用会让
  // 正在恢复的父流程读写到孤儿对象。
  // (快照必须先于下方 viewBuffering 置位:snapshot.viewBuffering 承担原 bufferWasActive
  //  语义 = 进缓冲前的原值,先置 true 再快照会把 true 误当原值。)
  const snapshot = snapshotState(state, hasPreceding);
  // ── view 缓冲:preceding 的 ViewEvent 缓冲,主 validate 失败时截断 atomHistory,不广播 ──
  if (hasPreceding) state.viewBuffering = true;
  // 回滚 preceding(逆序调用 rollback)+ 截断缓冲的 atomHistory + 恢复 viewBuffering
  // + 还原有序数组快照(hand/marks:技能回调各自恢复顺序不可靠)
  const rollbackPreceding = async (): Promise<void> => {
    try {
      for (let i = rollbacks.length - 1; i >= 0; i--) {
        try {
          await rollbacks[i].entry.rollback?.(state, rollbacks[i].params);
        } catch (error) {
          rollbackFailure ??= error instanceof Error ? error : new Error(String(error));
          state.onError?.(rollbackFailure);
        }
      }
    } finally {
      restoreState(state, snapshot);
      if (rollbackFailure) state.onError?.(rollbackFailure);
    }
  };
  // 拒绝样板:回滚 preceding → 清理快照后残留的 pending → 返回拒绝结果。
  // reject() 会带上 rollbackPreceding 记录的 rollbackFailure 上报。
  const rejectRolledBack = async (): Promise<DispatchResult> => {
    await rollbackPreceding();
    snapshot.pending.cleanupResidual();
    return reject();
  };
  if (message.preceding?.length) {
    preparingStates.add(state);
    ownsPreparation = true;
    for (const p of message.preceding) {
      const pEntry = findActionEntry(state, p.skillId, message.ownerId, p.actionType);
      // preceding 必须自带 rollback:主 action 校验失败/抛错时能逆向撤销已生效的部分效果。
      // 没有 rollback 的动作(如 制衡)一律不允许作为 preceding —— 否则会出现
      // 「牌已弃置进弃牌堆、主 action 被拒、牌仍在手牌」的重复归属。
      if (!pEntry?.rollback) {
        return rejectRolledBack();
      }
      let pError: unknown;
      try {
        pError = pEntry.validate(state, p.params);
      } catch (error) {
        pError = error;
      }
      if (pError !== null) {
        return rejectRolledBack();
      }
      rollbacks.push({ entry: pEntry, params: p.params });
      try {
        await pEntry.execute(state, p.params);
      } catch {
        snapshot.pending.trackNew();
        return rejectRolledBack();
      }
      snapshot.pending.trackNew();
    }
  }
  // skip action:玩家放弃当前 pending 的回应(不打出无懈可击等)
  // preceding+skip 是矛盾的(skip 无转化),但安全处理:flush 缓冲
  if (message.actionType === 'skip') {
    if (hasPreceding) {
      return rejectRolledBack();
    }
    const resolution = resolveSkipSlot(state, message.ownerId);
    // 槽缺失/已超时/暂停/被认领,或非阻塞型 pending(出牌窗口不支持 skip)→ 拒绝
    if (resolution.kind === 'unsupported') return reject();
    // ── skip 语义(零挂起约束)─────────────────────────────────────────────
    // 首个真实 await(_fireTimeoutNow)之前的段——resolveSkipSlot(纯同步)+
    // logAction + skippedPlayers 累积/全员判定——必须留在 dispatch 原位同步执行:
    // 抽成 async helper 再 await 会无条件引入一个微任务让出(即使 helper 内无
    // 真实 await),破坏「dispatch() 调用的同一同步段内副作用可见」的契约。
    // 广播/阻塞两分支的结算尾段(whenIdle → signalSettle → accept)原本各写一遍,
    // 现由下方汇合点共用,不再重复。
    logAction(state, message);
    if (resolution.kind === 'broadcast') {
      // 广播型:记录该玩家已 skip,全员 skip 时提前触发超时。
      // skip 是真实玩家决策,记入 actionLog(缺陷①:此前不记录,服务端重启重放时
      // 「全员快速放弃无懈」的事实丢失,只能靠虚拟时钟超时兜底,resolve 时序与原局
      // 错位 → RNG 链发散)。重放时照常 dispatch 这些 skip 条目即可在广播槽上
      // 忠实累积 skippedPlayers 并在全员 skip 时触发超时;旧日志无 skip 条目则由
      // restore 的兜底逻辑补发(向后兼容)。
      resolution.slot.skippedPlayers ??= new Set();
      resolution.slot.skippedPlayers.add(message.ownerId);
      const alivePlayers = state.players.filter((p) => p.alive).map((p) => p.index);
      if (alivePlayers.every((idx) => resolution.slot.skippedPlayers!.has(idx))) {
        await resolution.slot._fireTimeoutNow?.();
      }
    } else {
      // 非广播型阻塞 pending:触发超时(onTimeout 处理,如弃牌自动弃牌)
      await resolution.slot._fireTimeoutNow?.();
    }
    // 广播/阻塞共用结算尾段:等引擎回稳 → 放行 settle → 接受
    await whenIdle(state);
    signalSettle();
    return accept();
  }
  const entry = findActionEntry(state, message.skillId, message.ownerId, message.actionType);
  // 回应路径:定位该玩家对应的 slot。
  const targetKey = message.ownerId;
  const oldSlot = findPendingSlot(state, targetKey);
  if (!oldSlot && message.pendingSeq !== undefined && message.actionType === 'respond') {
    return rejectRolledBack();
  }
  let entryError: unknown;
  try {
    entryError = entry?.validate(state, message.params);
  } catch (error) {
    entryError = error;
  }
  if (!entry || entryError !== null) {
    return rejectRolledBack();
  }
  if (oldSlot) {
    if (oldSlot.isTimeout || oldSlot.isPaused || oldSlot.isClaimed) {
      return rejectRolledBack();
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
      return rejectRolledBack();
    }
    const claim = oldSlot.claim;
    const claimedHere = claim ? claim() : false;
    if (claim && !claimedHere) {
      return rejectRolledBack();
    }
    oldSlot.pause();
  }

  releasePreparation();
  // ── 全部校验通过:flush 缓冲的 ViewEvent(一次性广播所有积压 event) ──
  if (hasPreceding) {
    state.viewBuffering = snapshot.viewBuffering;
    notifyStateChange(state);
  }

  const resolve = oldSlot?.resolve ?? (() => {});
  logAction(state, message);
  // 统一 slot 清理 helper：按 key 精确匹配 → 引用遍历兜底(notify.removePendingSlot)
  const cleanupSlot = () => {
    if (!oldSlot) return;
    removePendingSlot(state, oldSlot);
    resolve();
    oldSlot.releaseClaim?.();
  };
  // fire-and-forget 启动 execute,完成后 resolve 该玩家的 slot.
  // cleanupSlot 只挂 .finally,不与 .then 双挂:链首 .catch 已把 execute 抛错
  // 转为 fulfilled,而 .finally 对 fulfilled/rejected 都触发、首跳时序与 .then
  // 完全一致(同一微任务拍),且额外覆盖 .catch 内 onError 自身抛错导致 .then
  // 回调被跳过的路径——单挂 .finally 的覆盖面是 .then 的超集。清理幂等由
  // safeResolve(resolveCalled 防重入)+ removePendingSlot(key+引用匹配)保证。
  // (历史:双挂源自 .catch 加入之前的写法——.then 管成功路径清理、.finally 管
  //  抛错路径兜底;链首 .catch 落地后 .then 一档已无独有语义。)
  // 注意:不 return execute 的 promise——execute 内 await pending slot 可能阻塞到玩家回应,
  // 如果 dispatch 返回该 promise,session/harness 的 await 会死锁。
  // dispatch 返回 { accepted, settle }。execute 抛错由链首 .catch 捕获:同步 onError 上报,
  // 并记到 executeError;不 rethrow(避免无人 await 的 unhandled rejection)。
  // settle = 稳定点(core/run-tracker.ts):所有 active run(本 execute、被它 resolve 而
  //   恢复的父 execute 链、超时编排)都已完成或重新挂到 PendingSlot 上。
  //   respond execute 的 cleanupSlot resolve 旧 slot 时,safeResolve 同步把父链记回 active,
  //   先于本 run 结束,所以父链跨动态 import 等真实异步边界恢复期间 settle 不会提前。
  //   不轮询、不依赖宏任务;execute 抛错经 settle 返回。
  let executeError: Error | undefined;
  // 归零序号取样在 beginRun 之前:此刻本 run 还没产生任何归零,之后的那次归零才满足。
  const idleMark = currentIdleCount(state);
  const endRun = beginRun(state);
  void new Promise<void>((resolve) => resolve(entry.execute(state, message.params)))
    .catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      state.onError?.(e);
      executeError = e;
    })
    .finally(cleanupSlot)
    .then(endRun);
  // settle = 本 execute 的稳定点(core/run-tracker.ts):它已完成或已挂到 PendingSlot 上,
  // 且被它唤醒的父 execute 链也已重新挂起/结束。归零序号在 beginRun 之前取样,
  // 只有「本 run 之后的那次归零」满足,不会被调用瞬间的历史归零误命中。
  // 稳定点后再让出一个微任务:slot 清理 / 旧 slot resolve 的收尾链(notifyPendingResolved、
  // 视图广播)是同一批微任务,先让它们跑完,await settle 的调用方读到的才是完整状态。
  void whenIdleSince(state, idleMark)
    .then(() => Promise.resolve())
    .then(() => signalSettle(executeError));
  return accept();
}
