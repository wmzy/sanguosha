---
name: sanguosha-play
description: 三国杀（Sanguosha）对局 AI 技能。通过 MCP play 工具驱动一个座次：加入房间、开局、出牌决策、回应询问。适用于人机对局或机机对局。当用户想和 AI 一起打三国杀、或让 AI 参与房间游戏时使用。
argument-hint: [房间码 或 留空建房]
allowed-tools: mcp__sanguosha__play, mcp__sanguosha__createRoom, mcp__sanguosha__joinRoom, mcp__sanguosha__getSkillInfo, Read
---

# 三国杀对局技能（sanguosha-play）

你通过 MCP `play` 工具驱动三国杀中的一个座次（座位），与人类玩家或其他 AI 同房对局。

## 一、启动流程

首次调用必须先用一个启动工具建/加入房间（三选一，同一 MCP 连接只能调一次）：

- **加入指定房间**（人类已建房，或另一个 AI 已建房）：
  ```
  joinRoom({ roomId: "ABC123" })   // roomId 必填——从对话、/play 命令参数或房主分享获取
  ```
- **建房做房主**（你建房、发准备、等他人加入；房间码会返回在 result.roomId 里）：
  ```
  createRoom({ maxPlayers: 2 })
  ```
- **旁观**（不占座次）：`spectateRoom({ roomId: "ABC123" })`

可选字段：`playerId`（指定玩家 id，否则服务端自动生成）、`name`（建房时房间名）、`timeoutSec`（操作倒计时秒数，30=默认，0=无限等待）。

返回结构：`{ ok, roomId, playerId, isHost, joinedAs: "host"|"guest"|"spectator", phase }`。**如果 `joinedAs` 与你本意不符（比如本该加入却变 host），说明选错工具——下次启动前重启 MCP 连接重试。**

你是房主时，把 `result.roomId` 告诉人类，人类在浏览器 `/play` 页面输入即可加入。

**循环决策**：启动后持续调用 `play`（不带 `action` = 纯等待 / 推进 lobby→playing，直到 `needsAction=true` 或 `gameOver`）。

> ⚠️ **不要**直接调用 `play` 而不先启动——会返回 `-32602` 错误。
> ⚠️ **不要**在 `joinRoom` 里漏 `roomId`——schema 层 required，MCP client 会拦下。

> **查询技能/卡牌效果**：随时可调用 `getSkillInfo` 工具查询某个技能或卡牌的描述。
> 入参 `{ "names": ["杀", "制衡", "顺手牵羊"] }`，返回每个名称的效果文案（查无则 description 为 null）。
> 当 `view` 中出现你不熟悉的技能/卡牌、或不确定如何结算时，用它理解规则，无需消耗回合。

## 二、play 工具返回结构

```jsonc
{
  "phase": "lobby" | "playing" | "ended",
  "gameOver": { "winner": "主公阵营" } | null,   // 非 null 表示游戏结束
  "needsAction": true,                            // true=轮到你决策
  "isHost": true,                                 // 是否房主（选错工具时自检用）
  "joinedAs": "host" | "guest" | "spectator" | null,  // 实际生效身份
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
      "maxTarget": 1,                             // 目标数上限(方天画戟/天义/界疠火放宽;未设默认 1)
      "category": "play" }
  ],
  "recentEvents": [...],                          // 上次以来的事件
  "lastActionResult": "accepted"                  // accepted/rejected/timeout/not-applicable
}
```

## 三、决策策略

当 `needsAction=true` 时，**先执行「决策四步法」**，再用 category 分流提交。

### 决策四步法（每次 needsAction=true 必做）

**第 1 步 · 盘点技能与可行动作**
- 读 `view.players[viewer].skills` —— 这是**你武将的全部技能名**（如 `["咆哮"]`、`["制衡","救援"]`）。
- 读 `availableActions[].message.skillId` 与 `.description` —— 这是**此刻真正能执行的动作**。`skillId` 不只是"杀/闪"，**武将技能也会作为 skillId 出现**（如 `制衡`、`苦肉`、`反间`）。
- 对齐两者：我的哪些技能本回合可发动？

**第 2 步 · 理解陌生技能（调用 getSkillInfo，不消耗回合）**
- 凡是不熟悉的技能名，**立即** `getSkillInfo({ names: [...] })` 查效果与触发条件。宁可多查一次，也不要盲目跳过自己的技能。
- 重点分清：是**主动发动**（出牌阶段出现在 availableActions）还是**触发型**（满足条件才出现询问）？

**第 3 步 · 判断敌我**（见下方「身份局配合策略」）
- 确定你的身份、本回合该打谁/保谁。**绝不可无脑攻击相邻座次**——那可能是队友。

**第 4 步 · 选择最优动作**
- 优先级：**推进身份目标的技能/牌 > 基本牌 > 凑数**。能用武将技能扩大优势或配合队友时，优先用技能，而不是只出杀。

### category 分流表

| category | 含义 | 如何提交 |
|---|---|---|
| `selectChar` | 开局选将 | `message.params.character` 已填好，直接回传整个 message |
| `play` | 主动出牌/用技 | 若 `validTargets` 非空，选 1~`maxTarget` 个目标填入 `message.params.targets`（数组，`maxTarget` 未设默认 1，如方天画戟最后一张手牌时为 3）；否则直接回传 |
| `respond` | 回应询问（出闪等） | 直接回传 message；想放弃则不传 action（或传空 respond） |
| `discard` | 弃牌阶段 | 选超出的牌填入 `message.params.cardIds`（数组） |
| `transform` | 转化出牌（武圣/丈八蛇矛） | 按描述选牌回传 |
| `distribute` | 分配牌（遗计/仁德） | 按描述分配 |

**提交方式**：下次调用 `play` 时传 `{ "action": <选中的 message> }`。

### 武将技能使用指引

技能是武将的核心战力，**比无脑出杀更重要**。按类型处理：

| 技能类型 | 识别方法 | 使用原则 |
|---|---|---|
| **主动技能**（制衡/苦肉/反间/结姻等） | 出牌阶段出现在 availableActions，skillId=技能名 | 每回合**主动评估发动**。如制衡几乎总要发动（弃差牌换新牌）；苦肉在队友能补牌或急需牌时发动。 |
| **触发/被动技能**（反馈/刚烈/天妒等） | 满足条件时自动出现询问 | availableActions 一旦出现就**优先响应**，这是白嫖的收益。 |
| **转化型技能**（武圣/丈八蛇矛/龙魂） | category=`transform` | 把非杀牌转成杀，扩大输出，不浪费多余牌。 |
| **分配型技能**（仁德/遗计/反间分牌） | category=`distribute` | **把牌给最需要的队友**（残血/即将行动的友军），而非自己留着。 |
| **激活型 buff**（咆哮=无限出杀 等） | 持续生效，改变规则 | 记住它放宽的限制（咆哮下每回合可多次出杀，别只出一次）。 |
| **救援型技能**（急救/青囊） | 队友濒死询问时出现 | 队友濒死优先救（见配合）。 |

> **关键习惯**：每个自己的回合开始，先扫一遍 `availableActions` 里有没有 skillId 是**你自己技能**的条目——这是 AI 最容易漏掉的高价值动作。把"用技能"当作第一本能，出杀是兜底。

### 身份局配合策略

主公身份公开，其余身份仅自己可见。**队友靠行为推断**：

| 你的身份 | 队友 | 核心目标 | 配合动作 |
|---|---|---|---|
| **主公** | 忠臣（隐藏） | 存活到最后 | 先观望识别反贼（攻击你的即反贼）。**切勿误杀忠臣**（忠臣阵亡时你须弃光手牌）。 |
| **忠臣** | 主公 + 其他忠臣 | 保护主公 | 集火暴露的反贼；**主公濒死必救桃**；为拆除反贼武器、为其挡刀。 |
| **反贼** | 其他反贼 | 杀死主公 | **集火主公**（同阵营集中打同一目标）；队友濒死救桃；用顺手/拆桥破坏主公防具。 |
| **内奸** | 早期无固定队友 | 成为最后与主公单挑者 | 坐山观虎，令反贼与忠臣互耗；谁强压谁；留桃自保。 |

**敌我识别信号**（从 `view.log` 与 recentEvents 推断）：
- 攻击主公的 → 大概率反贼。
- 攻击反贼、保护主公的 → 大概率忠臣。
- 攻击你的（你是反贼）→ 大概率忠臣/内奸。
- 用桃救你的（你是非主公）→ 大概率同阵营。

**濒死救援的身份判断**（最关键的一次配合）：
当 pending 询问"是否出桃/技能救某濒死角色"时，**先判断该角色是不是队友**：
- **队友濒死 → 必救**（最直接的配合）。
- **敌人濒死（你视角下的敌方角色）→ 不救**，任其阵亡。
- 中立/不确定 → 看局势，残局可救以制衡强者。

**集火原则**：反贼应优先攻击**主公**（胜负条件），而非分散打忠臣；忠臣应优先击杀对主公威胁最大的反贼。无懈可击优先保护队友的关键锦囊、或反制敌方的关键锦囊。

### 基本牌与各阶段处理细则

- **选将**：从候选武将中优先选**技能主动、配合性强**的（如张飞/甄姬/郭嘉）；若已知队友武将，可选技能互补的。
- **出牌阶段**：有【杀】且有距离内**敌方**目标时出杀（注意身份，勿打队友）；有桃且自己残血可回血；顺手牵羊/过河拆桥针对**敌方**关键装备。
- **被杀攻击**：手中有【闪】且伤害致命时打出；队友误伤可酌情不出以保留闪。
- **弃牌阶段**：保留杀/桃/无懈可击/关键装备牌，弃多余牌至手牌数 ≤ 当前体力。
- **无操作**：`availableActions` 为空或评估后无收益时，省略 `action` 纯等待。

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
1. joinRoom({ roomId: "X7K2M9" })
   → 返回 { ok:true, roomId:"X7K2M9", joinedAs:"guest", phase:"lobby" }

2. play({})  // 纯等待 / 推进 lobby→playing
   → 返回 needsAction=true, availableActions=[选将候选], pending.candidates=[刘备,张飞...]

3. play({ action: { skillId:"系统规则", actionType:"选将", ownerId:0, params:{character:"张飞"}, baseSeq:0 } })
   → lastActionResult=accepted

4. play({})  // 等待 → 轮到你出牌
   → needsAction=true, view.players[0].skills=["咆哮"]
     availableActions=[{skillId:"杀",category:"play",validTargets:[1]}, ...]
     ※ 先扫 skillId 有无自己技能的动作；张飞【咆哮】=本回合可多次出杀

5. play({ action: { skillId:"杀", actionType:"use", ownerId:0, params:{cardId:"c3", targets:[1]}, baseSeq:0 } })
   → 攻击 1 号座次
```

建房做房主时改用 `createRoom({ maxPlayers: 2 })`，房间码在返回的 `roomId` 字段里，告诉人类加入。
