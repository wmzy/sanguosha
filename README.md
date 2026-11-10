# 三国杀

基于 Web 的三国杀多人在线卡牌游戏。

## 技术栈

- **前端:** React 19 + TypeScript + Vite 8
- **后端:** Hono REST + SSE
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
pnpm dev          # 开发服务器（前端 + REST API + SSE 共享端口）
pnpm build        # 构建生产版本
pnpm test         # 运行 core 测试项目
pnpm test:skills  # 运行技能测试项目
pnpm test:all     # 运行全部 Vitest 测试
pnpm test:watch   # 监听模式运行 core 测试
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # ESLint 检查
pnpm format       # Prettier 格式化
pnpm server       # 独立运行后端服务器
```

日常只跑变更相关测试：`pnpm test --changed --maxWorkers=2`（core）或 `pnpm test:all --changed --maxWorkers=2`（含技能）。运行前用 `free -h` 和 `nproc` 检查资源；确需全量时显式限制 worker 数。

CI 包含类型检查、lint、构建、限并发全量覆盖率、普通认证房间的 HGC/Chromium 流程与插件验证。`main` 的发布工作流调用同一提交的 CI，成功后才构建并验证发布产物；其他分支与 PR 直接运行 CI。

## 游戏功能

- **165 名武将**：标准版 76 名 + 界限突破 89 名，覆盖魏蜀吴群四势力
- **基本牌**：杀、闪、桃、酒（军争篇）
- **锦囊牌**：过河拆桥、顺手牵羊、无中生有、决斗、万箭齐发、南蛮入侵、桃园结义、五谷丰登、乐不思蜀、兵粮寸断、闪电、无懈可击、铁索连环、火攻、借刀杀人（标准版 + 军争篇）
- **装备牌**：11 种武器、4 种防具、7 种马（标准版 + 军争篇）
- **身份局**：主公/忠臣/反贼/内奸
- 游戏日志与重放
- 多人联机（REST + SSE）

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3930` | 服务器端口 |
| `HOST` | `true` | 绑定地址（`true` = 所有网卡） |
| `SGS_TRUSTED_PROXIES` | 空 | 逗号分隔的可信代理 IP；仅这些 peer 的转发头用于限流。代理必须覆盖 `X-Real-IP` 或追加真实来源到 `X-Forwarded-For`；修改后重启。 |

## AI agent 接入

需要多 AI 对战、独立记忆、观众全手牌展示与永久归档时，先看 [AI 对局接入指南](docs/guides/AI对局接入.md)。运行 `pnpm arena:smoke` 可验证完整对局；观众入口为 `http://localhost:3930/arena`。

让 AI agent（Claude Code / Cursor / Codex / Windsurf 等）通过 MCP server 接管三国杀对局。

### Claude Code（plugin 一键安装）

```
/plugin marketplace add wmzy/sanguosha
/plugin install sanguosha-play@sanguosha
```

Plugin 包 `sanguosha-agent-plugin` 自包含玩家向 skill + sanguosha MCP server，一次安装全到位。安装后直接对 Claude 说「开一局三国杀」即可。

### 其他 agent（Cursor / Codex / Windsurf）

这些 agent 不支持 Claude Code plugin，需单独配置 MCP server：

1. 从 npm 安装 MCP server：`npm i -g sanguosha-agent-plugin`（同一包，plugin 内容对它们无影响）
2. 配置 stdio 命令指向包内 MCP：

```json
{
  "mcpServers": {
    "sanguosha": {
      "command": "node",
      "args": ["<全局 node_modules>/sanguosha-agent-plugin/mcp/sanguosha-mcp.mjs"],
      "env": { "SGS_SERVER_URL": "https://<服务器>" }
    }
  }
}
```

- **Cursor** — 写入 `~/.cursor/mcp.json`
- **Windsurf** — 写入 `~/.codeium/windsurf/mcp_config.json`
- **Codex** — 按其 MCP 配置文件写入

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `SGS_SERVER_URL` | build 时注入值 | 游戏服务器 WS 地址（注意 `/ws` 路径） |
| `SGS_ROOM_ID` | 自动建房 | 加入指定房间 |
| `SGS_SEAT` | `0` | 座次下标 |
| `SGS_PLAYER_COUNT` | `2` | 建房人数 |

### 本仓库开发

本仓库自身开发用源码直跑（`pnpm mcp:serve`，连 `http://localhost:3930`），配置见仓库根 `.mcp.json`。发布 plugin npm 包用 `pnpm build:plugin` 打包 skill + MCP 为单文件。
