你要加入或创建一个三国杀房间，并与人类玩家对局。请按以下流程操作。

## 解析参数

用户输入：`$ARGUMENTS`

- 如果提供了房间码（如 `X7K2M9`）：**加入模式**，目标是加入该房间。
- 如果为空：**建房模式**，你作为房主创建房间，等待人类加入。

## 执行步骤

### 第一步：开局

调用 MCP 工具 `play`（来自 sanguosha server），传入 `startGame`：

- **加入模式**（有房间码）：`{ "startGame": { "mode": "multiplayer", "roomId": "<房间码>" } }`
- **建房模式**（无房间码）：`{ "startGame": { "mode": "multiplayer", "maxPlayers": 2 } }`

### 第二步：告知房间码（仅建房模式）

建房成功后，从 `play` 返回结果中读取 `roomId`，明确告诉用户：

> 房间已创建，房间码是 **XXXXXX**。请人类玩家在浏览器打开 `/play` 页面，输入此房间码加入并点击「准备」。

### 第三步：等待开局

建房模式下，人类加入并双方「准备」后游戏自动开始。持续调用 `play({})`（纯等待）直到返回的 `phase` 变为 `playing` 或 `gameOver` 非 null。

### 第四步：对局决策

游戏开始后，进入决策循环。参考 `sgs-play` 技能（三国杀对局技能）中的决策策略：

1. 调用 `play({})` 等待，直到 `needsAction=true`。
2. 从返回的 `availableActions` 中选择一条操作：
   - `selectChar`：选将（`params.character` 已填，直接回传）
   - `play`：主动出牌（有 `validTargets` 时选一个填入 `params.targets`）
   - `respond`：回应询问（出闪等，或放弃）
   - `discard`：弃牌（选牌填入 `params.cardIds`）
3. 用选中的 `action`（即那条 message）再次调用 `play`。
4. 重复直到 `gameOver` 非 null。

### 决策原则

- 优先保命：被杀时若有闪则出闪；残血时用桃回血。
- 合理进攻：有杀且有距离内目标时优先出杀；用顺手牵羊/过河拆桥干扰对手。
- 弃牌保质量：弃牌阶段保留杀/桃/无懈，弃多余牌使手牌 ≤ 体力。
- 非法操作重试：若 `lastActionResult` 为 `rejected`，换一个合法操作。

### 第五步：结算

`gameOver` 非 null 时，报告胜方，结束对局。

## 注意

- 三国杀身份局规则：主公+忠臣 vs 反贼 vs 内奸。先确认自己的 `identity` 再制定策略。
- 你只能看到自己的手牌，他人只有数量。谨慎判断。
- 若 `lastActionResult` 为 `timeout`，说明你响应太慢，下次尽快。
