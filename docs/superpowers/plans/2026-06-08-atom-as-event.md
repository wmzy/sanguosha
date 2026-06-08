# atom-as-event 迁移计划

> 状态：**核心迁移已完成**。编译零错误（引擎核心）。148 错误限于孤立技能文件（v2 遗留）。

## 已完成

### 基础设施
- `types.ts`：新增 `AtomLogEntry`、`AtomPlayerViews`；删除 `ServerEvent`、`PlayerEvent`、`AtomEventResult`；`GameState.serverLog` 改为 `AtomLogEntry[]`；`EngineResult` 改为 `{ state, logEntries, playerViews }`
- `event.ts`：新增 `makeLogEntry(atom)`；删除 `makeServerEvent`、`makePlayerEvent`
- `AtomDefinition`：删除 `toEvents`；新增可选 `toPlayerViews`

### 核心管线
- `atom.ts`：`applyAtoms` 改为生成 `AtomLogEntry` + `toPlayerViews` 可见性分叉
- `atom-async.ts`：同步改造
- `async-hook.ts`：`HookCtx.serverEvent` → `logEntry: AtomLogEntry`

### atom 定义（38 个文件）
- 全部删除 `toEvents` 方法、`makeServerEvent`/`makePlayerEvent` import、`AtomEventResult` import
- 保留 `apply` 和 `getResult`

### 非 atom 调用方
- `create-engine.ts`、`engine.ts`：`makeServerEvent` → `makeLogEntry`，`events` → `logEntries`
- `phase-advance.ts`：`.events` → `.logEntries`
- `session.ts`：`broadcastEvents` 接收 `AtomLogEntry[]`，构造 `SequencedEvent` 时从 `entry.atom` 提取 type/payload
- `protocol.ts`：`SequencedEvent` 改为独立接口（不依赖 `ServerEvent`）
- `logger.ts`：`eventToServerOp`/`eventToPlayerOp` 接收 `AtomLogEntry`
- 所有 handlers/ 和 phases/ 文件：`.events` → `.logEntries`，`makeServerEvent` → `makeLogEntry`

## 后续待迁移

### view/reducer.ts（低优先级）
- `applyGameStateEvent` 函数体引用已删除的 `ServerEvent` 类型，但 TypeScript 在 `isolatedModules` 模式下不报错
- 运行时正常：重放从 `AtomLogEntry[]` 取 atom 数据
- 后续可改为 `applyAtom` 循环，消除重复逻辑

### 有分叉 atom（后续优化）
当前所有 atom 统一走默认行为（所有人看到同一个 atom），以下是原始分叉语义待恢复：
- `draw.ts`：P1 看到牌面详情，其他人只看到 count
- `gainCard.ts`：P1 看到卡牌详情，其他人只看到来源
- `rearrangeDeck.ts`：发动者看到牌堆详情，其他人只看到 count
- `mark.ts`/`skill.ts`/`var.ts`/`maxHealth.ts`/`tag.ts`：原 owner-only 分叉

恢复方式：为这些 atom 实现 `toPlayerViews`，返回 `AtomPlayerViews` 元组。

### 客户端 reducer
- `view/reducer.ts` 的 switch-case 从 `event.type + payload` 改为 atom 字段匹配
- `mapEvent` → `mapAtom`
- `useDebugLobbyController.ts` 中 `reduceGameState` 调用需要传 `AtomLogEntry[]`

### 孤立技能文件
- `src/engine/skills/` 中 15 个 v2 技能文件有 148 编译错误
- 需迁移到 v3 `registerHooks` 模式或删除

## 风险
- `gameOver`/`濒死` 等非 atom 事件使用 `as unknown as Atom` 类型断言，不在 Atom 联合类型中
- 客户端 `SequencedEvent` 格式与原 `ServerEvent` 兼容（type 从 atom.type 提取，payload 是 atom 本身）
