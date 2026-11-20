// server/registry.ts — 进程级共享状态(会话表 + 玩家→房间映射)。
// 从 app.ts 抽离:REST 路由与 WS 处理均依赖这两个单例,集中到此避免互相传参。
// lifecycle 注册(测试间清理)与 sessionChecker 也在此初始化。

import type { GameSession } from './session';
import { setSessionChecker } from './room';
import { register as registerLifecycle } from './resourceRegistry';

// 游戏会话管理(进程级单例,按 roomId 索引)
export const gameSessions = new Map<string, GameSession>();

// playerRoomMap(玩家→房间映射)本体已下沉零依赖叶子模块 playerIndex.ts——此前映射
// 本体在此,room.ts 为维护映射 import 本模块、本模块顶层又调用 room.ts 的
// setSessionChecker,两模块成环(room.ts 只得用函数对象属性绕 TDZ)。下沉后环消除,
// 消费方(teardown/tests)直接从 playerIndex 导入。

registerLifecycle('gameSessions', gameSessions, () => {
  gameSessions.clear();
});

// 注册 session 检查器:getRoomList 用它过滤掉没有活跃 session 的房间。
// 原置于 app.ts 末尾,提前到 registry 初始化同样安全(请求到来前必然完成)。
setSessionChecker((roomId) => gameSessions.has(roomId));
