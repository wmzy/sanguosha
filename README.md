# 三国杀

基于 Web 的三国杀多人在线卡牌游戏。

## 技术栈

- **前端:** React 19 + TypeScript + Vite 8
- **后端:** Hono + WebSocket
- **样式:** Linaria CSS-in-JS
- **测试:** Vitest + Playwright
- **包管理:** pnpm

## 快速开始

```bash
pnpm install
pnpm dev          # 启动开发服务器 (http://localhost:3930)
```

## 命令

```bash
pnpm dev          # 开发服务器（前端 + API + WebSocket 共享端口）
pnpm build        # 构建生产版本
pnpm test         # 运行所有测试
pnpm test:watch   # 监听模式运行测试
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # ESLint 检查
pnpm format       # Prettier 格式化
pnpm server       # 独立运行后端服务器
```

## 项目结构

```
shared/           # 前后端共享的类型和数据
  types.ts        # 核心类型定义
  characters.ts   # 角色配置
  cards/          # 卡牌定义（基本牌/锦囊牌/装备牌）
  deck.ts         # 牌组管理
  rng.ts          # 种子化随机数
  log.ts          # 日志类型

engine/           # 游戏引擎（纯逻辑，无 UI 依赖）
  atoms/          # 原子操作（唯一修改状态的通道）
  handlers/       # 动作处理器
  phases/         # 技能阶段定义
  skills/         # 技能定义（魏/蜀/吴/群/装备）
  types.ts        # 引擎类型定义
  state.ts        # 游戏状态管理
  engine.ts       # 引擎主入口
  skill.ts        # 技能注册与触发
  event.ts        # 事件系统
  atom.ts         # Atom 注册表
  validate.ts     # 操作校验
  distance.ts     # 距离计算
  expr.ts         # 表达式系统
  serializer.ts   # 状态序列化

src/              # 前端 React 应用
  components/     # UI 组件
  hooks/          # 自定义 Hooks
  utils/          # 工具函数

server/           # 后端服务器
  app.ts          # Hono 应用（REST API）
  session.ts      # 游戏会话管理
  room.ts         # 房间管理
  protocol.ts     # WebSocket 消息协议

tests/            # 测试
  atoms/          # Atom 单元测试
  scenarios/      # 技能场景测试
  frontend/       # 前端状态测试
  unit/           # 其他单元测试
  e2e/            # 端到端测试

docs/             # 文档
  design/         # 设计文档
  research/       # 武将技能研究资料
```

## 游戏功能

- 25 个标准角色（魏蜀吴群四势力）
- 基本牌：杀、闪、桃
- 锦囊牌：过河拆桥、顺手牵羊、无中生有、决斗、万箭齐发、南蛮入侵、桃园结义、五谷丰登
- 装备牌：8 种武器、2 种防具、6 种马
- 身份局：主公/忠臣/反贼/内奸
- 游戏日志与重播
- 多人联机（WebSocket）

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3930` | 服务器端口 |
| `HOST` | `true` | 绑定地址（`true` = 所有网卡） |

## AI agent 接入

让 AI agent（Claude Code / Cursor / Codex / Windsurf 等）通过 MCP server 接管三国杀对局。

### 1. 配置 MCP server（sanguosha-mcp）

MCP server 是一个 stdio 进程，连游戏服务器驱动对局。安装方式按 agent 不同：

**Claude Code**

```bash
claude mcp add sanguosha -- env SGS_SERVER_URL=wss://<服务器>/ws npx -y sanguosha-mcp
```

或写入项目 `.mcp.json`：

```json
{
  "mcpServers": {
    "sanguosha": {
      "command": "npx",
      "args": ["-y", "sanguosha-mcp"],
      "env": { "SGS_SERVER_URL": "wss://<服务器>/ws" }
    }
  }
}
```

**Cursor** — 写入 `~/.cursor/mcp.json`（结构同上）。

**Windsurf** — 写入 `~/.codeium/windsurf/mcp_config.json`（结构同上）。

**Codex** — 按其 MCP 配置文件写入（结构同上）。

### 2. 安装玩家向 skill

```bash
npx skills add wmzy/sanguosha --skill sanguosha-play
# 或交互式选择
npx skills add wmzy/sanguosha
```

skill 会装到当前 agent 的 skills 目录，教 agent 如何用 MCP 玩游戏 + 三国杀规则速查。

### 3. 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `SGS_SERVER_URL` | 是 | 游戏服务器 WS 地址（注意 `/ws` 路径） |
| `SGS_ROOM_ID` | 否 | 加入指定房间（省略则建房） |
| `SGS_SEAT` | 否 | 座次下标，默认 `0` |
| `SGS_PLAYER_COUNT` | 否 | 建房人数，默认 `2` |

### 本仓库开发

本仓库自身开发用源码直跑（`pnpm mcp:serve`，连 `ws://localhost:3930/ws`），配置见仓库根 `.mcp.json`。发布 npm 包用 `pnpm build:mcp` 打包成单文件。
