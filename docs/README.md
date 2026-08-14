# 三国杀文档导航

本目录是项目所有设计、架构、规则与开发指南的入口。按**「你想做什么」**找到该读的文档。

## 目录结构

```
docs/
├── README.md            ← 你在这里：导航索引
├── architecture/        ← 引擎与系统架构（权威设计）
├── guides/              ← 开发操作指南（how-to）
├── research/            ← 规则与资料（技能/卡牌实现的事实来源）
├── design/              ← 交互与视觉设计
├── testing/             ← 测试方案与框架
├── decisions/           ← 架构决策记录（ADR）
├── superpowers/         ← 历史实施计划（plans）与设计稿（specs）
├── card-refs/           ← 卡牌参考图
├── api.md               ← 服务端 API 协议（REST/SSE/WebSocket）
└── _archive/            ← 已归档：被取代或过时的旧稿
```

## 快速入口

| 我想…… | 读这个 |
|---|---|
| **理解引擎整体架构** | [architecture/引擎架构.md](architecture/引擎架构.md)（唯一权威终稿） |
| **出牌/伤害/判定等流程的时序模型** | [architecture/出牌流程重设计.md](architecture/出牌流程重设计.md) |
| **加一个武将技能** | [guides/添加技能.md](guides/添加技能.md) + [research/武将技能/](research/武将技能/) 下对应武将 |
| **加一个原子操作（atom）** | [guides/添加atom.md](guides/添加atom.md) |
| **查某个技能/卡牌的官方规则** | [research/武将技能.md](research/武将技能.md) · [research/卡牌信息.md](research/卡牌信息.md) · [research/基础规则.md](research/基础规则.md) |
| **写技能测试** | [testing/技能测试框架.md](testing/技能测试框架.md) |
| **接前后端协议** | [api.md](api.md) |
| **查某次架构决策的来龙去脉** | [decisions/](decisions/)（按编号 ADR） |

## 各目录说明

### architecture/ — 引擎与系统架构
权威设计文档。**以 `引擎架构.md` 为准**，它是引擎的「最终设计，不含历史变更」。
- [引擎架构.md](architecture/引擎架构.md) — 引擎终态设计：三层模型、技能 API、Atom、结算帧、等待型 pending、GameView。
- [出牌流程重设计.md](architecture/出牌流程重设计.md) — 伤害/死亡/判定/摸弃/移动/拼点等流程的编排时机（模块 A–M）与时序契约。
- [日志与重播.md](architecture/日志与重播.md) — 日志与回放设计（部分过时，回放部分已被 [superpowers/specs/2026-07-09-replay-download-design.md](superpowers/specs/2026-07-09-replay-download-design.md) 取代）。

### guides/ — 开发操作指南
手把手 how-to。agent skill（`.claude/skills/`）与这些指南配套使用。
- [添加技能.md](guides/添加技能.md) — 从规则描述到 SkillDef 实现的完整流程。
- [添加atom.md](guides/添加atom.md) — 新增原子操作的规范与提示词。

### research/ — 规则与资料（事实来源）
技能/卡牌实现的**唯一事实来源**。`add-skill` / `add-atom` agent 与 `src/engine/skills/*.ts` 直接引用本目录。
- [基础规则.md](research/基础规则.md) — 三国杀标准版完整规则。
- [卡牌信息.md](research/卡牌信息.md) — 标准版 + 军争篇全部卡牌信息。
- [武将技能.md](research/武将技能.md) — 武将技能框架总览（165 将：标准版 76 + 界限突破 89）。
- [武将技能/](research/武将技能/) — 按势力（魏/蜀/吴/群/晋/神）分目录的逐将技能描述文件。
- [引擎需求.md](research/引擎需求.md) — 引擎需支持的机制清单（触发时机、响应窗口、判定等）。
- [使用和打出.md](research/使用和打出.md) — 「使用」与「打出」的规则区分。

### design/ — 交互与视觉设计
- [游戏设计.md](design/游戏设计.md) — 游戏总体设计（技术栈、架构、武将/牌范围）。
- [选将交互设计.md](design/选将交互设计.md) — 选将阶段的交互流程。
- [三国杀UI参考设计指南.md](design/三国杀UI参考设计指南.md) — UI 视觉参考。

### testing/ — 测试
- [技能测试框架.md](testing/技能测试框架.md) — SkillTestHarness 设计：真实引擎 + 虚拟前端 + 事件流桥接，无需 DOM。

### decisions/ — 架构决策记录（ADR）
按编号排列的决策记录（ADR 0008–0030，其中 0019–0024 跳过，见 [缺号说明](decisions/0019-0024-skipped.md)）。每条记录背景、决策、后果、验证与改动文件。新决策继续追加编号。

### superpowers/ — 历史实施计划与设计稿
- [plans/](superpowers/plans/) — 已执行的实施计划（日期命名）。
- [specs/](superpowers/specs/) — 对应的设计稿。

> 这些是工作过程文档，记录「当时怎么做的」。理解现状优先看 `architecture/` 和 `decisions/`。

### _archive/ — 已归档
被取代或过时的旧稿，保留作历史参考，**不再维护**：
- `引擎架构设计-旧.md` — 被 `architecture/引擎架构.md` 取代。
- `测试方案-旧.md` — 早期浏览器自动化测试报告（API 已大改）。
- `测试与架构规范-旧.md` — 早期测试/Handler 规范蓝图（部分未实现）。
- `bug覆盖分析-旧.md` — 早期测试缺口分析。

## 约定
- 设计/规则文档用中文命名；工具/协议文件用英文（详见根目录 `CLAUDE.md` 命名规则）。
- 新增权威设计入 `architecture/`；新增 how-to 入 `guides/`；过程产物入 `superpowers/`；过时文档移 `_archive/` 并加 `-旧` 后缀。
