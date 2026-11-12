// server/rest.ts — REST API 路由组合入口。
// 各域路由实现自本文件拆出至 routes/(room/game/spectator/seat/history),
// 路由路径/方法/校验顺序/响应形状与拆分前完全一致;此处只做组合注册,
// 与原先直接 app.get/post 行为完全一致(主 app 上的 cors/requestLogger/
// rateLimit/errorHandler 中间件照常生效)。

import type { Hono } from 'hono';
import { applyRoomRoutes } from './routes/room-routes';
import { applyGameRoutes } from './routes/game-routes';
import { applySpectatorRoutes } from './routes/spectator-routes';
import { applySeatRoutes } from './routes/seat-routes';
import { applyHistoryRoutes } from './routes/history-routes';

/** 将所有 REST 路由注册到指定 app 实例。 */
export function applyRestRoutes(app: Hono): void {
  applyRoomRoutes(app);
  applyGameRoutes(app);
  applySpectatorRoutes(app);
  applySeatRoutes(app);
  applyHistoryRoutes(app);
}
