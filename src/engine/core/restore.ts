// core/restore.ts — 从持久化数据恢复游戏:actionLog 重放 + 旧日志兜底。
// 自 core/index.ts 拆出(纯搬移);dispatch 经 './index' 引入,循环依赖为 ESM
// 活绑定,双方均只在函数体内互调,无顶层求值,安全。
import type { ActionLogEntry, ClientMessage, GameState } from '../types';
import type { VirtualClock } from './clock';
import { whenIdle } from './run-tracker';
import { dispatch } from './index';
import type { GameConfig } from './index';

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
    // 到期超时 resolve 的父 execute 可能还在跨真实异步边界(动态 import)恢复:
    // 等到稳定点再 dispatch,避免命令在父流程创建下一个 slot 前被 validate 拒绝。
    await whenIdle(state);
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
    // 等稳定点:挂起的 execute resume 链推进到下一个 slot 或完成。
    await whenIdle(state);
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
