---
name: sanguosha-play
description: 三国杀（Sanguosha）对局 AI 技能。通过 MCP play 工具驱动一个座次：加入房间、开局、出牌决策、回应询问。适用于人机对局或机机对局。当用户想和 AI 一起打三国杀、或让 AI 参与房间游戏时使用。
argument-hint: [房间码 或 留空建房]
allowed-tools: mcp__sanguosha__play, mcp__sanguosha__getSkillInfo, Read
---

# 三国杀对局技能（sanguosha-play）

你通过 MCP `play` 工具驱动三国杀中的一个座次（座位），与人类玩家或其他 AI 同房对局。

## 一、启动流程

首次调用 `play` 时传 `startGame` 参数开局：

- **加入指定房间**（人类已建房）：`{ "startGame": { "mode": "multiplayer", "roomId": "ABC123" } }`
- **自建房间等待**（你做房主，等人类加入）：`{ "startGame": { "mode": "multiplayer", "maxPlayers": 2 } }`
- 可选字段：`playerId`（指定玩家 id，否则自动生成）、`name`（建房时房间名）、`readyTimeoutMs`（等待全员就绪超时，默认 300000ms）。

返回的 `result` 中会包含 `roomId`（房间码）。如果你是房主，把房间码告诉人类，人类在浏览器 `/play` 页面输入即可加入。

**循环决策**：开局后持续调用 `play`（不带 `action` = 纯等待，直到 `needsAction=true` 或 `gameOver`）。

> **查询技能/卡牌效果**：随时可调用 `getSkillInfo` 工具查询某个技能或卡牌的描述。
> 入参 `{ "names": ["杀", "制衡", "顺手牵羊"] }`，返回每个名称的效果文案（查无则 description 为 null）。
> 当 `view` 中出现你不熟悉的技能/卡牌、或不确定如何结算时，用它理解规则，无需消耗回合。

## 二、play 工具返回结构

```jsonc
{
  "phase": "lobby" | "playing" | "ended",
  "gameOver": { "winner": "主公阵营" } | null,   // 非 null 表示游戏结束
  "needsAction": true,                            // true=轮到你决策
  "view": {                                       // 当前局面投影（仅自己可见信息）
    "viewer": 0,                                  // 你的座次
    "currentPlayerIndex": 0,                      // 当前出牌玩家
    "turn": { "round": 1 },
    "players": [{ "index": 0, "name": "P0", "character": "刘备",
                  "health": 4, "maxHealth": 4, "alive": true,
                  "handCount": 4, "hand": [...],  // 仅自己手牌可见
                  "skills": ["仁德"], "identity": "主公" }],
    "pending": { "target": 0, "isBlocking": true,
                 "promptTitle": "请出牌", "requestType": "__出牌",
                 "candidates": null } | null,
    "zones": { "deckCount": 120, "discardPileCount": 0 },
    "log": [{ "time": 100, "player": 0, "text": "P0 摸了2张牌" }]
  },
  "availableActions": [                           // 可执行操作列表
    { "description": "使用【杀】(♠5) 选择目标",
      "message": { "skillId": "杀", "actionType": "use", "ownerId": 0,
                   "params": { "cardId": "c1" }, "baseSeq": 0 },
      "validTargets": [1, 2, 3],
      "category": "play" }
  ],
  "recentEvents": [...],                          // 上次以来的事件
  "lastActionResult": "accepted"                  // accepted/rejected/timeout/not-applicable
}
```

## 三、决策策略（按 category 分流）

当 `needsAction=true` 时，从 `availableActions` 中选一条，按 `category` 处理：

| category | 含义 | 如何提交 |
|---|---|---|
| `selectChar` | 开局选将 | `message.params.character` 已填好，直接回传整个 message |
| `play` | 主动出牌/用技 | 若 `validTargets` 非空，选一个目标填入 `message.params.targets`（数组）；否则直接回传 |
| `respond` | 回应询问（出闪等） | 直接回传 message；想放弃则不传 action（或传空 respond） |
| `discard` | 弃牌阶段 | 选超出的牌填入 `message.params.cardIds`（数组） |
| `transform` | 转化出牌（武圣/丈八蛇矛） | 按描述选牌回传 |
| `distribute` | 分配牌（遗计/仁德） | 按描述分配 |

**提交方式**：下次调用 `play` 时传 `{ "action": <选中的 message> }`。

### 决策要点

1. **选将**：从候选武将中选一个（优先选技能强力的，如张飞/甄姬）。
2. **出牌阶段**：手中有【杀】且有距离内目标时优先出杀；有桃且自己残血时可回血；用锦囊（顺手牵羊/过河拆桥）干扰对手。
3. **被杀攻击**：手中有【闪】则打出（respond）；残血保命优先。
4. **弃牌阶段**：保留杀/桃/无懈可击，弃掉多余的牌，使手牌数 ≤ 当前体力。
5. **无操作**：`availableActions` 为空或你想跳过时，省略 `action` 参数纯等待。

## 四、三国杀身份局规则速查

### 身份与阵营
- **主公**：公开身份，目标消灭所有反贼和内奸。
- **忠臣**：隐藏身份，保护主公，与主公共胜。
- **反贼**：隐藏身份，杀死主公即胜。
- **内奸**：隐藏身份，成为最后存活的非主公角色后单挑主公取胜。

人数与身份配比：5人局=1主公2忠臣1反贼1内奸；8人局=1主公2忠臣4反贼1内奸。

### 回合阶段（每个玩家轮到时）
1. **判定阶段**：处理延时锦囊（闪电/乐不思蜀）的判定。
2. **摸牌阶段**：从牌堆摸 2 张牌（部分技能可改变）。
3. **出牌阶段**：可出牌/用技能，受攻击距离限制。每回合通常只能出 1 次【杀】。
4. **弃牌阶段**：手牌数若超过当前体力值，须弃至等于体力值。
5. **结束阶段**。

### 核心牌型
| 牌 | 类型 | 作用 |
|---|---|---|
| 杀 | 基本牌 | 对距离内目标造成1点伤害，目标需出【闪】躲避。每回合通常限1次 |
| 闪 | 基本牌 | 抵消杀 |
| 桃 | 基本牌 | 回复1点体力（自己/濒死角色），或濒死时救己 |
| 顺手牵羊 | 锦囊 | 获得距离1内目标的一张牌（手牌或装备） |
| 过河拆桥 | 锦囊 | 弃置任意目标的一张牌 |
| 决斗 | 锦囊 | 与目标轮流出杀，先不出杀的受1点伤害 |
| 南蛮入侵 | 锦囊 | AOE，其他人须出杀否则受1点伤害 |
| 万箭齐发 | 锦囊 | AOE，其他人须出闪否则受1点伤害 |
| 桃园结义 | 锦囊 | 所有角色回复1点体力 |
| 无懈可击 | 锦囊 | 抵消一张锦囊（广播型，可被打断） |
| 闪电 | 延时锦囊 | 判定若为黑桃2-9则该角色受3点伤害 |
| 乐不思蜀 | 延时锦囊 | 判定若非红桃则该角色跳过出牌阶段 |

### 距离规则
- 默认攻击距离 1（只能打相邻座次）。
- 装备【武器】增加攻击距离（如诸葛连弩1、青釭剑2）。
- 装备【进攻马 -1】减少与他人的距离（更易打到远处）。
- 装备【防御马 +1】增加他人与你距离（更难被打到）。

## 五、注意事项

- `lastActionResult: "rejected"` 表示你的操作被服务端拒绝（非法目标/时机），重新选择。
- `lastActionResult: "timeout"` 表示你决策太慢被服务端超时处理，尽快响应。
- 你只能看到自己的手牌（`view.players[viewer].hand`），他人只有 `handCount`。
- 广播型询问（如无懈可击）`pending.target < 0`，任何玩家都可回应。
- 游戏结束（`gameOver` 非 null）后停止调用 play。

## 六、示例：完整一次决策循环

```
1. play({ startGame: { mode: "multiplayer", roomId: "X7K2M9" } })
   → 返回 phase=lobby，等待开局（人类加入并准备）

2. play({})  // 纯等待
   → 返回 needsAction=true, availableActions=[选将候选], pending.candidates=[刘备,张飞...]

3. play({ action: { skillId:"系统规则", actionType:"选将", ownerId:0, params:{character:"张飞"}, baseSeq:0 } })
   → lastActionResult=accepted

4. play({})  // 等待 → 轮到你出牌
   → needsAction=true, availableActions=[{category:"play", description:"使用【杀】", validTargets:[1]}]

5. play({ action: { skillId:"杀", actionType:"use", ownerId:0, params:{cardId:"c3", targets:[1]}, baseSeq:0 } })
   → 攻击 1 号座次
```
