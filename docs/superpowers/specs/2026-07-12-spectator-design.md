# 旁观者功能设计

> 日期: 2026-07-12
> 状态: 待审阅

## 一、目标

支持旁观者加入房间观看对局。旁观者不占座次、不参与游戏，默认看公开视图（无手牌、隐藏身份）。玩家可审批授权旁观者查看自己的私有视图。房主可在等待阶段切换为旁观者/管理者身份。任何玩家用任意 playerId 进入房间，无需登录。含 MCP AI 旁观支持。

## 二、核心设计

### 2.1 数据模型 — Room 扩展

```typescript
interface Room {
  // ... 现有字段不变 ...
  /** 旁观者连接（不占 maxPlayers 名额）。spectatorId → sink */
  spectators: Map<string, ConnectionSink>;
  /** 视图授权：spectatorId → 被授权查看的玩家座次下标 */
  viewGrants: Map<string, number>;
  /** 待处理申请：spectatorId → 申请查看的座次下标 */
  pendingViewRequests: Map<string, number>;
}
```

- `createRoom` / `createDebugRoom` 初始化三个新字段为空 Map。
- `maxPlayers` 仅限制 `players`，旁观者无上限。

### 2.2 视图复用 — buildView(state, viewer=-1) 已是合法公开视图

引擎层**零改动**即可获得公开视图：`viewer = TARGET_SYSTEM(-1)` 时所有 `hand` 为 `undefined`，非主公身份 `identityHidden`。

唯一小改：让 `viewer < 0` 也获得 observer pending（知道"当前在等谁操作"），将 `else if (viewer >= 0)` 改为 `else`。

### 2.3 旁观者视图分发 — Session 扩展

`broadcastNewState()` 在遍历 `playerNames`（玩家）之后，追加遍历 `room.spectators`：

```typescript
for (const [spectatorId] of this.room.spectators) {
  const viewer = this.room.viewGrants.get(spectatorId) ?? TARGET_SYSTEM;
  // 同玩家的 baseline + event 逻辑，buildView(state, viewer)
}
```

`baselineSent` / `lastSentDeadline` 复用现有 Set/Map（以 playerId/spectatorId 为 key）。

`broadcast()` 方法（非视图消息）追加遍历 `room.spectators`，让旁观者也收到 `room_state` / `game_started` / `gameOver` 等元消息。

### 2.4 身份切换 — 房主可在等待阶段 player ↔ spectator

仅 `status === '等待中'` 时允许切换：

**player → spectator：** 从 `room.players` 移除，加入 `room.spectators`，`session.playerNames` 移除映射。释放的座次可被新玩家加入补位。`hostId` 不变（保留管理权限）。

**spectator → player：** 从 `room.spectators` 移除，加入 `room.players`（若未满）。座次在 `startGame` 时按 `players` 顺序分配。

### 2.5 授权流程 — 旁观者申请，玩家审批

```
旁观者                    服务端                    目标玩家
  │── request-view(seat) ──→│                         │
  │                         │── view_request ────────→│
  │                         │←── approve-view ────────│
  │←── view_granted(seat) ──│                         │
  │   (重新发送 initialView,│                         │
  │    viewer = 被授权座次)  │                         │
```

- 申请：`room.pendingViewRequests.set(spectatorId, targetSeat)`，广播 `view_request` 给目标座次玩家。
- 审批通过：`room.viewGrants.set(spectatorId, targetSeat)`，删除 pending，广播 `view_granted`，session 清除该 spectator 的 `baselineSent` 强制重发（新 viewer 的 initialView）。
- 撤销（玩家主动）：`room.viewGrants.delete(spectatorId)`，广播 `view_revoked`，session 清除 baseline 重发公开视图。
- 旁观者离开/断线：自动清理 viewGrants 和 pendingViewRequests。

## 三、协议变更

### 3.1 ServerMessage 新增

```typescript
| { type: 'spectator_joined'; spectatorId: string }
| { type: 'spectator_left'; spectatorId: string }
| { type: 'view_request'; spectatorId: string; targetSeat: number }
| { type: 'view_granted'; spectatorId: string; seatIndex: number }
| { type: 'view_revoked'; spectatorId: string }
| { type: 'role_changed'; playerId: string; newRole: 'player' | 'spectator' }
```

### 3.2 room_state 扩展

```typescript
| {
    type: 'room_state';
    readyPlayers: string[];
    playerIds: string[];
    hostId: string | null;
    maxPlayers: number;
    config: RoomConfig;
    spectatorIds: string[];                      // 新增
    viewGrants: Record<string, number>;          // 新增: spectatorId → seat
  }
```

### 3.3 REST API 新增

| 方法 | 路径 | body | 说明 |
|---|---|---|---|
| POST | `/api/rooms/:id/join-spectator` | `{ playerId? }` | 以旁观者身份加入 |
| POST | `/api/rooms/:id/switch-role` | `{ playerId, role }` | 等待阶段切换身份 |
| POST | `/api/rooms/:id/request-view` | `{ spectatorId, targetSeat }` | 旁观者申请查看 |
| POST | `/api/rooms/:id/approve-view` | `{ spectatorId }` | 玩家审批通过 |
| POST | `/api/rooms/:id/reject-view` | `{ spectatorId }` | 玩家拒绝申请 |
| POST | `/api/rooms/:id/revoke-view` | `{ spectatorId }` | 玩家撤销已授权 |

### 3.4 SSE 处理变更

`sseStreamHandler` 中根据 playerId 判断身份：
- `room.spectators.has(playerId)` → 注册 sink 到 `room.spectators`
- 否则 → 注册到 `room.players`（现有逻辑）
- 旁观者连接后发送 `room_joined`（无 seatIndex）+ `room_state`，游戏进行中则发送 initialView（viewer 由 viewGrants 决定）。

### 3.5 RoomInfo 扩展

```typescript
interface RoomInfo {
  // ... 现有字段 ...
  spectatorCount?: number;  // 新增
}
```

## 四、前端变更

### 4.1 useMultiplayerRoom hook

- `MultiplayerStage` 新增 `'spectating'`。
- `Command` 新增 `{ type: 'spectate'; roomId: string }`。
- 新增方法：`joinAsSpectator(roomId)`、`switchRole(role)`、`requestView(seat)`、`approveView(spectatorId)`、`rejectView(spectatorId)`、`revokeView(spectatorId)`。
- 新增状态：`viewRequests`（收到的申请列表）、`myGrantSeat`（自己被授权查看的座次，null=公开视图）。
- `RoomState` 类型扩展 `spectatorIds` / `viewGrants`。

### 4.2 HeadlessGameClient

- 新增 `joinAsSpectator(roomId, playerId?)` 方法。
- SSE 连接复用现有 `openStream`（playerId 注册后服务端自动识别身份）。

### 4.3 MultiplayerPage

- **lobby 阶段**：新增"以旁观者加入"输入框+按钮。
- **waiting 阶段**：展示旁观者列表；房主显示"切换为旁观者/玩家"按钮。
- **spectating 阶段**：用 `GameViewComponent` 渲染公开视图（或被授权视图）；显示"申请查看某玩家视角"下拉；收到 view_request 时弹出审批提示。
- **playing 阶段（玩家）**：收到 view_request 时弹出审批提示；已授权的旁观者列表+撤销按钮。

### 4.4 RoomListPanel

- 房间项显示旁观者数量。
- join 按钮旁加"旁观"按钮。

## 五、MCP AI 旁观

### 5.1 mcpServer.ts — startGame opts 扩展

```typescript
| { mode: 'multiplayer'; asSpectator?: boolean; spectatorViewSeat?: number; ... }
```

- `asSpectator: true` → 以旁观者加入房间。
- `spectatorViewSeat` → 指定查看的座次（需被授权；未授权则看公开视图）。

### 5.2 lobby.ts — 旁观加入

新增 `joinAsSpectator(hgc, roomId, playerId?)` 函数，调用 REST `join-spectator` 后建立 SSE。

### 5.3 playHandler.ts — 旁观视图

- 旁观者的 view.viewer = -1（公开）或被授权座次。
- needsAction 恒为 false（旁观者不操作）。
- 返回 roomId 供分享。

## 六、断线/清理

- 旁观者 SSE 断开 → `room.spectators.delete(id)` + 清理 viewGrants/pendingViewRequests + 广播 `spectator_left`。
- 无 grace period（旁观者不占座，重连只需重新 join-spectator）。
- 房间删除时 spectators 一并清理。

## 七、文件改动清单

### 后端（6 文件）
1. `src/server/protocol.ts` — 新增消息类型 + room_state/RoomInfo 扩展
2. `src/server/room.ts` — Room 接口扩展 + spectator CRUD + 角色切换 + 授权管理
3. `src/server/session.ts` — broadcastNewState/broadcast 遍历旁观者 + 旁观者 initialView
4. `src/server/rest.ts` — 6 个新路由
5. `src/server/sse.ts` — spectator 连接识别 + 断线清理
6. `src/engine/view/buildView.ts` — viewer<0 observer pending

### 前端（5 文件）
7. `src/client/hooks/useMultiplayerRoom.ts` — spectating stage + 6 个新方法
8. `src/client/pages/MultiplayerPage.tsx` — 旁观入口/UI/授权交互
9. `src/client/headless/HeadlessGameClient.ts` — joinAsSpectator 方法
10. `src/client/headless/types.ts` — RoomState 扩展
11. `src/client/headless/viewMaintainer.ts` — 新消息类型处理

### MCP（3 文件）
12. `src/ai-mcp/mcpServer.ts` — startGame spectator opts
13. `src/ai-mcp/playHandler.ts` — 旁观视图返回
14. `src/ai-mcp/lobby.ts` — joinAsSpectator

### 通用（2 文件）
15. `src/client/components/RoomListPanel.tsx` — 旁观者数量 + 旁观按钮
16. `tests/` — 旁观功能集成测试

## 八、测试策略

1. **Room 单元测试**：spectator join/leave、viewGrant 设置/清除、角色切换、maxPlayers 不限制旁观者。
2. **Session 集成测试**：旁观者收到公开视图（hand=undefined）、被授权后收到私有视图、broadcastNewState 遍历旁观者。
3. **REST API 测试**：6 个新路由的 happy path + error case。
4. **前端 smoke test**：旁观加入 → 公开视图渲染 → 申请授权 → 审批通过 → 视图切换。
5. **MCP 测试**：AI 旁观者加入 → 接收公开视图。
