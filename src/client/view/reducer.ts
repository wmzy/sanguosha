// src/client/view/reducer.ts
// 前端视图 reducer(ENGINE-DESIGN §8.2.3)。
//
// 收到 ViewEvent 后,按 event.atomType ?? event.type 查找 AtomDefinition,
// 调用其 applyView 增量更新 GameView。effect 的播放由 useEventPlayback 处理,
// 不在此处(本 reducer 只负责 view 状态更新,纯数据变换)。
//
// pending 的清除由 session 下发的权威 deadline(null)驱动,
// 不再需要 notify 机制(useDebugMultiConnection 直接写 view.pending)。
//
// 与后端 apply 对称:apply 改 GameState,applyView 改 GameView。

// 引入 atoms 触发注册(前端构建 tree-shake 后端 validate/apply,保留 applyView)
import '../engine-imports';
import { getAtomDef } from '../../engine/atom';
import type { GameView, ViewEvent } from '../../engine/types';

/**
 * 按 ViewEvent 增量更新 GameView。
 *
 * - 查找 AtomDefinition:优先 event.atomType(转换语义),fallback event.type
 * - 调用 applyView(view, event) 增量更新
 * - 调用 toViewLog(event) 生成日志条目并 push 到 view.log(time 来自 envelope timestamp)
 * - 未实现 applyView 的 atom:view 不变(调用方可选择 fallback 全量 buildView)
 *
 * 注意:本函数原地突变 view(与后端 apply 原地突变 state 对称),不返回新对象。
 */
export function viewReducer(view: GameView, event: ViewEvent, time = 0): void {
  const type = event.atomType ?? event.type;
  const def = getAtomDef(type);
  def.applyView?.(view, event);
  const logEntry = def.toViewLog?.(event);
  if (logEntry) {
    view.log.push({ time, player: logEntry.player, text: logEntry.text });
  }
}
