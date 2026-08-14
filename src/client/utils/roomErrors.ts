// src/client/utils/roomErrors.ts — 房间级错误判定(debug/正式模式共用)。
//
// HeadlessGameClient 的 REST 失败会 throw Error(带 status 属性,服务端 body.error
// 作为 message)。房间被服务端回收/删除后 join 返回 404,body.error 文案为
// 「房间不存在」。判定同时认两类信号,供 useMultiplayerRoom / useDebugMultiConnection
// 共用,避免 debug 与正式模式各自维护一份 404 判定。

/** 判定错误是否为「房间不存在/已关闭」(404 或文案命中)。 */
export function isRoomNotFound(err: unknown): boolean {
  if ((err as { status?: number } | null | undefined)?.status === 404) return true;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message.includes('房间不存在');
}
