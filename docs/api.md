# 三国杀 API 文档

后端基于 Hono（REST）和 WebSocket。前端通过 `pnpm dev`（端口 3930）连接。

## REST 端点

### 列出房间

```
GET /api/rooms
```

**响应 200**

```json
[
  { "id": "ABC123", "name": "新手房", "playerCount": 2, "maxPlayers": 4, "status": "等待中" }
]
```

### 查询房间

```
GET /api/rooms/:id
```

**响应 200** — 同上单个对象。
**响应 404** — `{ "error": "房间不存在" }`

### 创建房间（HTTP 入口）

```
POST /api/rooms
Content-Type: application/json

{ "name": "我的房间", "maxPlayers": 4 }
```

`maxPlayers` 须在 2-8 之间。

**响应 200** — `{ "roomId": "ABC123" }`
**响应 400** — `{ "error": "最大玩家数须在2-8之间" }`

> 注：实际游戏流程走 WebSocket 的 `create_room` 消息；此 HTTP 入口仅做房间 ID 预生成。

### 加入房间（HTTP 入口）

```
POST /api/rooms/:id/join
```

**响应 200** — `{ "roomId": "ABC123" }`
**响应 404** — `{ "error": "房间不存在" }`
**响应 400** — `{ "error": "调试房间请使用调试入口" | "房间已满" | "游戏已开始" }`

### 创建调试房间

```
POST /api/debug-room
Content-Type: application/json

{ "playerCount": 5 }
```

`playerCount` 须在 2-8 之间。立即开启会话（无需玩家准备）。

**响应 200** — `{ "roomId": "ABC123" }`

### 删除调试房间

```
DELETE /api/rooms/:id
```

**响应 200** — `{ "success": true }`
**响应 403** — `{ "error": "只能删除调试房间" }`

## WebSocket 协议

连接 URL：`ws://<host>:3930/ws`

服务器连接成功后为每个连接分配 `playerId`（32 字节十六进制随机串）。客户端需在 `reconnect` 消息中传入之前收到的 `playerId` 以恢复会话。

### 客户端 → 服务器（ClientMessage）

```typescript
type EventSeq = number;  // 服务端 GameSession 维护的全局递增序号

type ClientMessage =
  | { type: 'action'; action: GameAction; baseSeq: EventSeq }
  | { type: 'response'; baseSeq: EventSeq; choice: unknown }
  | { type: 'ready' }
  | { type: 'join_room'; roomId: string }
  | { type: 'create_room'; name: string; maxPlayers: number }
  | { type: 'create_debug_room'; playerCount: number }
  | { type: 'join_debug_room'; roomId: string; lastSeq?: EventSeq }
  | { type: 'delete_room' }
  | { type: 'start_game' }
  | { type: 'leave_room' }
  | { type: 'list_rooms'; filter?: 'debug' | 'multiplayer' }
  | { type: 'reconnect'; playerId: string; lastSeq?: EventSeq };
```

**baseSeq 语义**: 客户端发出该操作时，其本地状态对应的最新事件序号。服务端做 CAS 校验：`baseSeq !== 服务端当前 nextSeq` 时静默丢弃（不发 error）。客户端会通过后续 `events` 推送自动看到最新状态。

旧版 `response` 消息带 `promptId` 做版本关联，新版用 `baseSeq` 取代——`baseSeq` 隐含了"全局状态是否推进过"，比 promptId 语义更强（详见 ADR 0009）。

### 服务器 → 客户端（ServerMessage）

```typescript
type SequencedEvent = ServerEvent & { seq: EventSeq };

type ServerMessage =
  | { type: 'initialView'; state: FrontendState; lastSeq: EventSeq }
  | { type: 'debugGameState'; state: GameState; lastSeq: EventSeq }
  | { type: 'events'; fromSeq: EventSeq; events: SequencedEvent[] }
  | { type: 'error'; message: string }
  | { type: 'gameOver'; winner: string }
  | { type: 'room_joined'; roomId: string; playerId: string }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
  | { type: 'player_disconnected'; playerId: string; graceMs: number }
  | { type: 'player_reconnected'; playerId: string }
  | { type: 'game_started' }
  | { type: 'room_list'; rooms: RoomInfo[] };
```

### 流程

1. 客户端 `create_room` 或 `join_room` → 服务器返回 `room_joined`（含 `playerId`）
2. 房主 `ready`，所有人 ready 后 `start_game` → 服务器广播 `game_started` 并发送 `initialView`
3. 轮到自己回合时，服务器通过 `events` 推送事件（部分 `events` 携带 `pending` 字段）
4. 客户端读取 `pending`，用 `response` + `baseSeq` + `choice` 提交选择
5. 任何时候可用 `action` + `baseSeq` 提交玩家操作（如 `playCard`/`endTurn`/`discard`）

**baseSeq 来源**: 客户端从最近一次 `events` / `initialView` / `debugGameState` 消息中拿到 `lastSeq`/`fromSeq` 作为本地 `lastAppliedSeq`，发操作时填入 `baseSeq`。

### 重连

- 客户端断线后 30s 内可用 `reconnect` 携带原 `playerId` 重新加入
- 超时则游戏结束

### 调试模式(Debug Room)

**定义**: debug 房间相当于在一个页面同时创建了多个客户端实例。进来的用户可以自由切换到任一实例（玩家视角）进行操作，不需要身份认证。切换到某一客户端实例后，看到的视图与真实房间完全一致（身份按规则隐藏：自己/主公/死亡可见，其他隐藏）。

**核心行为**:
- 单个 WS 连接控制所有 N 个角色
- 用户可随时切换视角(perspectiveIdx),切换后看到的就是该角色的真实视图
- 身份可见性与真实游戏一致:只能看到自己、主公、死亡玩家的身份
- 自动视角切换:有玩家被问询(pending)时自动切换到该玩家视角,方便操作。可通过 UI 开关关闭(用于多 agent 协作测试)
- `create_debug_room` 创建 N 人调试房间
- `delete_room` 手动删除(HTTP 端点 `DELETE /api/rooms/:id` 等价)

**多人协作**: 多个 agent 可各自 WS 连接进入同一 debug 房间,默认看到各自座次视角。每个连接分配递增座次(player[0], player[1], ...)。各 agent 只看自己视角,不偷看他人,模拟真实游戏。

## 类型来源

`src/src/shared/types.ts`、`src/src/engine/types.ts`、`src/src/engine/view/types.ts`、`src/src/server/protocol.ts` 均为单一类型来源（TS 编译期校验）。
