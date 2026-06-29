// 从 state.atomHistory 派生某 viewer 可见的事件序列(供 session 广播/重连差量)。
//
// 投影规则(§8.2.2):
// - atom.viewEvents.ownerViews.get(viewer) 非 null → 用 ownerView(专属)
// - ownerViews.get(viewer) === null → 跳过(隐藏)
// - ownerViews 无此 viewer 且 othersView 非 null → 用 othersView(通用)
// - notify 事件按 views 字典分叉;无 views 则全量可见
import type { GameState, GameEventEnvelope } from '../types';

export function eventsForViewer(
  state: GameState,
  viewer: number,
  sinceSeq = 0,
): GameEventEnvelope[] {
  const out: GameEventEnvelope[] = [];
  for (const e of state.atomHistory) {
    if (e.seq <= sinceSeq) continue;
    if (e.kind === 'atom') {
      const owner = e.viewEvents.ownerViews.get(viewer);
      if (owner === null) continue;
      const viewEvent = owner ?? e.viewEvents.othersView;
      if (!viewEvent) continue;
      out.push({ seq: e.seq, timestamp: e.timestamp, view: viewEvent });
    } else {
      // kind === 'notify'
      const data = e.views ? (e.views.get(String(viewer)) ?? null) : e.data;
      if (data !== null) {
        out.push({
          seq: e.seq,
          timestamp: e.timestamp,
          notify: { skillId: e.skillId, eventType: e.eventType, data },
        });
      }
    }
  }
  return out;
}
