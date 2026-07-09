// server/registry.ts — 进程级共享状态(会话表 + 玩家→房间映射)。
// 从 app.ts 抽离:REST 路由与 WS 处理均依赖这两个单例,集中到此避免互相传参。
// lifecycle 注册(测试间清理)与 sessionChecker 也在此初始化。

import type { GameSession } from './session';
import { setSessionChecker } from './room';
import { register as registerLifecycle } from './lifecycles';

// 游戏会话管理(进程级单例,按 roomId 索引)
export const gameSessions = new Map<string, GameSession>();

// 玩家到房间的映射(进程级单例)
export const playerRoomMap = new Map<string, string>();

registerLifecycle('gameSessions', gameSessions, () => {
  gameSessions.clear();
});
registerLifecycle('playerRoomMap', playerRoomMap, () => {
  playerRoomMap.clear();
});

// 注册 session 检查器:getRoomList 用它过滤掉没有活跃 session 的房间。
// 原置于 app.ts 末尾,提前到 registry 初始化同样安全(请求到来前必然完成)。
setSessionChecker((roomId) => gameSessions.has(roomId));
