# 引擎缺口分析归档（2026-06-04）

> 本文档归档当前主分支引擎（v2）的所有已知设计缺口与实现问题，作为 v3 重构的输入。
> 配套 v3 设计文档：[0001-v3-redesign.md](./0001-v3-redesign.md)
> 配套明日讨论待办：[0002-todo-decisions.md](./0002-todo-decisions.md)
> 原诊断会话：2026-06-04

---

## 0. 规模盘点（v2 现状）

| 维度 | 数量 | 完整规则所需 | 覆盖率 |
|---|---|---|---|
| 注册武将 | 47（4 势力 + 风火林山） | 146+ | ~32% |
| 武将技能 handler | 50+ 注册 | 80+ | ~60% |
| 卡牌（基本） | 3（杀/闪/桃） | 6 | 50% |
| 卡牌（锦囊） | 8 | 14+ | ~70% |
| 卡牌（装备） | 16 | 完整 | 100% |
| 原子操作 | 21 | 35+ | ~60% |
| SkillPhase 控制流 | 7 | 12+ | ~60% |
| 触发事件 | 16 | ~25 | ~36% |
| 军争篇卡 | 0 | 13 | 0% |

---

## 1. 原子操作（Atom）层缺口

## 1.1 完全缺失的原子

| 缺失能力 | 影响技能/卡牌 |
|---|---|
| `transferDamage` 伤害转移 | 小乔·天香、蔡文姬·悲歌（部分） |
| `swapHands` 手牌整体交换 | 鲁肃·缔盟 |
| `loseCard` 从装备/判定区精准弃置 | 过河拆桥的真实实现、借刀失败的武器交付 |
| `shuffleDeck` 牌堆洗混 | 鬼道、闪电改判、司马懿反馈重洗 |
| `lookAtCards` N 张暗看 | 诸葛亮观星（当前公开重排）、张角雷击判定前暗看 |
| `addChained` / `removeChained` 连环状态 | 铁索连环、庞统连环 |
| `flip` 武将牌翻面 | 曹仁据守、贾诩放逐、SP 翻面类 |
| `loseHealth` 非伤害扣血 | 黄盖苦肉、孟获祸首（"非伤害失血"） |
| `removeSkill` 动态移除 | 蔡文姬·断肠、SP 封印类、左慈化身切换 |
| `addMark` / `removeMark` 武将牌标记 | 周泰不屈创牌、邓艾屯田、左慈化身牌 |
| `preventDamage` 抵消伤害 | 天香转移后、神诸葛亮大雾、藤甲 |
| `damageType` 伤害类型 | 藤甲、神大雾、白酒、连环传导 |
| `redirect` 目标转移 | 大乔流离、神关羽武魂 |
| `addBuff` / `removeBuff` 持续效果 | 裸衣-1 马、英姿+1 摸、白酒、诸葛连弩 |
| `giveCard` 给手牌（与 gainCard 区分） | 刘备仁德、张辽突袭的"获得"语义 |

## 1.2 实现存在但有 bug 的 atom

### judge（`engine/atoms/judge.ts:34-79`）
- **取判定牌错位**：`getResult` 从 `discardPile[top]` 取最后一张，但 discardPile 是全局弃牌堆，期间其他弃牌（杀/无懈/出牌）会插入错牌。
- **varKey 命名错配**：写 `localVars.judgeColor` 但洛神等读 `localVars.judgeSuit`，两套不同 key 共存。
- **没有"判定前替换"钩子**：鬼道/鬼才的"替换判定牌"没有标准化入口，靠事后回滚实现。
- **没有"观星暗看"模式**：所有观看都是公开的。

### equip（`engine/atoms/equip.ts:6-11`）
- `subtypeToSlot.进攻马 = 'horseMinus'`、`防御马 = 'horsePlus'`，**与 `types.ts:73-78` 的命名相反**，但与 `distance.ts:18-30` 的距离计算刚好抵消，**扩展必爆**。

### discardRandom（`engine/atoms/discardRandom.ts:10-33`）
- 写了 `from: 'hand' | 'equipment'`，**只实现了 'hand'**，装备区随机弃是死代码。
- `getResult` 取 `discardPile[top]`，期间其他原子入堆会错拿——反馈/突袭走"取弃牌堆顶"的根本脆弱原因。

### gainCard（`engine/atoms/gainCard.ts:31-39`）
- **ownerMap 单 key 模型**（`engine/atom.ts:31-64`）：火攻展示、观星暗看、反间展示需要"特定多玩家可见"，模型不匹配。
- 不能从判定区/装备区 gainCard（只有手牌和牌堆）。

### moveCard（`engine/atoms/moveCard.ts:11-44`）
- 区域缺 `judgmentZone`，判定区靠 `player.pendingTricks` 维护，**多角色共享判定区（如乐不思蜀转移）时数据模型不一致**。
- 移动手牌→手牌是"删旧的 push 新的"，**不处理同卡牌已存在的状态机**。

### nextPlayer（`engine/atoms/phase.ts:20-36`）
- `turn: { killsPlayed: 0, ... }` 直接重置；**`vars` 里 `*/usedThisTurn` 靠 `clearTurnVars` 单独清理**（`skill.ts:172-184`）。两个机制并存，**执行顺序靠 `phase-advance.ts:216` 的隐式约定**。
- 若 `nextPlayer` 在 phase-advance 之外被调用（如曹仁据守"跳过下一回合"），**vars 不会清**。

### addSkill（`engine/atoms/skill.ts:6-30`）
- 重复添加靠 `state.triggers.some(...)` 去重，**无撤销 API**。`魂姿` 觉醒后 addSkill 英姿英魂，**之后魂姿被触发都会付一次 dedupe cost**。
- **没有"觉醒技只触发一次"的原子层面保证**——每个觉醒技都要自己写 `if (vars['X/awakened']) return []` 反模式。

### setCtxVar（`engine/atoms/ctxVar.ts:10-12`）
- `apply` 完全空操作，**只写日志**。`phases/atoms.ts:33-36` 直接改 `ctx.localVars`，**ctx 不被序列化**。`setCtxVar` 是"看起来是 atom 实际是 hack"——**和"GameState 完全可序列化"的架构承诺矛盾**。

### heal（`engine/atoms/heal.ts:11-13`）
- 用 `Math.min(p.health + amount, p.maxHealth)` 钳制。
- 无"同势力加血"过滤工具，孙权救援在 handler 里写死势力检查。

### damage（`engine/atoms/damage.ts:9-14`）
- 没有伤害类型（普/火/雷）
- 没有伤害来源参与"已受伤"判定
- 没有"伤害传导"机制（连环完全没接）
- 没有"防止此伤害"钩子（藤甲、大雾毫无落脚点）

### incrementKills（`engine/atoms/turn.ts:8-16`）
- 每回合 1 张杀的限制靠这个。
- 限定技无独立计数，复用 `turn.skillsUsed` 数组；张辽突袭用 `setVar('skipDraw')` 而非 `phaseFlags`，**两种状态表示共存**。

---

## 2. SkillPhase 控制流缺口

`engine/types.ts:342-350` 共 7 种。**严重不够**：

| 缺失 | 影响 |
|---|---|
| `pindian` 拼点 | 驱虎/天义/制霸/烈刃/双雄（4-5 个技能） |
| `multiRespond` N 选 M 响应 | 吕布无双、董卓肉林（2 闪）、决斗轮流出杀 |
| `multiTarget` 一次出牌对多目标 | 方天画戟、关羽武圣衍生 |
| `selectAndReplace` 选取多张并替换 | 张角鬼道 |
| `orderedChoice` 顺序多人表态 | 乱武（其他角色依次选）、蛊惑（依次质疑） |
| `counter` 计数器 | 双雄展示 2 选 1 |
| `branch` 多路分支 | 缔盟（选两人）、陈宫明哲 |
| `abort` 中断当前响应链 | 谦逊/空城/帷幕/完杀——**目前 `return []` 阻止自身，但没阻止目标卡牌本身**，"不能成为目标"无法表达 |
| `forEachLiving` / `forEachWithDistance` | 乱武"距离最近"、反间"其他角色选" |
| `compare` 点数比大小 | 拼点、激将衍生 |

**关键反模式**：`return []` 在 skill handler 里被滥用为"什么都不做"，但调用者（`emitEvent`，`engine/skill.ts:158`）把它当"成功执行无副作用"。这导致 `激将/武圣/咆哮/龙胆/空城/火计/看破/连营` 全部"registerSkill 占位"，真逻辑在 `validate.ts:74-145` 的 `getSkillConvertedCards` 里硬编码——**validate 不该知道技能**。

---

## 3. 触发器 / 事件系统缺口

## 3.1 缺失的事件

| 缺失事件 | 影响 |
|---|---|
| `onCardEffect`（锦囊效果即将生效） | 无懈可击拦截、效果修改 |
| `onCardCancelled`（卡牌被无懈可击抵消） | 青龙偃月刀追刀 |
| `onHealthChange`（体力变化，区分伤/加/上限） | 孙权救援（当前 `event: 'heal'` 是错误命名） |
| `onJudgeResolve`（判定结果生效前） | 鬼道判定牌替换 |
| `onPhaseStart` / `onPhaseEnd`（阶段切换）| 已部分实现（phaseBegin）但无 phaseEnd 独立事件 |
| `onHandChange`（手牌变化）| 连营"最后一张手牌"识别 |
| `onDyingResolved`（濒死结算完成）| 完杀"只能自己救自己" |
| `onMarkChange`（标记变化）| 创牌区、连环等连锁反应 |

## 3.2 触发器匹配错位

- `TriggerRule.phase`（types.ts:391-401）**只在 `phaseBegin` 事件检查**（skill.ts:147-153），其它事件忽略 `phase` 字段。**有人在 `cardPlayed` 上写 `phase: '出牌'` 会被静默忽略**。
- `priority` 只有 0/3/5 三个值，**没文档约定**。诸葛亮观星 vs 许褚裸衣 哪个先？没规则。
- `filter: Condition`（types.ts:399）**实际未被使用**——`engine/skill.ts:135-137` 调 `checkCondition` 但**没传 ctx**，`ExprEvent`/`ExprCtx` 全解析失败。

## 3.3 `modifiers` 字段名不连通

- `engine/skill.ts:62-65` 把 `modifiers: ['unlimitedKills', 'distanceMinus1']` 翻译成 `setVar` 注入。
- `validate.ts:39-54` 的 `hasUnlimitedKills` 反而去查 `equipment.weapon === '诸葛连弩'`，**两者不连通**。
- 张飞·咆哮 `modifiers: ['unlimitedKills']` 注入 var 后**没有任何代码读**。

---

## 4. 技能 handler 实现缺口（v2 stub 全清单）

## 4.1 完全空实现（handler 直接 `return []`）

| 技能 | 武将 | 缺失原因 |
|---|---|---|
| 咆哮 | 张飞 | 应该是 var 标记，引擎无读点 |
| 激将 | 刘备 | 主公技 + 跨玩家出牌 |
| 武圣 | 关羽 | 硬编码在 validate |
| 龙胆 | 赵云 | 硬编码在 validate |
| 倾国 | 甄姬 | 硬编码在 validate |
| 空城 | 诸葛亮 | 不能成为目标 |
| 火计 | 卧龙诸葛 | 卡牌转换到火攻缺 |
| 看破 | 卧龙诸葛 | 卡牌转换到无懈可击缺 |
| 连环 | 庞统 | 铁索连环卡 + 连环状态都缺 |
| 天香 | 小乔 | 伤害转移 atom 缺 |
| 固政 | 张昭张纮 | 弃牌阶段拦截 |
| 红颜 | 小乔 | addTag 写了没读 |
| 天义 | 太史慈 | 拼点机制 |
| 制霸 | 孙策 | 拼点 + 主公技 |
| 缔盟 | 鲁肃 | swapHands atom 缺 |
| 谦逊 | 陆逊 | 不能成为目标 |
| 连营 | 陆逊 | addTag 写了没读 + 时机错 |
| 流离 | 大乔 | 杀的目标转移 |
| 不屈 | 周泰 | 创牌区 + 濒死替代 |
| 暴虐 | 董卓 | 主公技 + 判定 |
| 酒池 | 董卓 | 酒基本牌缺 |
| 肉林 | 董卓 | 2 闪响应 |
| 完杀 | 贾诩 | 桃使用者过滤 |
| 乱武 | 贾诩 | AOE 链 + 距离最近 |
| 帷幕 | 贾诩 | addTag 写了没读 |
| 蛊惑 | 于吉 | 多玩家质疑链 |
| 化身 | 左慈 | 化身牌池系统 |
| 新生 | 左慈 | 同上 |
| 断肠 | 蔡文姬 | 杀者失去所有技能 |
| 烈刃 | 祝融 | 拼点 |
| 双雄 | 颜良文丑 | 展示+选花色 |
| 鬼道 | 张角 | 判定牌替换 |
| 黄天 | 张角 | 主公技 + 交牌 |
| 方天画戟 | 装备 | multiTarget 缺 |
| 丈八蛇矛 | 装备 | 两张当杀缺 |
| 青釭剑 | 装备 | 忽略防具（手写空 stub）|
| 仁王盾 | 装备 | 黑色杀无效（手写空 stub）|

## 4.2 半实现（有部分逻辑但有 bug）

| 技能 | 武将 | 问题 |
|---|---|---|
| 反馈 | 司马懿 | 走 `discardRandom` + `gainCard` 链，取的是弃牌堆顶，期间其他原子入堆会错拿 |
| 刚烈 | 夏侯惇 | judge 走 `localVars.judgeSuit` 但实际 var 写的是 `localVars.judgeColor` |
| 洛神 | 甄姬 | loop + 预置 `judgeResult: 'black'` 初始值绕过 check 逻辑 |
| 魂姿 | 孙策 | `health !== 1` 静态检查，无"从 ≥2 跌到 1"的事件钩子 |
| 再起 | 孟获 | 写了"放弃摸牌 + 展示"，**"红桃回血 + 其余入弃"分支没写** |
| 祸首/巨象 | 孟获/祝融 | `addTag 'immune南蛮入侵'` 写完没读 |
| 反间 | 周瑜 | 选第一张手牌硬编码 `player.hand[0]`，**没有让目标玩家选花色的输入** |
| 制衡 | 孙权 | `discard count: 'any'` 走 max 99，**没有"弃 N 摸 N"的精确对齐** |
| 节命 | 荀彧 | `drawCount = maxHealth - hand.length`，**成了"自己摸"，不是"对方摸"** |
| 据守 | 曹仁 | `vars['据守/flipped']` 写了没读 |
| 神速 | 夏侯渊 | handler 实际是"出杀给 target"，**不是"宣告神速 → 跳阶段 → 出杀"** |
| 强袭 | 典韦 | 直接掉血 1 + 1 伤害，**没有"自减体力或弃武器"的选择** |
| 巧变 | 张郃 | 提示了"是否弃牌跳过"，**handler 没接后续弃牌 + 摸牌** |
| 凿险 | 邓艾 | 觉醒只写了一半，**急袭未注册** |
| 断粮 | 徐晃 | 提示了"选黑牌当兵粮寸断"，**handler 没接 addPendingTrick** |
| 放逐 | 曹丕 | 提示了"选目标"，**handler 没接"补 X 张牌 + 翻面"** |
| 行殇 | 曹丕 | 只遍历手牌，**没有处理装备区/判定区** |
| 享乐 | 刘禅 | `addTag '享乐/discardBasic'` 写了没读 |
| 放权 | 刘禅 | 只到 prompt，**没接 nextPlayer + 额外回合** |
| 若愚 | 刘禅 | 觉醒只 setVar，**没接"加 1 maxHealth + 回复 1 + 加技能激将"** |
| 志继 | 姜维 | 觉醒有 heal/draw 选择 OK，**没接"加 1 maxHealth + 永久获得观星"** |
| 挑衅 | 姜维 | 只到选目标，**没接"对方出杀或你弃他一张牌"** |
| 涅槃 | 庞统 | `discard allHandCards + draw 3 + setVar`，**heal 用 Math.min，当前 health=1 时 heal 3 变 1，不是 3** |
| 固政 | 张昭张纮 | 完全空实现 |
| 枭姬 | 孙尚香 | OK |
| 直谏 | 张昭张纮 | OK |

---

## 5. 卡牌系统 + 装备技能缺口

## 5.1 装备技能（8 个武器）只 3 个完整

`engine/skills/equipment.ts`：

| 装备 | 实现状态 |
|---|---|
| 诸葛连弩 unlimitedKills | 装备注册但 handler 空 stub，靠 `validate.ts:39-54` 查 `equipment.weapon === '诸葛连弩'` |
| 青釭剑 ignoreArmor | 装备注册但 handler 空 stub，**没有任何代码让"杀穿透防具"** |
| 雌雄双股剑 dualWeapon | 完整 |
| 贯石斧 forceHit | 完整 |
| 青龙偃月刀 chaseDodge | 完整 |
| 丈八蛇矛 twoCardsAsKill | 装备注册但 handler 空 stub，`handleKillCard` 不看 skill |
| 方天画戟 multiTarget | 装备注册但 handler 空 stub |
| 八卦阵 judgeDodge | 实现（写 var `八卦阵/dodged`）但**没读取者** |
| 仁王盾 blockBlackKill | 装备注册但 handler 空 stub |

## 5.2 锦囊完整流程写在 3 处真源

`shared/cards/*.ts` CardDef 声明（v1 effect 格式） + `engine/handlers/card-handlers.ts:181-407` 手写命令式 + `engine/handlers/response/*.ts` 又一遍响应窗口——**加一张新卡要改 3 个地方**。

## 5.3 完全缺失的卡牌

- **借刀杀人** — 需"被借刀角色"对指定目标出杀，引擎不区分"我出杀"和"你出杀"
- **火攻** — 需"展示手牌 + 火属性判定 + 弃红桃否则掉血"，无展示手牌原子
- **铁索连环** — 完全无"连环状态"
- **闪电** — CardDef 有但 `pendingTrick.name === '闪电'` 在 `phase-advance.ts:77-81` **没分支**
- **酒 / 火杀 / 雷杀** — `shared/cards/basic.ts:29` 只有 杀/闪/桃
- **调包** — 缺
- **五谷丰登 / 桃园结义** — 已实现但走 `handleTrickCard` 硬编码

## 5.4 锦囊的 AOE 链式响应有 bug 风险

`engine/handlers/response/aoe.ts:115-151` 用"affected = alive 队列"——**闪电目标死亡时没人响应，状态卡住**。

---

## 6. 状态模型层缺口

## 6.1 `PlayerState` 缺字段

- 没有 `chained: boolean`（连环状态）
- 没有 `faceUp: boolean`（翻面）
- 没有 `dying: boolean`（濒死过渡）
- 没有 `judgeZone: PendingTrick[]`（判定区在 `pendingTricks`）
- 没有 `marks: MarkMap`（铁索/翻面/创牌都靠 vars 凑合）
- 没有 `role` 可见性控制（主公公开、忠反内奸隐藏）
- `vars: Record<string, Json>` — string 拼字符串键，**类型不安全**。仁德用 `'仁德/healedThisPhase'`，洛神用 `'洛神/judgeResult'`，**没有 TS 类型**。

## 6.2 `GameState` 缺字段

- 没有全局 `chained: Set<string>`（铁索是关系型的）
- 没有"游戏结束原因"（只有 `winner`，没存 reason）
- 没有"主公存活/势力开启"flag
- 没有 `distance` 缓存
- `rngState` 跳跃不可重放（不同 RNG 实现）

## 6.3 `Expr` 表达式能力不足

`engine/expr.ts:58-146` + types.ts:245-322 支持的 expr：`ctx / event / var / count / distance / cardProp / cond / add / sub / handSize / aliveCount`

**缺**：

- `handCards(player)`（返回 string[] 而非 length）
- `lastHandCard(player)`（连营）
- `topCardOfDeck()`（判定前偷看）
- `livingPlayers()`（返回 string[]）
- `roleOf(player)` / `factionOf(player)` / `genderOf(player)`
- `cardSuitEq` / `cardIsRed` / `cardOfZone` / `hasCard`

**当前只能查"血量/距离/手牌数/是否存活/有 var/有 tag"**——**没有任何"花色判定/卡牌名判定/装备类型判定"**。

---

## 7. Prompt / Pending 系统缺口

## 7.1 `PromptOption` 能力不足

`engine/types.ts:444-449`：

**缺**：`selectCards from: 'discardPile' / 'deck' / 'judgmentZone'`、`selectPlayers` 多选、专门的 `suitSelect`、`yesNo`、`selectZone`、观星 N 选 N 二分（当前递归 2^N 性能灾难）。

## 7.2 `PendingResponseWindow` 能力不足

- `requiredFlashCount` 已加但 `kill.ts:55` 直接 return error `'多闪响应（裸衣）暂未实现'` — **注释承认 stub**。
- 决斗无双的"2 张杀"模式没接。
- `aoeResponse` 处理延时锦囊和"南蛮万箭"共用，**没区分**。
- 无懈可击链的并发抢占用 `depth: number` 奇偶判定，**有 bug**（2026-06 多次修）。

## 7.3 没有"prompt 联动" / "multi-step prompt"

缔盟要先选 2 个玩家 → 弃差值张手牌 → 交换手牌——**prompt 链**。当前 skill handler 只能 `return [prompt, atoms, prompt, ...]`，**第一个 prompt 没完成时 plan 不会 emit，第二个 prompt 无法预知第一个的选择**。

---

## 8. 事件可见性 / 序列化 / 重放

## 8.1 三层事件模型缺陷

`engine/atom.ts:31-64` `ownerMap` 单 key。**火攻展示、观星暗看、反间展示** 都需要"特定多玩家可见"，**模型不匹配**。

## 8.2 序列化一致性

- `setCtxVar` 不持久化
- `ctx.localVars` 不持久化（重放第二次走 prompt 时 `localVars` 全空）
- `addSkill` 改 `state.triggers` 但**没"反序列化时重建 SkillDef"的钩子**
- `pending.action.execution.plan` 序列化整个 plan 树（包括 Expr），重放时 `ExprCtx` 引用 `ctx.localVars['key']`——**localVars 不在 state 里**，重放失败

## 8.3 时钟问题

- `engine/atoms/pending.ts:7` `createPendingId` 用 `Date.now() + Math.random()`——**重放确定性失败**
- 所有 `deadline: Date.now() + timeout` 用真实时间——**重放时 deadline 会变**

---

## 9. Skill 系统设计层面

## 9.1 `SkillDef` 与 `CharacterConfig` 双源

`shared/characters/*.ts` 声明 `abilities: [{ name, description, trigger, condition, effect, passive, modifiers }]`，`engine/skills/*.ts` 又有 `registerSkill({ id, name, description, trigger, handler })`。**两边信息不一致**：

- character 文件里 `condition: { phase: '出牌', hasHandCards: true }` 被 `registerSkill` **丢弃**（不接收 condition）
- `modifiers` 翻译为 `setVar` 但**没有读取代码**
- **实际生效的 skill 完全由 `engine/skills/*.ts` 决定**，`shared/characters/*.ts` 是给 UI 看的"广告"

## 9.2 被动技混用

`passive: true` 翻译为 `priority: 0`，但语义混乱：

- 张飞咆哮 `modifiers: ['unlimitedKills']` — 持续效果
- 甄姬倾国 handler 空 — 事件触发但靠 validate 硬编码
- 曹操奸雄 `event: 'damageReceived'` — 事件触发

**应该拆成 `passiveEffect` + `eventTrigger` 两套**。

## 9.3 `vars` 生命周期管理散落

- `clearTurnVars` (skill.ts:174-184) 用 glob `*/usedThisTurn` 清
- `addSkill` 不清（觉醒永久）
- `addTag` 不清
- `setVar('据守/flipped')` 永久

`vars` 没有生命周期管理，**靠 skill author 自觉**。文档说"usedThisTurn 自动清"，但只有 `青囊/usedThisTurn` 等 3-4 个 key 真正清。

## 9.4 觉醒技"加技能"不能撤销

`魂姿` 觉醒后 addSkill 英姿英魂——但 addSkill **无 unregister**。**觉醒后死亡也不撤销**（蔡文姬断肠要求"杀者失去所有技能"——无 unregister 机制）。

## 9.5 主公技没有"主公判定"

文档说"主公技需要身份/势力联动"——但**当前 `registerCharacterTriggers` 给所有 `ability` 注册 trigger**，**没有"非主公不注册主公技"的判断**。孙策制霸、张角黄天、董卓暴虐、刘备激将、曹丕颂威 这些主公技在**非主公**持有者身上也会注册。

---

## 10. 优先级建议（与 v3 决策对齐）

| 优先级 | 缺失能力 | 解锁技能 |
|---|---|---|
| **P0** | 拼点机制 | 5 |
| **P0** | 多目标出牌 | 1（方天画戟）|
| **P0** | 两张当杀 | 1（丈八蛇矛）|
| **P0** | 互换手牌 atom | 1（缔盟）|
| **P0** | 伤害转移 atom | 1（天香）|
| **P1** | 翻面 + 跳过下回合 | 2（据守/放逐衍生）|
| **P1** | 判定替换 | 1（鬼道）|
| **P1** | 不能成为目标（统一）| 3（空城/谦逊/帷幕）|
| **P1** | 限定技/觉醒技框架 | 3（凿险/魂姿/志继）|
| **P2** | 酒/火杀/雷杀基本牌 | 1（酒池）+ 衍生 |
| **P2** | 火攻/铁索连环完整 | 2 卡 + 3 技能 |
| **P2** | 借刀杀人 | 1 卡 |
| **P2** | 化身牌池 | 2（化身/新生）|
| **P3** | 蛊惑质疑链 | 1 |
| **P3** | 周泰创牌区 | 1 |
| **P3** | 断肠 unregister | 1 |
| **P3** | 完杀桃过滤 | 1 |
| **P3** | 闪电视效 | 1 |
| **P3** | 救援 onHealFromAlly | 1 |

实现 P0 + P1 可解锁 **18 个技能**。
