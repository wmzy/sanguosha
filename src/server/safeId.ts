// src/server/safeId.ts — roomId 白名单单一来源。
//
// 服务端生成的房间码为字母数字(generateRoomId: A-Z0-9);白名单额外放行
// 连字符/下划线以兼容历史数据与测试。eventJournal / gameHistory /
// persistence 三个落盘模块共用本校验,拒绝路径穿越/特殊字符。

/** roomId 白名单正则。 */
export const SAFE_ROOM_ID = /^[A-Za-z0-9_-]+$/;

/** roomId 是否通过白名单(防路径穿越)。 */
export function isSafeRoomId(roomId: string): boolean {
  return SAFE_ROOM_ID.test(roomId);
}
