# 房间配置功能设计

日期：2026-06-26
状态：已确认

## 背景与目标

当前调试房间创建后**立即开局**（`POST /api/debug-room` → `pendingPlayerCount` → 首人加入即 `startGame`），无配置阶段。普通多人房间后端已有 `create_room`/`ready`/`start_game` 逻辑，但前端无入口。

目标：进入房间后不立即开始游戏，进入**配置+准备阶段**。房主可配置房间名、出牌/操作倒计时、将池预设、初始手牌数。所有玩家准备后可开始。调试房间因「一人控制 N 个座次」，用户需切换到每个座次视角逐个准备。

范围：
- **后端配置模型通用**（调试 + 普通房间共用），前端先只接调试房间
- 前端新建普通房间 UI **不在本次范围**（后端预留通用接口）

## 用户确认的决策

| 决策点 | 选择 |
|---|---|
| 范围 | 后端通用，前端先调试房间 |
| 等待时间含义 | 出牌/操作倒计时（应用到**全量 atom**） |
| 将池控制 | 预设方案切换 |
| debug 准备/开始 | **逐座次准备**（保持多人语义，用于测试） |

## 数据模型

### `RoomConfig`（服务端，`src/server/room.ts`）

```typescript
export interface RoomConfig {
  /** 房间名 */
  name: string;
  /** 出牌/操作倒计时倍率。1.0=默认, 0.6=偏快, 1.8=慢, Infinity=无限 */
  timeoutScale: number;
  /** 将池预设 */
  charPool: CharPoolPreset;
  /** 每人初始手牌数(默认 4) */
  handSize: number;
}

export type CharPoolPreset = 'standard' | 'extended' | 'all';
```

将池预设含义：
- `standard`：标准版经典武将子集（魏蜀吴群各取经典，约 40 人）
- `extended`：扩展（标准 + 风林火山扩展武将，约 55 人）
- `all`：全武将（`allCharacters`，60 人）

> 实现注：预设用按势力分组的导出数组组合。`standard` = 各势力前 N 个经典武将；`extended` ≈ `all`（当前数据集即扩展版）。后续若数据扩充再细化。

### `Room` 变更

```typescript
export interface Room {
  id: string;
  name: string;
  players: Map<string, WSContext>;
  maxPlayers: number;
  status: '等待中' | '进行中' | '已结束';
  hostId: string | null;
  readyPlayers: Set<string>;
  isDebug?: boolean;
  config: RoomConfig;  // ← 新增
}
```

`config` 是房间级配置，在 `startGame` 时读取并传给引擎。

### 引擎层（`GameState.config`）

```typescript
// src/engine/types.ts — GameState 增加
config?: { timeoutScale: number };

// create-engine.ts — create() 从 GameConfig 接收
export interface GameConfig {
  characters: Array<{ name: string; skills: string[] }>;
  playerCount: number;
  seed: number;
  gameId: string;
  handSize?: number;
  timeoutScale?: number;  // ← 新增
}
```

`create()` 把 `timeoutScale` 写入 `state.config`。

### 超时 helper

```typescript
// src/engine/create-engine.ts 或单独模块
export function scaledTimeout(state: GameState, baseSeconds: number): number {
  const scale = state.config?.timeoutScale ?? 1;
  if (!Number.isFinite(scale)) return Number.MAX_SAFE_INTEGER; // 无限
  return baseSeconds * scale;
}
```

各 atom 的 `pending.timeout` 改为读取 `scaledTimeout(state, BASE)`。但 atom 的 `pending` 配置是静态对象，无法访问 `state`……

**关键约束**：`AtomDefinition.pending.timeout` 是静态字段（atom 定义时确定），不能读 state。但 `createAndAwaitSlot`（`create-engine.ts`）在 apply 时才创建 slot，此处能访问 state。

**方案**：在 `createAndAwaitSlot` 中计算实际 timeout：
```typescript
// create-engine.ts — createAndAwaitSlot 内
const baseTimeout = atomTimeout ?? def.pending!.timeout;
const scale = state.config?.timeoutScale ?? 1;
const timeoutMs = (Number.isFinite(scale) ? baseTimeout * scale : Number.MAX_SAFE_INTEGER / 1000) * 1000;
```

同时 atom 的 `toViewEvents`/`applyView` 里写 `deadline: Date.now() + timeoutMs` 需一致——这些当前是硬编码 `* 1000`，也要改为读 scale。统一抽一个 `resolveTimeoutMs(state, baseSeconds)` 给 view 层和 slot 层共用。

## 协议变更（`src/server/protocol.ts`）

### ClientMessage 新增

```typescript
| { type: 'update_room_config'; config: RoomConfig }
| { type: 'create_debug_room'; config: RoomConfig }  // 改造现有
```

`create_debug_room` 原先 `{ playerCount }`，改为 `{ config }`，`playerCount` 从 `maxPlayers` 或 config 中派生。为兼容，仍接受旧 `{ playerCount }`。

### ServerMessage 新增

```typescript
| { type: 'room_config'; config: RoomConfig }
| { type: 'room_state'; readyPlayers: string[]; playerIds: string[]; hostId: string | null; maxPlayers: number; config: RoomConfig }
```

- `room_config`：配置变更广播（房主修改后全员收到）
- `room_state`：房间准备状态（谁准备了、共几人）。玩家加入/准备/离开时广播。

### RoomInfo 扩展

```typescript
export interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  status: string;
  isDebug?: boolean;
  config?: RoomConfig;  // ← 新增,供列表显示
}
```

## 后端流程变更

### 调试房间（本次重点）

```
1. POST /api/debug-room { config }
   → createDebugRoom(config) 创建房间(status=等待中, config 存入)
   → 创建 GameSession 占位(不 startGame)
   → 返回 { roomId }

2. 客户端 join_debug_room (N 个 WS 连接,每连接一个座次)
   → joinDebugRoom 加入房间
   → assignDebugSeat 分配座次
   → 发 room_joined + room_state(当前准备状态)

3. 客户端 ready (切到某座次视角点准备)
   → setReady(roomId, playerId)
   → 广播 room_state

4. 客户端 start_game (任意座次,校验 allReady)
   → debug 模式不校验房主,校验 allReady
   → session.startGame(playerCount, room.config)
   → 广播 game_started
```

**改动**：`handleJoinDebugRoom` 不再在首人加入时 `startGame`；改为所有座次就绪后由 `start_game` 触发。`pendingPlayerCount` 机制移除。

### 普通房间（后端预留，前端本次不接）

已有 `create_room`/`join_room`/`ready`/`start_game`，只需：
- `create_room` 接收 config
- 房主 `update_room_config` 修改配置
- `start_game` 传 config 给 session

## 前端变更（仅调试房间）

### `useDebugLobbyController`

- `handleCreateDebugRoom` 改为带 config
- 新增 `roomState`（来自 `room_state` 消息：readyPlayers/playerIds/hostId）
- 新增 `handleReady` / `handleUpdateConfig` / `handleStartGame`

### 新组件：`RoomConfigPanel`

配置 + 准备面板（在 `DebugLobby` 中，`activeRoomId` 存在但游戏未开始时渲染）：
- 房间名输入（房主可改）
- 将池预设下拉
- 倒计时时长下拉（快/标准/慢/无限 → timeoutScale）
- 手牌数输入
- 座次列表 + 每座次「准备」按钮
- 全部准备后「开始」按钮

### `DebugLobby` 状态机

```
activeRoomId == null      → DebugRoomList(创建/加入入口)
activeRoomId && !started  → RoomConfigPanel(配置+准备)    ← 新增
activeRoomId && started   → DebugGameView(游戏视图)
```

`started` 由 `game_started` 消息驱动。

## 引擎改动清单

1. `types.ts`：`GameState.config?: { timeoutScale: number }`
2. `create-engine.ts`：
   - `GameConfig.timeoutScale?`
   - `create()` 写入 `state.config`
   - 新增 `resolveTimeoutMs(state, baseSeconds)`
   - `createAndAwaitSlot` 用 `resolveTimeoutMs` 替代 `timeoutSec * 1000`
3. atom view 层（`toViewEvents`/`applyView` 里的 `Date.now() + X*1000`）：
   - `出牌窗口.ts`、`请求回应.ts`、`询问杀.ts`、`询问闪.ts`、`并行回应.ts`、`选将.ts`
   - 这些里硬编码的 deadline/totalMs 改为 `resolveTimeoutMs(state, base)`

注意：atom 的 `pending.timeout`（静态）保持不变作为 base；实际 slot 超时和 view deadline 都经 `resolveTimeoutMs` 应用 scale。

## 持久化

`saveRoom` 的 meta 扩展携带 `config`；`restorePersistedRooms` 恢复时写回 `room.config`。`persistAsync` 已存 state，`state.config` 自动随之持久化；meta 层补 `config` 即可。

## 验收标准

1. 创建调试房间后进入配置面板，不立即开局
2. 可修改房间名/将池/倒计时/手牌数
3. 切换到每个座次视角可点准备，准备状态实时同步
4. 全部座次准备后可开始，点击后进入游戏
5. 游戏内倒计时按配置的 timeoutScale 生效（验证出牌/询问闪/弃牌等）
6. 将池按预设裁剪（标准池少于全武将）
7. 持久化后重启恢复房间配置
