// src/client/view/reducer.ts
// 前端视图 reducer(ENGINE-DESIGN §8.2.3)。
//
// 收到 ViewEvent 后,按 event.atomType ?? event.type 查找 AtomDefinition,
// 调用其 applyView 增量更新 GameView。effect 的播放由 useEventPlayback 处理,
// 不在此处(本 reducer 只负责 view 状态更新,纯数据变换)。
//
// applyNotify 处理 notify 类事件(envelope.notify),当前用于 pendingResolved:
// 服务端 pendingSlots 的删除是静默 mutation,事件流模式下前端无 buildView 重查,
// 故服务端在 slot resolve 时补发 pendingResolved notify,前端据此清除 view.pending。
//
// 与后端 apply 对称:apply 改 GameState,applyView 改 GameView。

// 引入 atoms 触发注册(前端构建 tree-shake 后端 validate/apply,保留 applyView)
import '../engine-imports';
import { getAtomDef } from '../../engine/atom';
import type { GameView, ViewEvent, Json } from '../../engine/types';

/** GameEventEnvelope 的 notify 部分(per-viewer 分叉后) */
export interface NotifyPayload {
  skillId: string;
  eventType: string;
  data: Json;
}

/**
 * 按 ViewEvent 增量更新 GameView。
 *
 * - 查找 AtomDefinition:优先 event.atomType(转换语义),fallback event.type
 * - 调用 applyView(view, event) 增量更新
 * - 未实现 applyView 的 atom:view 不变(调用方可选择 fallback 全量 buildView)
 *
 * 注意:本函数原地突变 view(与后端 apply 原地突变 state 对称),不返回新对象。
 */
export function viewReducer(view: GameView, event: ViewEvent): void {
  const type = event.atomType ?? event.type;
  const def = getAtomDef(type);
  def.applyView?.(view, event);
}

/**
 * 按 notify 事件增量更新 GameView。
 *
 * - pendingResolved:清除 view.pending。data.target<0(广播型)无条件清除;
 *   否则仅当当前 view.pending 的 target 匹配时清除(防止误清新 pending)。
 */
export function applyNotify(view: GameView, notify: NotifyPayload): void {
  if (notify.eventType === 'pendingResolved') {
    const data = notify.data as { target?: number; atomType?: string };
    const target = data.target;
    if (target === undefined) return;
    // 广播型 slot(target<0,如无懈可击):所有 viewer 都清除
    if (target < 0) {
      view.pending = null;
      return;
    }
    // 单 target slot:仅当当前 pending 指向同一 target 时清除,
    // 避免清除后续已建立的新 pending(respond 后立即新建的询问)
    if (view.pending && view.pending.target === target) {
      view.pending = null;
    }
  }
}
