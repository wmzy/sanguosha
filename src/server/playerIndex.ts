// server/playerIndex.ts — 玩家→房间映射(进程级单例)及其写入口,零业务依赖的叶子模块。
// 从 registry.ts 抽出:此前映射本体在 registry,room.ts 为维护映射 import registry,
// 而 registry 顶层又调用 room.ts 的 setSessionChecker,两模块成环,room.ts 只得把
// 检查器挂在函数对象属性上绕模块求值 TDZ。映射本体+写入口下沉到本模块后环消除,
// room.ts 恢复普通模块级 let。registry.ts re-export playerRoomMap、room.ts
// re-export 写入口,既有导入路径(teardown.ts/sse.ts/routes/tests)零改动。
// 查询(findRoomByPlayerId 需 roomList 做成员校验)仍留在 room.ts。
import { register } from './resourceRegistry';

// 全部写入收敛到这两个助手,由 room.ts 的成员变更函数(createRoom/joinRoom/
// joinDebugRoom/leaveRoom/joinAsSpectator/removeSpectator/switchRole/kickPlayer)
// 自动维护。路由/SSE 仅在绕过成员函数直改名单的场景(如 SSE registerSink 重挂
// 连接)显式调用,禁止再手工 set/delete(不变量单点维护)。

/** 玩家→房间映射:playerId → { roomId, role }。 */
export const playerRoomMap = new Map<string, { roomId: string; role: 'player' | 'spectator' }>();

register('playerRoomMap', playerRoomMap, () => {
  playerRoomMap.clear();
});

/** 记录玩家当前所在房间（加入/入座/转身份成功时由成员函数调用）。
 *  role 省略时(sse.ts 重挂连接不区分身份)沿用同房既有身份,
 *  避免旁观者的 SSE 重连把映射身份误记为玩家。 */
export function bindPlayerRoom(
  playerId: string,
  roomId: string,
  role?: 'player' | 'spectator',
): void {
  const previous = playerRoomMap.get(playerId);
  const resolved = role ?? (previous?.roomId === roomId ? previous.role : 'player');
  playerRoomMap.set(playerId, { roomId, role: resolved });
}

/** 清除玩家的房间映射（离开/被踢/断线清理时由成员函数调用）。 */
export function unbindPlayerRoom(playerId: string): void {
  playerRoomMap.delete(playerId);
}
