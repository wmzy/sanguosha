# AI 工具分发体系 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把三国杀 MCP server 打包成可发布的 `sanguosha-mcp` 单文件 npm 包，新建玩家向 skill 走 `npx skills` 分发，并补齐跨 agent 安装文档。

**Architecture:** 两条分发线独立运作——MCP 用 Vite 库模式打成单文件 ESM（带 shebang），构建脚本生成 package.json；玩家向 skill 放仓库根 `skills/sanguosha-play/` 供 `npx skills` 发现；现有开发 skill 加 `metadata.internal: true` 排除出对外分发。

**Tech Stack:** Vite 8（库模式）、Node 22 ESM、Agent Skills 格式（SKILL.md frontmatter）、`npx skills`（vercel-labs/skills）。

**关联 spec:** `docs/superpowers/specs/2026-06-27-ai-tooling-distribution-design.md`

**关键约束（来自 spec，实现时不可违背）:**
- `npx skills` 只装 skill 不装 MCP——MCP 安装靠各 agent 配置 + 文档，不写自安装器。
- 不引入新的打包工具（只用已有的 Vite）。
- 不改项目结构（当前是单包项目，不是 monorepo）。

---

## 文件结构

| 操作 | 文件 | 职责 |
|---|---|---|
| 改 | `src/ai-mcp/server.ts` | 默认 URL 改为可构建期注入（`__SGS_DEFAULT_URL__` + typeof 守卫） |
| 新增 | `vite.mcp.config.ts` | Vite 库模式配置，单文件打包 MCP server |
| 新增 | `scripts/build-mcp.mjs` | 构建脚本：调 vite build + 生成 package.json/README |
| 改 | `package.json` | 加 `build:mcp` 脚本 |
| 新增 | `skills/sanguosha-play/SKILL.md` | 玩家向 skill（MCP 用法 + 规则速查） |
| 改 | `.claude/skills/add-atom/SKILL.md` | 加 `metadata.internal: true` |
| 改 | `.claude/skills/add-skill/SKILL.md` | 加 `metadata.internal: true` |
| 改 | `README.md` | 加「AI agent 接入」章节 |

注：`.gitignore` 已含 `dist`，`dist/sanguosha-mcp/` 自动被忽略，无需改。

---

### Task 1: server.ts 默认 URL 改为构建期可注入

让发布的包能注入公开服务器默认 URL，同时本仓库 `pnpm mcp:serve`（tsx 直跑源码）行为不变（兜底 localhost）。

**Files:**
- Modify: `src/ai-mcp/server.ts:3-14`

- [ ] **Step 1: 修改默认 URL 逻辑**

把 `src/ai-mcp/server.ts` 顶部（第 3-14 行附近）从：

```ts
// 环境变量：
//   SGS_SERVER_URL（默认 ws://localhost:3930/ws，注意 /ws 路径）
//   SGS_ROOM_ID（不提供则首次 play 用 startGame 创建 debug 房）
//   SGS_SEAT（默认 0）
//   SGS_PLAYER_COUNT（创建房时用，默认 2）
import * as readline from 'node:readline';
import { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import { handleMcpRequest, normalizeStartGame, type JsonRpcRequest, type JsonRpcResponse, type McpHandlerContext, type StartGameOpts } from './mcpServer';
import { joinAndStartRoom } from './lobby';

const SERVER_URL = process.env.SGS_SERVER_URL ?? 'ws://localhost:3930/ws';
```

改为：

```ts
// 环境变量：
//   SGS_SERVER_URL（覆盖默认服务器地址，注意 /ws 路径）
//   SGS_ROOM_ID（不提供则首次 play 用 startGame 创建 debug 房）
//   SGS_SEAT（默认 0）
//   SGS_PLAYER_COUNT（创建房时用，默认 2）
import * as readline from 'node:readline';
import { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import { handleMcpRequest, normalizeStartGame, type JsonRpcRequest, type JsonRpcResponse, type McpHandlerContext, type StartGameOpts } from './mcpServer';
import { joinAndStartRoom } from './lobby';

// 构建期注入的默认服务器 URL。
// tsx 直跑源码时该符号未定义 → typeof 守卫避免 ReferenceError，兜底 localhost（本仓库开发用）。
// vite build 时 vite.mcp.config.ts 的 define 把它替换为 SGS_PUBLIC_URL 注入值。
declare const __SGS_DEFAULT_URL__: string | undefined;
const DEFAULT_URL =
  typeof __SGS_DEFAULT_URL__ !== 'undefined' && __SGS_DEFAULT_URL__
    ? __SGS_DEFAULT_URL__
    : 'ws://localhost:3930/ws';
const SERVER_URL = process.env.SGS_SERVER_URL ?? DEFAULT_URL;
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS（无错误。`declare const` 合法；typeof 守卫类型安全）

- [ ] **Step 3: 冒烟验证本仓库开发路径不变**

```bash
pnpm mcp:serve < /dev/null 2>&1 | head -1
```
Expected: stderr 输出 `serving on stdio (server=ws://localhost:3930/ws, ...)`（兜底 localhost 生效，证明 typeof 守卫未破坏 tsx 运行）

- [ ] **Step 4: Commit**

```bash
git add src/ai-mcp/server.ts
git commit -m "feat(mcp): 默认服务器 URL 改为构建期可注入

新增 __SGS_DEFAULT_URL__ 构建期注入点，发布包可注入公开服务器默认值；
tsx 直跑源码时 typeof 守卫兜底 localhost，本仓库开发行为不变。"
```

---

### Task 2: Vite 库模式打包配置

**Files:**
- Create: `vite.mcp.config.ts`

- [ ] **Step 1: 创建 vite.mcp.config.ts**

```ts
// MCP server 单文件打包配置（与前端 vite.config.ts 分离）。
// 产出 dist/sanguosha-mcp/sanguosha-mcp.mjs：带 shebang、可 `node` 直接运行、可作 npm bin。
// 发布时 SGS_PUBLIC_URL=wss://<公开服务器>/ws pnpm build:mcp 注入默认服务器地址。
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __SGS_DEFAULT_URL__: JSON.stringify(process.env.SGS_PUBLIC_URL ?? ''),
  },
  build: {
    lib: {
      entry: 'src/ai-mcp/server.ts',
      formats: ['es'],
      fileName: () => 'sanguosha-mcp.mjs',
    },
    outDir: 'dist/sanguosha-mcp',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'node22',
    rollupOptions: {
      // node 内置模块外置；ws 的可选原生加速模块外置（缺失时 ws 自动回退纯 JS）
      external: [/^node:/, 'bufferutil', 'utf-8-validate'],
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
  },
});
```

- [ ] **Step 2: 不单独 commit（与 Task 3 一起验证后提交）**

---

### Task 3: 构建脚本 + package.json 入口

**Files:**
- Create: `scripts/build-mcp.mjs`
- Modify: `package.json`（加 `build:mcp` 脚本）

- [ ] **Step 1: 创建 scripts/build-mcp.mjs**

```js
// 构建 sanguosha-mcp 发布包：vite 单文件打包 + 生成 package.json/README。
// 用法：
//   pnpm build:mcp                                  # 默认 0.1.0，无公开服务器默认值
//   MCP_VERSION=0.2.0 SGS_PUBLIC_URL=wss://x/ws pnpm build:mcp
// 产物：dist/sanguosha-mcp/（sanguosha-mcp.mjs + package.json + README.md）
// 发布：npm publish dist/sanguosha-mcp
import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = 'dist/sanguosha-mcp';
const version = process.env.MCP_VERSION ?? '0.1.0';
const publicUrl = process.env.SGS_PUBLIC_URL ?? '';

console.log(`building sanguosha-mcp@${version}${publicUrl ? ` (default server: ${publicUrl})` : ''}`);

await build({ configFile: 'vite.mcp.config.ts' });

await mkdir(outDir, { recursive: true });

const pkg = {
  name: 'sanguosha-mcp',
  version,
  description: '三国杀 AI 代打 MCP server——把游戏引擎暴露给通用 agent 驱动对局',
  type: 'module',
  bin: { 'sanguosha-mcp': './sanguosha-mcp.mjs' },
  engines: { node: '>=22' },
  license: 'MIT',
  homepage: 'https://github.com/wmzy/sanguosha',
};
await writeFile(join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

const readme = `# sanguosha-mcp

三国杀 AI 代打 MCP server。一个进程接管一个座次视角，通过 stdio JSON-RPC 暴露给通用 agent（Claude Code / Cursor / Codex / Windsurf 等）。

## 快速接入（Claude Code）

\`\`\`bash
claude mcp add sanguosha -- env SGS_SERVER_URL=${publicUrl || 'wss://<公开服务器>/ws'} npx -y sanguosha-mcp
\`\`\`

或写入项目 \`.mcp.json\`：

\`\`\`json
{
  "mcpServers": {
    "sanguosha": {
      "command": "npx",
      "args": ["-y", "sanguosha-mcp"],
      "env": { "SGS_SERVER_URL": "${publicUrl || 'wss://<公开服务器>/ws'}" }
    }
  }
}
\`\`\`

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| \`SGS_SERVER_URL\` | ${publicUrl ? `\`${publicUrl}\`` : '注入值/localhost'} | 游戏服务器 WS 地址（注意 /ws 路径） |
| \`SGS_ROOM_ID\` | 自动建房 | 加入指定房间 |
| \`SGS_SEAT\` | \`0\` | 座次下标 |
| \`SGS_PLAYER_COUNT\` | \`2\` | 建房人数 |

完整文档与玩家向 skill：https://github.com/wmzy/sanguosha#ai-agent-接入
`;
await writeFile(join(outDir, 'README.md'), readme);

console.log(`✓ built → ${outDir}/`);
```

- [ ] **Step 2: package.json 加 build:mcp 脚本**

在 `package.json` 的 `scripts` 里，`"mcp:serve": "tsx src/ai-mcp/server.ts",` 下一行加：

```json
    "build:mcp": "node scripts/build-mcp.mjs",
```

- [ ] **Step 3: 执行构建**

Run: `pnpm build:mcp`
Expected: 成功输出 `building sanguosha-mcp@0.1.0` 和 `✓ built → dist/sanguosha-mcp/`；`dist/sanguosha-mcp/` 下出现 `sanguosha-mcp.mjs`、`package.json`、`README.md`。

- [ ] **Step 4: 验证产物正确性**

```bash
head -1 dist/sanguosha-mcp/sanguosha-mcp.mjs && cat dist/sanguosha-mcp/package.json
```
Expected: `.mjs` 首行是 `#!/usr/bin/env node`；`package.json` 含 `"name": "sanguosha-mcp"`、`"bin"`、`"type": "module"`。

- [ ] **Step 5: 冒烟测试 bundle 可独立运行**

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | timeout 5 node dist/sanguosha-mcp/sanguosha-mcp.mjs 2>/dev/null
```
Expected: 输出两条 JSON 响应——id:1 的 `result.capabilities.tools`、id:2 的 `result.tools` 含 `play` 和 `getSkillInfo`。证明单文件 bundle 无外部源码依赖、WS 连接只在 `play` 时触发（initialize/tools/list 不需要服务器）。

- [ ] **Step 6: Commit**

```bash
git add vite.mcp.config.ts scripts/build-mcp.mjs package.json
git commit -m "feat(mcp): 新增 sanguosha-mcp 单文件打包构建

Vite 库模式把 MCP server 入口+内部依赖打进单个 ESM 文件（带 shebang）；
scripts/build-mcp.mjs 生成 package.json/README；新增 build:mcp 脚本。"
```

---

### Task 4: 玩家向 skill sanguosha-play

**Files:**
- Create: `skills/sanguosha-play/SKILL.md`

- [ ] **Step 1: 创建 skills/sanguosha-play/SKILL.md**

> 说明：`name` 必须是 kebab-case 且与目录名一致（`sanguosha-play`）。正文基于实际 MCP 工具形状（`play` / `getSkillInfo`），不虚构工具。

````markdown
---
name: sanguosha-play
description: 用 sanguosha MCP server 驱动三国杀对局——开局、出牌决策、技能/卡牌查询。当用户想通过 AI agent 玩或测试三国杀时使用。
---

# 三国杀 AI 对局 skill

通过 `sanguosha` MCP server 接管一个座次，驱动完整对局：开局 → 选将 → 出牌循环 → 结算。

## 前置：配置 MCP

本 skill 依赖 `sanguosha` MCP server（`npx sanguosha-mcp`）。若尚未配置，参考仓库 README 的「AI agent 接入」章节。核心：设置 `SGS_SERVER_URL` 指向游戏服务器。

## 工具说明

### play（主工具：动作-观察循环）

执行一个操作 → **阻塞等待直到轮到本座次决策或游戏结束** → 返回当前状态 + 可执行操作。无需自己写轮询/sleep。

**入参：**
- `startGame`（仅首次调用）：`true`（debug 房）或 `{ mode: 'multiplayer' | 'debug', roomId?, maxPlayers?, name?, playerId?, readyTimeoutMs? }`。
- `action`（执行操作）：从上次返回的 `availableActions` 取一条，结构 `{ skillId, actionType, ownerId, params, baseSeq }`。省略 = 纯等待。
- `waitTimeoutMs`（可选）：本次等待总超时，默认 120000ms。

**返回：**
- `phase`: `'lobby' | 'playing' | 'ended'`
- `gameOver`: `{ winner } | null`
- `needsAction`: 是否轮到本座次操作
- `view`: 当前座次视角快照（玩家体力/手牌/装备/pending 提示）
- `availableActions`: 可执行操作枚举（`needsAction=true` 时非空），每条含 `description`（人类可读）+ 预填 `message` + `validTargets`（合法目标座次）+ `category`
- `recentEvents`: 自上次以来的事件窗口
- `lastActionResult`: `'accepted' | 'rejected' | 'timeout' | 'not-applicable'`

### getSkillInfo（查询技能/卡牌描述）

**入参：** `{ names: string[] }`（技能/卡牌名，如 `["杀", "制衡", "顺手牵羊"]`）
**返回：** `[{ name, description: string | null }]`（`null` = 查无）

不确定某张牌/技能如何结算时先查。

## 对局流程

1. **开局**：`play({ startGame: true })`（或 `{ startGame: { mode: 'multiplayer', maxPlayers: N } }`）。返回 `phase=lobby` 表示在等开局。
2. **选将**：`needsAction=true` 且 pending 是选将时，从 `availableActions` 选一个角色执行。
3. **出牌循环**：重复 `play({ action: <从 availableActions 选> })`：
   - `needsAction=true` → 从 `availableActions` 选最优操作（补 `targets`）
   - `needsAction=false` → 继续 `play()`（无 action）等待轮到自己
   - `lastActionResult='rejected'` → 操作不合法或 pending 已变，按最新 `availableActions` 重选
4. **结束**：`phase='ended'` + `gameOver.winner`，对局结束。

## 三国杀规则速查

**回合流程**：摸牌阶段（摸 2 张）→ 出牌阶段（默认出杀限 1 次）→ 弃牌阶段（手牌数弃至等于当前体力）。

**基本牌**：杀（对距离内 1 目标造成 1 点伤害，回合限 1 次）、闪（响应杀，免伤害）、桃（濒死自救 +1 体力，或回合内治疗他人 +1）。

**锦囊（常见）**：决斗（轮流出杀，先不出者受伤）、南蛮入侵（全体需出杀否则受伤）、万箭齐发（全体需出闪否则受伤）、无中生有（摸 2 张）、过河拆桥（弃他人 1 张牌）、顺手牵羊（获得距离 1 内他人 1 张牌）、无懈可击（抵消锦囊）、桃园结义（全体 +1 体力）、五谷丰登（亮牌堆顶按人数分配）。

**装备**：武器（增加攻击射程）、防具（如八卦阵可抵消杀）、马（防御马 +1 距离 / 进攻马 -1 距离）。每类装备槽各 1 件。

**身份局目标**：主公+忠臣（消灭反贼与内奸）/ 反贼（消灭主公）/ 内奸（成为最后存活者再击败主公）。

## 决策建议

- **优先级**：自救（濒死出桃）> 输出（杀关键目标）> 过牌（无中生有等）> 控制（拆桥/牵羊）。
- 选操作时读 `availableActions[i].description` 与 `validTargets`，从 `message` 复制并补 `targets`。
- 出杀超次、目标不合法、弃牌不足是常见错误——以服务端返回的 `availableActions` 为准，别自行臆造操作。
````

- [ ] **Step 2: Commit**

```bash
git add skills/sanguosha-play/SKILL.md
git commit -m "feat(skills): 新增玩家向 skill sanguosha-play

教 agent 用 sanguosha MCP server 驱动对局：play 工具动作-观察循环、
getSkillInfo 查询、回合流程与基本牌/锦囊/装备速查、出牌决策建议。"
```

---

### Task 5: 开发 skill 标 internal（排除对外分发）

`npx skills add wmzy/sanguosha` 会扫描 `.claude/skills/`，需让 `add-atom`/`add-skill` 不出现在对外列表。加 `metadata.internal: true`（已核实：Claude Code 运行时忽略此字段，本仓库开发加载不受影响；skills CLI 默认跳过）。

**Files:**
- Modify: `.claude/skills/add-atom/SKILL.md`
- Modify: `.claude/skills/add-skill/SKILL.md`

- [ ] **Step 1: add-atom 加 internal 标记**

在 `.claude/skills/add-atom/SKILL.md` 的 frontmatter，把：

```yaml
---
name: add-atom
description: 添加三国杀引擎的原子操作(atom)。实现 AtomDefinition(validate/apply/toViewEvents/applyView),处理信息分级和等待型 pending。当用户要求添加/创建新的 atom 时使用。
argument-hint: [atom类型名]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git *), Bash(npx tsc *)
---
```

改为（在 `---` 前加 metadata 块）：

```yaml
---
name: add-atom
description: 添加三国杀引擎的原子操作(atom)。实现 AtomDefinition(validate/apply/toViewEvents/applyView),处理信息分级和等待型 pending。当用户要求添加/创建新的 atom 时使用。
argument-hint: [atom类型名]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git *), Bash(npx tsc *)
metadata:
  internal: true
---
```

- [ ] **Step 2: add-skill 加 internal 标记**

在 `.claude/skills/add-skill/SKILL.md` 的 frontmatter，把：

```yaml
---
name: add-skill
description: 添加三国杀技能。读取技能描述文档,分解原子操作和钩子时机,产出契约清单,实现技能代码并独立编写触发测试。当用户要求添加/实现某个武将技能时使用。
argument-hint: [技能名]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git *), Bash(npx tsc *), Bash(npx vitest *)
---
```

改为：

```yaml
---
name: add-skill
description: 添加三国杀技能。读取技能描述文档,分解原子操作和钩子时机,产出契约清单,实现技能代码并独立编写触发测试。当用户要求添加/实现某个武将技能时使用。
argument-hint: [技能名]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git *), Bash(npx tsc *), Bash(npx vitest *)
metadata:
  internal: true
---
```

- [ ] **Step 3: 验证 frontmatter 仍是合法 YAML + 本仓库 Claude Code 可见**

人工确认两个文件 `---` 块完整、缩进 2 空格。本仓库 Claude Code skills 列表仍应显示 add-atom/add-skill（internal 字段被运行时忽略）。

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/add-atom/SKILL.md .claude/skills/add-skill/SKILL.md
git commit -m "chore(skills): 开发 skill 标 metadata.internal 排除对外分发

add-atom/add-skill 是引擎开发技能，外部玩家用不上。标 internal 后
npx skills 默认跳过；Claude Code 运行时忽略此字段，本仓库开发不受影响。"
```

---

### Task 6: README「AI agent 接入」章节

**Files:**
- Modify: `README.md`（文件末尾「环境变量」章节后追加）

- [ ] **Step 1: 在 README 末尾追加新章节**

在 `README.md` 末尾（「环境变量」表格之后）追加：

````markdown

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
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): 新增 AI agent 接入章节

跨 agent MCP 配置（Claude Code/Cursor/Windsurf/Codex）、
npx skills 安装玩家向 skill、SGS_SERVER_URL 等环境变量说明。"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 全量 typecheck + 构建**

Run: `pnpm typecheck && pnpm build:mcp`
Expected: 全部通过，`dist/sanguosha-mcp/sanguosha-mcp.mjs` 生成。

- [ ] **Step 2: bundle 端到端（连本机服务器）**

一个终端起服务器：`pnpm dev`（后台运行，监听 3930）。另一个终端：

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | SGS_SERVER_URL=ws://localhost:3930/ws timeout 8 node dist/sanguosha-mcp/sanguosha-mcp.mjs 2>/dev/null
```
Expected: 两条 JSON 响应，tools/list 含 `play`、`getSkillInfo`。证明发布的 bundle 在注入公开服务器 URL 后也能按 env 覆盖连本机。

- [ ] **Step 3: 验证 npx skills 发现列表（需网络）**

> 需联网下载 `skills` 包。遇网络问题设代理端口 7890（`HTTP_PROXY`/`HTTPS_PROXY`）。

```bash
npx -y skills@latest add ./ --list
```
Expected: 列出 `sanguosha-play`；**不**列出 `add-atom`、`add-skill`（被 internal 过滤）。

- [ ] **Step 4: 验证注入公开 URL 默认值**

```bash
SGS_PUBLIC_URL=wss://example.com/ws pnpm build:mcp >/dev/null 2>&1
grep -c "example.com/ws" dist/sanguosha-mcp/sanguosha-mcp.mjs
```
Expected: 输出 `1` 或更多（`__SGS_DEFAULT_URL__` 被替换为注入值）。再跑默认构建恢复：`pnpm build:mcp`。

- [ ] **Step 5: 无新增 commit（验证步骤，产物不入库）**

若以上任一不通过，回到对应 Task 修复。

---

## 完成定义

- [x] `pnpm build:mcp` 产出可独立运行的 `sanguosha-mcp.mjs`（shebang + 单文件）
- [x] bundle 的 initialize/tools/list 冒烟通过
- [x] `SGS_PUBLIC_URL` 注入默认值生效
- [x] `skills/sanguosha-play/SKILL.md` 存在且 `npx skills add ./ --list` 只列它
- [x] `add-atom`/`add-skill` 标 internal 后本仓库 Claude Code 仍加载
- [x] README「AI agent 接入」覆盖 4 个 agent + skill 安装 + 环境变量
