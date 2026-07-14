# sanguosha-play plugin

AI 驱动三国杀对局的 Claude Code plugin。接管一个座次，自动开局、出牌决策、技能查询。

## 自包含——一个 npm 包全到位

本 plugin 发布为 npm 包 `sanguosha-agent-plugin`，**skill + MCP 构建产物都在包内**。`/plugin install` 一次，全部就位，无需额外 `npx` 拉取。

| 组件 | 说明 |
|---|---|
| **sanguosha MCP server** | 暴露 `play`（驱动对局）、`getSkillInfo`（查技能/卡牌描述）、`reportBug`（对局 bug 落盘反馈）三个工具 |
| **sanguosha-play skill** | 教 AI 如何用上述工具跑完整局：开局 → 选将 → 出牌循环 → 结算 |

## 安装

```
/plugin marketplace add wmzy/sanguosha
/plugin install sanguosha-play@sanguosha
```

## 配置游戏服务器

MCP server 默认连 build 时注入的公共服务器（`SGS_PUBLIC_URL`）。

连自建服务器时，设置环境变量再启动 Claude Code：

```bash
export SGS_SERVER_URL=ws://localhost:3930/ws
```

| 变量 | 默认 | 说明 |
|---|---|---|
| `SGS_SERVER_URL` | build 时注入值 | 游戏服务器 WS 地址（注意 `/ws` 路径） |
| `SGS_ROOM_ID` | 自动建房 | 加入指定房间码 |
| `SGS_SEAT` | `0` | 座次下标 |
| `SGS_PLAYER_COUNT` | `2` | 建房人数 |

## 使用

直接对 Claude 说即可，skill 会引导流程：

- 「开一局三国杀」
- 「建房等 2 人加入」
- 「加入房间 ABC123」

## 开发者

仓库结构（git 仓库只放源文件，构建产物只进 npm tarball）：

```
plugin/
├── .claude-plugin/plugin.json      源：manifest
├── package.json                    源：npm 包元数据（version 由 semantic-release 管理）
├── skills/sanguosha-play/SKILL.md  源：玩家 skill
├── README.md                       源：本文件
└── mcp/sanguosha-mcp.mjs           构建产物（.gitignore，只进 npm 包）
```

- 开发用 skill（`add-atom` / `add-skill`）不在本 plugin，见主仓库 `.claude/skills/`。
- MCP 源码：`src/ai-mcp/server.ts`。
- 本地构建验证：`SGS_PUBLIC_URL=wss://<服务器>/ws pnpm build:plugin && pnpm validate:plugin`。
- **发布全自动（OIDC trusted publishing）**：推 main 分支 → `release-agent-plugin.yml` 跑 build → semantic-release 分析 conventional commits → 自动发 npm 包 + GitHub Release。npm 认证走 OIDC（在 npmjs.com 配置 Trusted Publisher 指向本仓库 + workflow 文件 `release-agent-plugin.yml`），无需 NPM_TOKEN；provenance 自动生成。`plugin/package.json` 和 `plugin/.claude-plugin/plugin.json` 的 version 字段均由 semantic-release 在 CI 临时更新（前者由 `@semantic-release/npm`，后者由 `sync-plugin-version.mjs` 脚本），git 里保持占位值，版本真相由 git tag 追踪。
- 需配置的 GitHub Secrets：`SGS_PUBLIC_URL`（公共游戏服务器 WS 地址，可选）。npm 发布靠 OIDC，无需 NPM_TOKEN。
