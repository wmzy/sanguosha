// core/notify.ts — 通知/状态变更/日志 helper。
// 被 apply.ts(applyAtom 管线)和 core/index.ts(dispatch)共用。
import type { Atom, ClientMessage, GameState, NotifyEvent, PendingSlot } from '../types';
import { TARGET_SYSTEM } from '../types';

/**
 * system 命名空间占位座次。引擎只认座次下标,玩家真实 ID 由 session 层映射。
 * TARGET_SYSTEM(-1) = 系统(开局 action),不对应任何真实玩家槽位。
 */
export const SYSTEM_OWNER = TARGET_SYSTEM;

/** 从 pending atom 中提取等待目标玩家(座次下标)。所有内置等待型 atom 都有 target 字段。
 *  返回 TARGET_SYSTEM(-1)表示系统(开局 action),不对应任何真实玩家槽位。
 *  注意:TARGET_SYSTEM 与广播型 target(TARGET_BROADCAST=-2)不同,
 *  广播型 slot 本身已携带 target=TARGET_BROADCAST,能被此函数准确提取。
 *  出牌窗口 atom 用 player 字段而非 target,此处兼容。 */
export function extractPendingTarget(atom: Atom): number {
  if ('target' in atom && typeof atom.target === 'number') return atom.target;
  if ('player' in atom && typeof atom.player === 'number') return atom.player;
  return SYSTEM_OWNER;
}

/** 通知 session:state 已变更(每次 applyAtom 结束后触发)。 */
export function notifyStateChange(state: GameState): void {
  if (state.viewBuffering) return; // preceding 缓冲期:吞掉广播,由 dispatch 统一 flush
  state.onStateChange?.();
}

/** 通知前端:某 pending slot 已 resolve(respond 完成 / 超时),前端应清除 view.pending。
 *  事件流模式下 view.pending 不再由 buildView 每次重建,而由 applyView 增量维护,
 *  因此 slot 的删除(服务端静默 mutation)必须显式发事件,否则前端 pending 永驻。
 *  target<0 = 广播型 slot(如无懈可击),所有 viewer 都应清除。 */
export function notifyPendingResolved(state: GameState, slot: PendingSlot): void {
  const target = extractPendingTarget(slot.atom);
  state.seq += 1;
  state.atomHistory.push({
    kind: 'notify',
    seq: state.seq,
    timestamp: state.clock.now() - state.startedAt,
    skillId: '',
    eventType: 'pendingResolved',
    data: { target, atomType: slot.atom.type },
  });
  notifyStateChange(state);
}

/** 推送 notify 事件(不改变 state) */
export function pushNotify(state: GameState, event: NotifyEvent): void {
  state.seq += 1;
  state.atomHistory.push({
    kind: 'notify',
    seq: state.seq,
    timestamp: state.clock.now() - state.startedAt,
    ...event,
  });
}

/** 记录 actionLog 条目 */
export function logAction(state: GameState, message: ClientMessage): void {
  state.actionLog.push({
    id: String(state.actionLog.length),
    timestamp: state.clock.now() - state.startedAt,
    message,
    baseSeq: message.baseSeq ?? -1,
  });
}
