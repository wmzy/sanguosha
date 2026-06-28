# 多人模式与人机同房设计

日期：2026-06-27
状态：已确认

## 目标

为游戏添加正式多人模式，打通 MCP，支持人和 AI 在同一房间游戏。提供兼容 Claude Code 的 skill 与 `/sgs-start` 斜杠命令。

## 现状

- 服务端普通（非调试）多人房机制已具备：`create_room` / `join_room` / `ready` / `start_game`，session 按 playerId 映射座次。
- 但等待中的普通房间因 `getRoomList` 的 session 过滤而不可见，浏览器端无任何多人模式 UI（HomePage 仅有「调试游戏」入口）。
- MCP `HeadlessGameClient` 只能创建/加入调试房间（`join_debug_room`），无法加入普通多人房；`play` 工具的 `startGame` 只走 debug 路径。

## 设计

### A. 服务端发现性

`src/server/room.ts` 的 `getRoomList`：对 `'等待中'` 状态的房间放开 session 过滤——等待中的多人房无需已有 session 即可被发现和加入（创建房间后即应可见）。游戏进行中/已结束的房间仍需有 session 才出现。空房由 `leaveRoom` 在人数归零时自动删除，无泄漏。

### B. 玩家 id 支持

服务端 WS 入口当前在 `onOpen` 时自动 `generatePlayerId()`。扩展为支持客户端在首条消息中声明期望 playerId（可选）。具体方式：WS 连接建立后，若客户端发送的首条消息携带 `playerId` 字段（在现有消息类型上扩展，或新增轻量 `set_player_id` 消息），服务端采用该值；否则自动生成。这满足「给定玩家 id 或自动创建」。

落地采用最小侵入方案：新增 ClientMessage 类型 `{ type: 'set_player_id'; playerId: string }`，服务端 `handleWsMessage` 处理时更新当前连接的 playerId 映射（仅 lobby/连接初期有效）。MCP server 和浏览器客户端可在 WS open 后立即发送该消息。

### C. 无头客户端普通房能力

`src/client/headless/HeadlessGameClient.ts`：
- 新增 `createRoom(name: string, maxPlayers: number, config?: RoomConfig): void` —— 发送 `create_room` 消息。
- 新增 `joinRoom(roomId: string): void` —— 发送 `join_room` 消息。
- 保留 `createDebugRoom` / `connect`（debug join）兼容现有调试流程。
- 座次适配：普通房座次在 startGame 时按加入顺序分配，HGC 在收到 `initialView` 时 `seatIndex` 自动更新为 `view.viewer`（已有机制，无需改动）。

### D. MCP 大厅编排

新文件 `src/ai-mcp/lobby.ts`，导出 `joinAndStartRoom(hgc, opts)`：
- opts: `{ mode: 'create'|'join'; roomId?: string; name?: string; maxPlayers?: number; config?: RoomConfig; playerId?: string; readyTimeoutMs?: number }`
- 流程：建房(createRoom)/入房(joinRoom) → 等 `room_joined` → sendReady → 轮询 `hgc.roomState` 直至 `allReady`（readyPlayers 数 === 当前 playerIds 数）→ 若房主则 `sendStartGame` → 等 `phase === 'playing'` 或超时。
- 基于 HGC 同步 getter 轮询（沿用 playHandler 的 tick 模型）。

### E. MCP play 工具扩展

`src/ai-mcp/mcpServer.ts`：
- `startGame` 参数扩展为 `boolean | { mode?: 'multiplayer'|'debug'; roomId?: string; name?: string; maxPlayers?: number; playerId?: string; readyTimeoutMs?: number }`。`true` 保持 debug 兼容（旧行为）。
- `McpHandlerContext.ensureStarted` 改为接受 opts，按 mode 分支调用 lobby 或走旧 debug 路径。
- `src/ai-mcp/server.ts`：env `SGS_ROOM_ID` 有值时默认 join 模式；`SGS_MODE`、`SGS_NAME`、`SGS_MAX_PLAYERS`、`SGS_PLAYER_ID` 作为默认值，被 args 覆盖。

### F. 浏览器多人页

新增：
- `src/client/hooks/useMultiplayerRoom.ts`：单 HGC 连接管理人类自己座次。状态机 lobby → waiting → playing → ended。
- `src/client/pages/MultiplayerPage.tsx`：最小加入页。`lobby`（输码加入 / 创建房间）→ `waiting`（显示房间码、准备、房主开局）→ `playing`（复用 `<GameViewComponent view={myView} onAction/>`）→ `ended`。
- `src/client/App.tsx`：新增路由 `/play`。
- `src/client/pages/HomePage.tsx`：新增「多人游戏」入口按钮。

复用现成单视角组件 `GameViewComponent`（正式模式直接传当前玩家 view，无需 headerSlot）。

### G. Skill + Slash 命令 + MCP 注册（提供安装方式，不直接写 .claude）

- `docs/skills/sgs-play/SKILL.md`：skill 内容（含游戏规则、play 工具用法、决策策略）。提供安装说明：用户执行 `cp -r docs/skills/sgs-play .claude/skills/` 或脚本 `scripts/install-claude-skill.sh`。
- `docs/commands/sgs-start.md`：`/sgs-start [roomId]` slash 命令内容。安装同上。
- `.mcp.json`（项目根）：注册 sanguosha MCP server（`npm run mcp:serve`），env `SGS_SERVER_URL`。

`/sgs-start [roomId]` 行为：
- 带 roomId：调用 play 工具 `startGame: { mode:'multiplayer', roomId }` 加入指定房间并准备开局。
- 不带 roomId：`startGame: { mode:'multiplayer' }` 作为房主建房、准备、等待，输出房间码供人类加入。
- 支持可选 playerId。

## 端到端流程

1. 一方建房（人类浏览器 `/play` 或 AI `/sgs-start`）→ 拿到房间码。
2. 另一方加入（AI `/sgs-start <码>` 或人类输码）→ 双方 ready。
3. 房主 start_game → allReady 校验通过 → 开局，座次按加入顺序分配，人机混坐。

## 测试

- `tests/ai-mcp/lobby.test.ts`：建房/加入/房主等待开局/非房主等待/超时 5 个分支（mock HGC getter 序列）。
- `tests/ai-mcp/mcpServer.test.ts` 扩展：`startGame` 对象形态触发 lobby。
- `tests/server/room.test.ts`（若存在则追加）：等待中无 session 房间在 `getRoomList('multiplayer')` 可见。
- 集成：两 HGC（host+join）跑通 ready→start→playing。

## 非目标

- 完整大厅 UI（房间列表、筛选、聊天、配置面板等）——仅最小加入页。
- AI 自动决策策略的深度优化——skill 提供基础策略，agent 按规则行动即可。
