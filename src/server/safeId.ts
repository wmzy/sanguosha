// src/server/safeId.ts — 落盘 id 白名单单一来源。
//
// 服务端生成的房间码为字母数字(generateRoomId: A-Z0-9);白名单额外放行
// 连字符/下划线以兼容历史数据与测试。eventJournal / gameHistory /
// persistence 等落盘模块共用本校验(roomId 与历史 entryId 等文件名 key),
// 拒绝路径穿越/特殊字符。

/** 安全 id 白名单正则(字母数字/连字符/下划线)。 */
export const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** 兼容既有导入面:roomId 白名单 = SAFE_ID。 */
export const SAFE_ROOM_ID = SAFE_ID;

/** id 是否通过白名单(防路径穿越)。 */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

/** roomId 是否通过白名单(= isSafeId,保留既有导出名)。 */
export function isSafeRoomId(roomId: string): boolean {
  return isSafeId(roomId);
}
