# AI 对局接入、信息范围与归档

## 启动

需要已有依赖、Node 22+ 和 pnpm。两个终端分别运行：

```powershell
pnpm dev
pnpm arena configs/arena.gemini.json
```

运行器输出对局 ID、房间码和观众页。也可直接打开 `http://localhost:3930/arena` 查看所有归档及正在进行的对局。

可用示例：

| 配置 | 用途 |
| --- | --- |
| `configs/arena.smoke.json` | 五名启发式基线完成一局，不调用付费模型 |
| `configs/arena.gemini.json` | Gemini 3.8 Flash 与基线对局 |
| `configs/arena.gemma.json` | Gemma 4 与基线对局，给较长思考时间 |
| `configs/arena.example.json` | 五人局模板，含 Gemini、兼容 API、MCP 和基线，先填写模型 ID |

API 密钥只从配置的 `apiKeyEnv` 环境变量读取，不写入配置。若 Windows 用户级变量已经存在，而当前终端尚未继承：

```powershell
$env:GEMINI_API_KEY = [Environment]::GetEnvironmentVariable('GEMINI_API_KEY', 'User')
pnpm arena configs/arena.gemini.json
```

每名玩家可以单独设置 `api.model`、`api.baseUrl`、`api.apiKeyEnv`、`api.protocol`、`persona`。`openai-compatible` 使用 `<baseUrl>/chat/completions`，可指向 DeepSeek 等兼容服务；`gemini` 使用原生 generateContent。模型 ID 以所用账号实际可用列表为准。

`timeoutSec` 是游戏服务端操作时限；`decisionTimeoutMs` 是 API 调用上限。默认候选动作由模型自主选择；调用失败或模型返回不合法动作时，本次用启发式兜底，并在私有日志标记 `source: fallback` 和错误原因。`mode: heuristic` 是明确配置的基线，不计为真实模型。

## AI 与观众分别看见什么

| 内容 | 本人 AI | 其他 AI | 观众页 |
| --- | --- | --- | --- |
| 自己的手牌 | 是 | 否，只有手牌数 | 全场所有手牌 |
| 自己的身份 | 是 | 主公或已死亡时才可见 | 主公或已死亡时才可见 |
| 血量、公开武将/技能、势力、装备、判定区、距离、回合用量 | 是 | 是 | 展示主要牌桌信息 |
| 公开展示、判定和公共发言 | 是 | 是 | 是 |
| 观星等私密观看/整理牌堆 | 仅操作者 | 否 | 不显示私密看牌面板 |
| 未观察到的牌堆顺序 | 否 | 否 | 否 |
| memory 和简短策略说明 | 仅自己上下文 | 否 | 不读取；保存在本机独立文件 |

观众端通过显式 `buildAudienceView` 生成，独立于玩家视图；不会把全手牌观众快照作为模型输入。正常玩家与普通旁观协议没有改成全知模式。

`observation.visibleCards` 的每组牌面带 `visibility: private/public` 及来源。观星、界观星、界恂恂的完整提示和对应牌面仅送到操作者。`params.top[0]` 是最先摸到的牌，`top` 与 `bottom` 必须无重复地划分已观看牌；界恂恂默认保留两张在顶。公开展示/判定的牌面还会保留在最近的可见事件里，不依赖那张牌是否仍在处理区。

## 独立上下文

每名 API 玩家持有自己的 `ArenaPlayerSession`，输入包括：

- 本座次的当前观察、私密技能提示及牌面；
- 最近 80 条本座次合法可见事件、最近 40 条公共聊天；
- 自己的持续记忆、最近 4 轮精简决策记录和相关卡牌/技能说明。

不同玩家不会共享历史消息、持续记忆或策略日志。模型输出的 `memory` 是替换后的持续摘要，适合保留阵营推测、计划和重要历史，不需要复述整场状态。`strategySummary` 是模型明确输出的简短决策说明，不代表获取模型内部推理链。

动作菜单会给仁德、制衡、遗计等动作补可执行的最小默认值，并在 `selection` 列出可选牌 ID、分配目标与数量范围。AI 可以直接选编号，也可以覆盖 `allocation` 或 `cardIds` 自行选择；不会把其他玩家未公开的手牌当成候选。

## MCP 选手

将某个座位设为 `mode: mcp` 后，运行器会为该座位生成：

```text
data/arena/<matchId>/mcp/<playerId>/
  mcp.json       MCP 进程配置，包含该座位的游戏会话
  join.json      房间参数和参赛提示
```

把生成的 MCP 配置加载到外部 agent，再让它按 `join.json` 调用 `joinRoom`。管理器等所有选手就绪后开局；外部 MCP 进程只操作自己的座位，可以与 API 选手混合参赛，也可以全部使用 MCP。

调用循环：

1. `joinRoom({ roomId: "房间码" })`。
2. `play({})` 等待自己的决策点。
3. 从返回的 `observation.actions` 选择 `actionId`，下一次提交：

```json
{
  "decisionId": "上次 observation.decisionId",
  "actionId": "a0",
  "params": { "targets": [2] },
  "memory": "自己的阵营推测与后续计划",
  "strategySummary": "这次选择的简短理由",
  "publicSpeech": "可选的公开发言"
}
```

4. 继续直到 `gameOver` 非空。`staleDecision: true` 表示思考期间响应窗口已变化，改用新观察重选。

旧的 `play({action: ...})` 仍可使用。真实 MCP 入口会建立私有归档；在 arena 模式下不会向模型推荐启发式动作。外部 agent 本身也应使用独立会话，只使用本座次 MCP 工具，不读取其他选手文件或观众接口。

## 归档文件

```text
data/arena/<matchId>/
  manifest.json               状态、模型、起止时间、胜方或中止原因
  config.json                 对局配置，只有密钥环境变量名
  public.jsonl                普通旁观视角的公开状态和事件
  chat.jsonl                  完整公共聊天增量
  chat.json                   最近公共聊天，供观众页展示
  audience.jsonl              带全局 seq/时间的观众帧
  audience.json               当前或最终观众帧
  replay.json                 全座次引擎录像，正常终局或主动中止后导出
  result.json                 正常终局的服务端结果条目
  players/<playerId>/
    observations.jsonl        每次决策时本玩家实际可见的输入
    decisions.jsonl           动作、说明、记忆、来源、结果、耗时和用量
    context.json              当前私有记忆与精简上下文
    errors.jsonl              连接/动作错误（如有）
```

这些目录独立于 `data/history`，不随普通房间历史保留数量或房间删除而清理。选将尚未完成便取消时，没有可回放基线，仍保存已有日志与中止原因。需要自定义根目录时，在服务器和运行器进程设置相同的 `SGS_ARENA_DIR`，以便观众页读取同一位置。

Arena 使用普通规则的快速房间，由独立目录保存素材，不写重启后自动续局的房间快照；服务器重启后从归档查看已保存内容，当前局不会自动续打。

`Ctrl+C`、`maxDurationMs` 或 `maxDecisions` 可中止运行。已开局的中止对局也会导出当时录像。

## 演武场牌桌

打开 `/arena` 进入观战大厅，或 `/arena/<matchId>` 直达对局。牌桌使用水墨竹林背景、金属武将框、体力珠与实体卡面，支持 2–8 人围桌。各席手牌向观众公开；点击武将、手牌或「展开」可放大查看完整手牌。主公明置，其他身份仅在死亡后显示。中央牌堆仅显示牌背及数量。

顶栏可以打开对局归档、公共发言和战报；「纯净观战」淡化工具栏，移到顶栏可恢复操作，也可以进入全屏。窄屏采用与正常游戏一致的整体等比缩放，建议横屏或桌面观看，手牌详情会按屏幕宽度换行。

本机资源已安装。新环境运行 `npm run arena:assets`，从固定的 QSanguosha-v2 commit 安装 31 张标准/风包立绘、43 张通用牌图与桌面背景。脚本保留现有资源条目与文件；精确花色/点数的自定义卡面仍优先。通用牌图由界面叠加本张牌的花色与点数，火杀、雷杀使用各自牌面。未安装的扩展武将仍显示可读的文字牌框。

第三方图片位于被 Git 忽略的 `public/packs/base/`；来源、固定版本及上游原文 LICENSE/MCFR 在该目录留存。脚本没有把程序许可证解释为美术素材授权，也没有将图片纳入源码提交；公开分发或商业使用前须另外核对素材使用权限。

## 验证命令

以下集成验证需要先启动 `pnpm dev`：

```powershell
pnpm arena:smoke
pnpm exec tsx scripts/verify-arena-mcp.ts
pnpm exec tsx scripts/verify-arena-interrupt.ts
node scripts/verify-arena-browser.mjs
```

MCP 验证启动真实的独立 stdio 进程，但由脚本从动作菜单选择，用于验证通路，不是大模型能力评测。真实 API 协议小样检查：

```powershell
pnpm exec tsx scripts/probe-arena-model.ts gemini-3.8-flash
```

本轮不包含视频、配音与导演时间线制作；现有录像和分层日志可作为后续素材。

