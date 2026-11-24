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

/** 房间元信息查询(room.ts 在模块初始化时注入)。绑定守卫需要区分调试房/真实房。
 *  保持本模块零业务依赖(不 import room.ts,避免 room↔playerIndex 模块环)。 */
export interface RoomMeta {
  isDebug?: boolean;
}

let roomMetaResolver: ((roomId: string) => RoomMeta | undefined) | null = null;

export function setRoomMetaResolver(resolver: (roomId: string) => RoomMeta | undefined): void {
  roomMetaResolver = resolver;
}

/** 记录玩家当前所在房间(加入/入座/转身份成功时由成员函数调用)。
 *  role 省略时(sse.ts 重挂连接不区分身份)沿用同房既有身份,
 *  避免旁观者的 SSE 重连把映射身份误记为玩家。
 *
 *  守卫:真实房间(非调试)成员的映射不得被调试房覆盖。调试房是未登录游客模型
 *  (任意 playerId 可加入),不设此界时任何人可把他人映射改指向自己的调试房,
 *  进而借 detachFromOtherRooms 把他人踢出真实房间。 */
export function bindPlayerRoom(
  playerId: string,
  roomId: string,
  role?: 'player' | 'spectator',
): void {
  const previous = playerRoomMap.get(playerId);
  if (previous && previous.roomId !== roomId) {
    const prevMeta = roomMetaResolver?.(previous.roomId);
    const nextMeta = roomMetaResolver?.(roomId);
    if (prevMeta && prevMeta.isDebug !== true && nextMeta?.isDebug === true) return;
  }
  const resolved = role ?? (previous?.roomId === roomId ? previous.role : 'player');
  playerRoomMap.set(playerId, { roomId, role: resolved });
}

/** 清除玩家的房间映射(离开/被踢/断线清理时由成员函数调用)。
 *  roomId 可选:传入时仅当映射仍指向该房间才删除——过期连接的清理不得误删
 *  该玩家在新房间的映射(调试房多人连接复用 playerId 的场景可稳定触发)。 */
export function unbindPlayerRoom(playerId: string, roomId?: string): void {
  if (roomId !== undefined) {
    const current = playerRoomMap.get(playerId);
    if (current && current.roomId !== roomId) return;
  }
  playerRoomMap.delete(playerId);
}
