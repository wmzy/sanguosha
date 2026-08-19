// src/client/utils/memberNames.ts — 房间成员显示名工具。
// playerId(稳定 userId) → 展示名(room_state.playerNames 投影;缺省回退截断 id)。
import type { RoomState } from '../headless/types';

/** 取成员显示名:优先 playerNames 映射,回退 id 前 6 位(userId 形如 usr_xxx 时仍可辨识)。 */
export function memberName(
  id: string | null | undefined,
  names: Record<string, string> | undefined,
): string {
  if (!id) return '未知';
  return names?.[id] ?? id.slice(0, 6);
}

/** 从 roomState 取显示名映射。 */
export function memberNames(rs: RoomState | null): Record<string, string> | undefined {
  return rs?.playerNames;
}
