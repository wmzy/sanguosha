# MCP reportBug 工具设计

> 创建日期: 2026-07-05
> 状态: 设计待实现

## 一、目标与背景

为三国杀 MCP server(`src/ai-mcp/`)新增第三个工具 `reportBug`,让 AI agent 在对局中发现 bug 时,把问题描述连同当时的游戏状态快照写入本地 JSON 文件,供开发者事后排查。

**核心约束(已与用户确认)**:

- 触发方式:新增**独立 MCP 工具** `reportBug`,与 `play`/`getSkillInfo` 并列。agent 想报就报,不与 `play` 的阻塞循环耦合。
- 数据去向:**MCP 进程本地 `fs` 写文件**,不通过 WS 上报游戏服务端、不进对局记录、不影响 `play` 阻塞语义。
- 落盘内容:**agent 文字描述 + 结构化字段 + MCP 进程自动捕获的游戏快照**。
- 落盘格式:每条一个 JSON 文件,放 `data/ai-feedback/`,文件名 `YYYYMMDDTHHMMSS-<6位shortId>.json`(与 `data/snapshots/` 命名风格一致)。
- 落盘目录可用环境变量 `SGS_FEEDBACK_DIR`(绝对路径)覆盖,便于测试/CI。
- 不引入新依赖。

### 不做什么(YAGNI)

- 不上报服务端、不进对局历史。
- 不做去重/限流(一个 agent 一局可能报多条,各自独立文件,不冲突)。
- 不做聚合/查询接口(文件即最终产物,人工或脚本消费)。
- 不改 `play` 工具任何行为。

---

## 二、模块位置

贴合现有 `src/ai-mcp/` 结构,不引入新依赖:

| 文件 | 改动 | 职责 |
|---|---|---|
| `src/ai-mcp/feedbackHandler.ts`(新) | 新建 | `reportBugResult(input, hgc)` 纯逻辑 + `fs` 写盘,返回 `{ ok, id, path, timestamp }` |
| `src/ai-mcp/mcpServer.ts` | 改 | 新增 `REPORT_BUG_TOOL` 常量;`tools/list` 数组加入;`tools/call` 加 `reportBug` 分支 |
| 测试(归并到现有文件) | 改 | `reportBugResult` 单测 + `mcpServer` 集成分支测试 |

---

## 三、工具入参 schema

```jsonc
{
  "name": "reportBug",
  "description": "AI agent 在三国杀对局中发现 bug 时调用：把问题描述 + 结构化字段 + 当时的游戏状态快照写入本地 JSON 文件。不影响游戏进程。返回文件路径和 id。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "description": { "type": "string", "description": "bug 描述,自由文本" },
      "severity": { "type": "string", "enum": ["low","medium","high","critical"], "description": "严重程度,默认 medium" },
      "category": { "type": "string", "enum": ["skill-settlement","state-inconsistency","ui","rule-violation","other"], "description": "分类,默认 other" },
      "expected": { "type": "string", "description": "期望行为(可选)" },
      "actual": { "type": "string", "description": "实际行为(可选)" }
    },
    "required": ["description"]
  }
}
```

字段语义:

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `description` | string | 是 | — | bug 描述,自由文本 |
| `severity` | enum | 否 | `medium` | `low\|medium\|high\|critical` |
| `category` | enum | 否 | `other` | `skill-settlement`(技能结算)\|`state-inconsistency`(状态不一致)\|`ui`\|`rule-violation`(规则违反)\|`other` |
| `expected` | string | 否 | — | 期望行为 |
| `actual` | string | 否 | — | 实际行为 |

---

## 四、出参

MCP `content`(text) + `structuredContent`:

```json
{
  "ok": true,
  "id": "a1b2c3",
  "path": "/abs/data/ai-feedback/20260705T143012-a1b2c3.json",
  "timestamp": "2026-07-05T06:30:12.000Z"
}
```

---

## 五、自动捕获的快照(零副作用,关键)

`reportBug` 在写盘前从 hgc **只读**捕获快照,**不调用任何消费式 API**,确保对 `play` 阻塞/事件语义零影响:

- `capturedAt`: ISO 时间戳
- `reporter`: `{ roomId, seat, phase }`
- `snapshot.view`: `projectView(hgc.view)`(`hgc.view` 为 null 即 lobby/connecting 时为 `null`)
- `snapshot.availableActions`: `hgc.getAvailableActions()`(只读枚举,复用 play 的同一只读路径)

**明确禁止**调用 `hgc.drainNewEvents()`——它是消费式的,会偷走下一次 `play` 返回的 `recentEvents`。需要事件文本时,`projectView` 输出里的 `view.log`(最近 20 条)已覆盖。

> 这一点是与 `runPlay` 的 snapshot 闭包的唯一区别:`runPlay` 会 `drainNewEvents`(因为 play 本就要把事件交给 agent),reportBug 不能这么做。

---

## 六、落盘文件结构

```json
{
  "id": "a1b2c3",
  "timestamp": "2026-07-05T06:30:12.000Z",
  "reporter": { "roomId": "AB12", "seat": 0, "phase": "playing" },
  "severity": "high",
  "category": "skill-settlement",
  "description": "...",
  "expected": "...",
  "actual": "...",
  "snapshot": {
    "view": { /* AiViewSnapshot,见 viewProjector.ts */ },
    "availableActions": [ /* AvailableAction[] */ ]
  }
}
```

- 目录:`data/ai-feedback/`,启动/调用时 `mkdir { recursive: true }`(不存在则创建)
- 目录可用 `process.env.SGS_FEEDBACK_DIR` 覆盖(绝对路径);未设置时默认相对 MCP 进程 cwd 的 `data/ai-feedback/`
- 文件名:`YYYYMMDDTHHMMSS-<6位shortId>.json`
  - 时间戳取本地时间(与 `data/snapshots/` 一致),格式 `YYYYMMDDTHHMMSS`
  - shortId:6 位随机串(大小写字母+数字,即 base62),防同秒碰撞
- 一条 bug 一个文件

---

## 七、错误处理

- 目录创建失败 / 文件写入失败 → 抛出,由 `handleMcpRequest` 的 catch 兜底返回 JSON-RPC error(`-32603`),**进程不崩**
- `hgc.view` 为 null(lobby/connecting 阶段)→ `snapshot.view = null`,仍正常记录(大厅期 bug 也可能发生)
- `description` 缺失或非 string → JSON-RPC error(`-32602` invalid params)
- 不重试,不缓存;写失败即返回失败,agent 可重试调用

---

## 八、测试(遵循 AGENTS.md 测试放置规范)

归并到**已有测试文件**,不新建孤岛文件:

1. `reportBugResult` 单元测试 → 归入 `src/ai-mcp/` 已有测试(若 `feedbackHandler` 无对应测试文件,则归入 `tests/ai-mcp/mcpServer.test.ts` 的 describe):
   - 文件结构正确(含 id/timestamp/reporter/severity/category/description/snapshot)
   - 文件命名格式 `YYYYMMDDTHHMMSS-<6位>.json`
   - 目录不存在时自动创建
   - `SGS_FEEDBACK_DIR` 覆盖默认目录
   - `hgc.view` 为 null 时 `snapshot.view = null` 仍落盘
   - **不调用** `drainNewEvents`(断言 hgc stub 的 drainNewEvents 调用次数为 0)

2. `mcpServer.test.ts` 集成:
   - `tools/list` 返回含 `reportBug`
   - `tools/call reportBug` 返回 `structuredContent.ok === true` 且对应路径文件存在

测试用 hgc stub,不需要真实 WS 连接。

---

## 九、与现有架构的关系

- 复用 `viewProjector.projectView`(已有,纯函数)
- 复用 `HeadlessGameClient` 的只读访问器 `view`/`getAvailableActions`/`roomId`/`seatIndex`/`phase`(已有)
- `McpHandlerContext`(已有)已持有 `hgc` 和 `seat`,reportBug 分支直接用,无需扩展 ctx
- 不改 `playHandler`、不改 `viewProjector`、不改 HGC

---

## 十、验收标准

1. `tools/list` 返回三个工具,含 `reportBug`
2. agent 调用 `reportBug({ description, severity, category })` 后,`data/ai-feedback/` 下出现一个 JSON 文件,内容含 agent 提供的字段 + 自动快照
3. 调用 `reportBug` 后立即调用 `play`,play 的 `recentEvents` 不受影响(drainNewEvents 未被 reportBug 调用)
4. `SGS_FEEDBACK_DIR` 设置时,文件落在该目录
5. lobby/connecting 阶段(view 为 null)调用 `reportBug` 仍成功落盘,`snapshot.view = null`
6. 写盘失败时返回 JSON-RPC error,进程不崩
7. `pnpm tsc` 通过,新增/修改测试通过
