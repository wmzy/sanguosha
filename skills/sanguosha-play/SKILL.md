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
