# 三国杀 API 文档

后端基于 Hono：REST（C→S 命令）+ SSE（S→C 事件流）。前端通过 `pnpm dev`（端口 3930）连接。当前服务不提供 `/ws` 升级路由；无头客户端只为旧配置保留 URL 转换，不代表存在 WebSocket fallback。

## 传输架构

| 方向 | 协议 | 用途 |
|------|------|------|
| C→S | REST POST | 房间操作 + 游戏命令（fire-and-forget） |
| S→C | SSE | 事件流推送（自动重连 + Last-Event-ID 断点续传） |

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

### 游戏日志

```
GET /api/rooms/:id/log
```

普通房间需要登录且仅房间成员可访问。返回的是按查看者脱敏后的公开战报，**不是**内部重放日志；隐藏手牌顺序、盲选候选牌、preceding 原始参数等私有信息不会通过该接口返回。完整重放数据由服务端内部恢复链路使用。

### 认证

普通房间的创建、加入、准备、开始、重置、出牌、重排、聊天和配置操作均需要登录。REST 请求使用 `Authorization: Bearer <token>`；浏览器同源请求使用会话 Cookie。SSE 客户端不能设置自定义请求头时，可使用短期会话 token 的 `sgs_token` 查询参数。


### 创建房间（HTTP 入口）

```
POST /api/rooms
Content-Type: application/json

{ "name": "我的房间", "maxPlayers": 4 }
```

`maxPlayers` 须在 2-8 之间。

**响应 200** — `{ "roomId": "ABC123", "playerId": "pid-xxx" }`
**响应 400** — `{ "error": "最大玩家数须在2-8之间" }`

普通房间的 `playerId` 固定取已登录会话的 `user.id`，请求体不能指定或冒用其他身份。

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
  timeoutSec: number; // 操作倒计时秒数(绝对值,0=无限,默认30)
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
POST /api/rooms/:id/ready        { "playerId": "pid-xxx" }
POST /api/rooms/:id/cancel-ready { "playerId": "pid-xxx" }
POST /api/rooms/:id/start     { "playerId": "pid-xxx" }
POST /api/rooms/:id/restart   { "playerId": "pid-xxx" }
POST /api/rooms/:id/action    { "playerId": "pid-xxx", "action": GameAction }
POST /api/rooms/:id/reorder   { "playerId": "pid-xxx", "order": ["card1", "card2"] }
POST /api/rooms/:id/leave     { "playerId": "pid-xxx" }
POST /api/rooms/:id/kick      { "playerId": "pid-xxx(房主)", "targetPlayerId": "pid-yyy" }
PUT  /api/rooms/:id/config    { "playerId": "pid-xxx", "config": RoomConfig }
```

所有端点成功时返回 `{ "success": true }` 或端点专属 JSON；校验、鉴权或状态冲突时返回错误 JSON 和对应 HTTP 状态码。无效手牌重排（重复、缺失、未知牌或错误类型）返回 400，且不会改变权威手牌顺序。

### 踢出玩家

```
POST /api/rooms/:id/kick
Content-Type: application/json

{ "playerId": "房主 playerId", "targetPlayerId": "被踢 playerId" }
```

仅房主可调用，且仅在房间「等待中」状态可用。`targetPlayerId` 可以是占座玩家或旁观者；不能踢自己。

- 被踢成员先收到 `player_kicked` SSE 事件（客户端据此提示「你已被房主移出房间」并返回大厅，而非触发自动重连），随后其连接被关闭。
- 其余成员收到 `player_left` 事件及更新后的 `room_state`。
- 踢出后不转移房主、不销毁房间（房主仍在）。

**响应 200** — `{ "success": true }`
**响应 400** — `{ "error": "无法踢出该玩家（仅房主可操作，或目标不在房间中）" }`（非房主 / 目标不存在 / 踢自己 / 游戏进行中 / 调试房间）

## 游戏动作与事件

动作通过 `POST /api/rooms/:id/action` 提交，结构来源为 `src/engine/types/skill.ts` 的 `ClientMessage`：

```typescript
{
  skillId: string;
  actionType: string;
  ownerId: number;
  params: Record<string, Json>;
  baseSeq: number;
  pendingSeq?: number;
  preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>;
}
```

`baseSeq` 表示客户端已处理的最新事件版本；`pendingSeq` 用于回应窗口的新旧校验。动作必须通过权威引擎验证，同一个窗口只允许一个执行者占有回应权。被拒动作通过 SSE `actionRejected` 通知；HTTP 4xx/5xx 则由客户端错误通道报告，不能等待一个不会到达的 SSE。

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
  | { type: 'player_kicked'; playerId: string; hostId: string }
  | { type: 'player_disconnected'; playerId: string; seatIndex: number; graceMs: number }
  | { type: 'player_reconnected'; playerId: string; seatIndex: number }
  | { type: 'game_started' }
  | { type: 'room_config'; config: RoomConfig }
  | { type: 'room_state'; readyPlayers: string[]; playerIds: string[]; hostId: string | null; maxPlayers: number; config: RoomConfig }
  | { type: 'player_ready'; playerId: string };
```

### 流程

1. 客户端通过 REST 创建或加入房间，随后建立 SSE，接收 `room_joined` 和配置/视图。
2. 房主通过 `PUT config` 修改配置；玩家通过 `POST ready` 准备，房主通过 `POST start` 开局。
3. 服务端发送 `initialView` 基线，随后通过 `event` 推送该查看者可见的增量事件。
4. 客户端用 `POST action` 提交动作，携带 `baseSeq`；回应阻塞窗口时同时携带 `pendingSeq`。

**baseSeq 来源**：客户端维护最近一次 `initialView.lastSeq` 或 `event.seq`。

### 重连

SSE 使用 `Last-Event-ID`（`epoch:seq`）请求断点续传。同一局且历史仍在缓存窗口内时补发增量；跨局或缺口过大时返回新的 `initialView`。普通房间重连仍需有效登录会话，`playerId` 不能替代凭据。

### 调试模式(Debug Room)

**定义**: debug 房间相当于在一个页面同时创建了多个客户端实例。进来的用户可以自由切换到任一实例（玩家视角）进行操作，不需要身份认证。切换到某一客户端实例后，看到的视图与真实房间完全一致（身份按规则隐藏：自己/主公/死亡可见，其他隐藏）。

**核心行为**:
- 每个座次对应一个 HGC 实例；浏览器仅当前视角保持活跃 SSE，其他座次通过 REST 驱动
- 用户可随时切换视角(perspectiveIdx),切换后看到的就是该角色的真实视图
- 身份可见性与真实游戏一致:只能看到自己、主公、死亡玩家的身份
- 自动视角切换:有玩家被问询(pending)时自动切换到该玩家视角,方便操作。可通过 UI 开关关闭(用于多 agent 协作测试)
- `POST /api/debug-room` 创建 N 人调试房间
- `DELETE /api/rooms/:id` 手动删除

**多人协作**：多个 agent 可各自通过 REST 加入同一 debug 房间并建立 SSE，每个连接分配座次；各 agent 只看自己视角。

## 类型来源

`src/engine/types/skill.ts`（动作）、`src/engine/types/view.ts`（视图）、`src/server/protocol.ts`（SSE 消息和房间配置）为类型来源。
