# 三国杀 API 文档

后端基于 Hono：REST（C→S 命令）+ SSE（S→C 事件流）+ WebSocket（兼容 fallback）。前端通过 `pnpm dev`（端口 3930）连接。

## 传输架构

| 方向 | 协议 | 用途 |
|------|------|------|
| C→S | REST POST | 房间操作 + 游戏命令（fire-and-forget） |
| S→C | SSE | 事件流推送（自动重连 + Last-Event-ID 断点续传） |
| C→S ↔ S→C | WebSocket | 兼容 fallback（旧客户端） |

客户端主要走 REST + SSE：`fetch(POST)` 发命令，`EventSource` 接收推送。

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

**响应 200** — `{ "roomId": "ABC123", "playerId": "pid-xxx" }`
**响应 400** — `{ "error": "最大玩家数须在2-8之间" }`

可选 `playerId` 参数：给定则采用该 playerId，否则服务端自动生成。

> REST 入口直接创建房间并分配 playerId，客户端随后建立 SSE 连接接收推送。

### 加入房间（HTTP 入口）

```
POST /api/rooms/:id/join
```

**响应 200** — `{ "roomId": "ABC123", "playerId": "pid-xxx" }`

### 创建调试房间

```
POST /api/debug-room
Content-Type: application/json

{ "playerCount": 5, "config": { ... } }
```

`playerCount` 须在 2-8 之间。`config` 可选(见 `RoomConfig`)。`autoJoin` 可选（默认 false）：true 时创建者自动加入第一个座次并返回 `playerId`/`seatIndex`。

**响应 200** — `{ "roomId": "ABC123", "playerId": "pid-xxx", "seatIndex": 0 }`（autoJoin=true）或 `{ "roomId": "ABC123" }`（autoJoin=false）

#### RoomConfig

```typescript
interface RoomConfig {
  name: string;        // 房间名
  timeoutScale: number; // 操作倒计时倍率(1=默认,0.6=快,1.8=慢,Infinity=无限)
  charPool: 'standard' | 'extended' | 'all'; // 将池预设
  handSize: number;    // 每人初始手牌数(默认 4)
}
```

### 删除调试房间

```
DELETE /api/rooms/:id
```

**响应 200** — `{ "success": true }`
**响应 403** — `{ "error": "只能删除调试房间" }`

### 加入调试房间

```
POST /api/debug-room/:id/join
Content-Type: application/json

{ "playerId": "pid-xxx", "lastSeq": 0 }
```

**响应 200** — `{ "roomId": "ABC123", "playerId": "pid-xxx", "seatIndex": 0 }`

### SSE 事件流

```
GET /api/rooms/:id/stream?playerId=pid-xxx
```

建立 SSE 连接接收服务端推送。浏览器 `EventSource` 自动处理重连和 `Last-Event-ID` 断点续传。

连接后服务端立即推送 `room_joined` + `room_state`（配置阶段）或 `initialView`（重连到进行中的游戏）。

### 游戏操作端点

以下端点均为 fire-and-forget POST（服务端处理后通过 SSE 推送结果）：

```
POST /api/rooms/:id/ready     { "playerId": "pid-xxx" }
POST /api/rooms/:id/start     { "playerId": "pid-xxx" }
POST /api/rooms/:id/restart   { "playerId": "pid-xxx" }
POST /api/rooms/:id/action    { "playerId": "pid-xxx", "action": GameAction }
POST /api/rooms/:id/reorder   { "playerId": "pid-xxx", "order": ["card1", "card2"] }
POST /api/rooms/:id/leave     { "playerId": "pid-xxx" }
PUT  /api/rooms/:id/config    { "playerId": "pid-xxx", "config": RoomConfig }
```

所有端点返回 `{ "success": true }` 或错误 JSON。

## WebSocket 协议（兼容 fallback）

> 新客户端建议使用 REST + SSE。WS 端点保留用于兼容旧客户端和渐进迁移。

连接 URL：`ws://<host>:3930/ws`

服务器连接成功后为每个连接分配 `playerId`（32 字节十六进制随机串）。客户端需在 `reconnect` 消息中传入之前收到的 `playerId` 以恢复会话。

### 客户端 → 服务器（ClientMessage）

```typescript
type EventSeq = number;  // 服务端 GameSession 维护的全局递增序号

type ClientMessage =
  | { type: 'action'; action: GameAction; baseSeq: EventSeq }
  | { type: 'reorder_hand'; order: string[] }
  | { type: 'ready' }
  | { type: 'join_room'; roomId: string }
  | { type: 'create_room'; name: string; maxPlayers: number; config?: RoomConfig }
  | { type: 'create_debug_room'; config?: RoomConfig; playerCount?: number }
  | { type: 'join_debug_room'; roomId: string; lastSeq?: EventSeq }
  | { type: 'start_game' }
  | { type: 'update_room_config'; config: RoomConfig }
  | { type: 'leave_room' }
  | { type: 'reconnect'; playerId: string; lastSeq?: EventSeq };
```

**baseSeq 语义**: 客户端发出该操作时，其本地状态对应的最新事件序号。服务端做 CAS 校验：`baseSeq !== 服务端当前 nextSeq` 时静默丢弃（不发 error）。客户端会通过后续 `events` 推送自动看到最新状态。

旧版 `response` 消息带 `promptId` 做版本关联，新版用 `baseSeq` 取代——`baseSeq` 隐含了"全局状态是否推进过"，比 promptId 语义更强（详见 ADR 0009）。

### 服务器 → 客户端（ServerMessage）

```typescript
type ServerMessage =
  | { type: 'initialView'; state: GameView; lastSeq: EventSeq }
  | { type: 'event'; seq: EventSeq; timestamp: number; view?: ViewEvent; notify?: ...; deadline?: DeadlineInfo | null }
  | { type: 'error'; message: string }
  | { type: 'actionRejected' }
  | { type: 'gameOver'; winner: string }
  | { type: 'room_joined'; roomId: string; playerId: string; seatIndex?: number }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
  | { type: 'player_disconnected'; playerId: string; graceMs: number }
  | { type: 'player_reconnected'; playerId: string }
  | { type: 'game_started' }
  | { type: 'room_config'; config: RoomConfig }
  | { type: 'room_state'; readyPlayers: string[]; playerIds: string[]; hostId: string | null; maxPlayers: number; config: RoomConfig }
  | { type: 'player_ready'; playerId: string };
```

### 流程

1. 客户端 `create_room`/`create_debug_room` 或 `join_room`/`join_debug_room` → 服务器返回 `room_joined`（含 `playerId`、`seatIndex`）
2. 房主(调试房间任意玩家)用 `update_room_config` 修改配置;广播 `room_config` + `room_state`
3. 玩家 `ready` → 广播 `player_ready` + `room_state`;所有人 ready 后 `start_game` → 广播 `game_started` 并发送 `initialView`
4. 轮到自己回合时,服务器通过 `event` 推送事件(部分 `event` 携带 `pending` 字段)
5. 客户端读取 `pending`,用 `action` + `baseSeq` + `pendingSeq` 提交回应
6. 任何时候可用 `action` + `baseSeq` 提交玩家操作

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
