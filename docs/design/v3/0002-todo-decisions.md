# v3 待决策项

> 状态：草案
> 配套：[0001-v3-redesign.md](./0001-v3-redesign.md)
> 用途：明天交互式逐条过。每个 TODO 标一个 "T-XX"。

---

## 讨论议程建议

**总共 24 个 TODO**。建议分 4 轮，每轮 1 小时：

1. **第 1 轮：原子性原则**（T-01 ~ T-06）— 最基础，影响所有后续
2. **第 2 轮：Mark / Transaction / Pindian 体系**（T-07 ~ T-13）
3. **第 3 轮：状态模型 / Expr / 触发器**（T-14 ~ T-20）
4. **第 4 轮：兼容与迁移**（T-21 ~ T-24）

---

## T-01 同步操作冻结策略

**问题**：v2 当前允许"pending 时其他同步操作可中断"。v3 怎么定？

- 选项 A：pending 时完全冻结（推 / 出牌 / 伤害 都不可触发）— 简单，但破坏"南蛮入侵时完杀"语义
- 选项 B：pending 时允许声明为 `interruptible: true` 的同步操作 — 灵活但复杂
- 选项 C：pending 时只允许"对当前 responder 触发的技能" — 折中

**推荐**：B + 显式声明。每个 `pending` 类型标注 `interruptibleBy: EventType[]`。
**影响**：所有 PendingAction 类型都要加字段。
**我的不确定**：是否所有"完杀"类技能都靠这个解决？需要列具体技能验证。

---

## T-02 事务的回滚粒度

**问题**：transaction 失败时，回滚哪些字段？

- 选项 A：整个 transaction 内所有变更全回滚 — 简单
- 选项 B：可声明 `rollbackStrategy: 'partial'` — 灵活
- 选项 C：拆成嵌套 transaction，子失败回滚到子起点 — 最灵活但复杂

**推荐**：默认 A，**仅在"伤害转移"等场景**显式 B。**天香/借刀**用 A。
**我的不确定**：刘备激将失败（蜀势力没人替出杀），是否需要回滚任何事？目前激将本身无 cost，可能不需要事务——只用一个 prompt。

---

## T-03 多人拼点时的"同时揭示"语义

**问题**：拼点双方各选一张手牌后，是：

- 选项 A：双方都响应后**同时揭示**（一次 emit，消息更"公平"）
- 选项 B：A 响应即揭示，A 知道结果再决定 B 选什么（破坏拼点精神，不允许）
- 选项 C：A 响应后 B 选牌前揭示 A 牌（**半明半暗**）

**推荐**：A。引擎保证"双方都 `selectCard` 完成后"才 emit pindian event。
**影响**：`SkillPhase.pindian` 必须在两个 pending 都在 state.pending stack 时才推进。
**我的不确定**：观星/鬼道的"判定前暗看"是否要同样的"双方都响应"？单方暗看没有"双方"问题。

---

## T-04 swapHands 中"差值弃牌"的归属

**问题**：鲁肃缔盟选 A、B 后，A 6 张手牌 B 4 张，**谁弃差值 2 张**？

- 规则 A：A 弃 2 张（多的人弃）
- 规则 B：各弃到 `(手牌A + 手牌B) / 2`（每人各弃一半）
- 规则 C：A 弃 N（多的人弃到不少于对方）

**官方规则**：每人弃到**不少于**对方手牌数（取 min）。等价于"多的人弃差值"——规则 A。
**我的不确定**：弃牌的提示由谁发起？引擎自动起 A 的 prompt，还是 A 看到自己手牌 6 时自动 prompt "请弃至 4"？后者更对。

**建议**：Transaction 第一步是 `prompt(discardDown, players: [A])`（自动选较多者），然后 swap。

---

## T-05 Mark 的"读点"是否需要显式声明

**问题**：当前 §2.1 Mark 有 `hooks: { onDamagePassing: 'transmit' }` 是声明式。但其他 Mark（翻面/创牌）需要被谁读？

- 选项 A：Mark 都是声明式，引擎统一在所有操作前查 `mark.hooks`
- 选项 B：Mark 是数据，操作方（damage / draw / useCard）显式 query
- 选项 C：声明式 + 显式 query 混合（链调用声明式，简单查询显式）

**推荐**：C。
- 铁索传导用 `hooks.onDamagePassing: 'transmit'`（声明式，免 query）
- 翻面检查"是否在出牌阶段"用 `queryMark(state, 'faceDown', player).present`（显式）
- **这样 Mark 不必强制"无操作 / 无效果"必须 hooks**

**我的不确定**：声明式 hooks 的全集要多大才完备？需要扫一遍所有技能列全集。

---

## T-06 "不能成为目标"的统一表达

**问题**：空城、帷幕、谦逊、完杀 都是"目标过滤"。v3 怎么统一？

- 选项 A：每个卡牌/技能的 effect 里声明 `forbiddenTargets: Expr<...>` 表达式
- 选项 B：Mark `barrier: { type: 'cannotTarget' | 'cannotTargetBy', filter: ... }`
- 选项 C：两者都支持，**先看 effect.forbiddenTargets 再看 barrier**

**推荐**：B。**`cannotTargetBy(filter)`** 是 Mark 模式。

```ts
// 空城：诸葛亮自身
addMark(zhuge, 'noTarget', { scope: 'player', hooks: { onCardTargeted: filter: { kind: 'isNotSelf' } } })
// 帷幕：贾诩
addMark(jiaXu, 'noBlackTrick', { scope: 'player', hooks: { onCardTargeted: filter: { kind: 'isBlackTrick' } } })
// 谦逊：陆逊（不能成为锦囊目标）
addMark(luXun, 'noTrick', { scope: 'player', hooks: { onCardTargeted: filter: { kind: 'isTrick' } } })
// 完杀：仅允许濒死者用桃
// 这是修改桃的"可用者集合"而非"贾诩作为目标"，不是 barrier，是 'canUsePeach' 全局 flag
setGlobalRule({ kind: 'peachUsers', filter: { kind: 'isDying' } })
```

**我的不确定**：完杀是"全游戏规则"还是"贾诩的技能 flag"？前者更干净。
**影响**：要不要引入"全局规则"概念？这超出 Mark 体系。

---

## T-07 翻面状态的"持续"问题

**问题**：曹仁据守"翻面，跳过下一回合，然后翻回"。这个"下一回合结束自动翻回"是：

- 选项 A：Mark duration 显式 `untilPhase: '回合结束'`
- 选项 B：靠 skill 手动 removeMark
- 选项 C：每回合开始时检测 faceDown 玩家并 `endTurn`（跳过）

**推荐**：A + C 组合。
- Mark 加 `faceDown`，duration `{ kind: 'untilPhase', phase: '回合结束' }`
- `phase-advance.ts:nextPhase` 跳过 `faceDown` 玩家（already done for dead，但 v2 没处理 faceDown）
- 回合结束事件 emit 后，所有 faceDown 自动消失

**我的不确定**：贾诩"放逐"（翻面直到下一回合）逻辑是否一致？也是 duration + skipPhase 组合。
**影响**：需要在 phase-advance 里加 `if (faceDown) skipTurn()` 逻辑。

---

## T-08 创牌（周泰不屈）作为 Mark 还是独立牌区

**问题**：周泰的"创"是放在自己旁（不在判定区），是新的牌区。

- 选项 A：Mark 模式，payload 是 cardId
- 选项 B：独立 `PlayerState.toughCards: CardId[]` 牌区
- 选项 C：复用判定区，subtype = '创'

**推荐**：B。创牌**有牌堆特征**（要看花色去重），是**牌区**不是 Mark。Mark 只管"是否翻面"状态。

**我的不确定**：创牌能不能被过河拆桥（拆的是牌）？官方规则不能——**创牌不是牌区，是状态**。但要花色去重。
**结论**：B + 引擎专属操作 `addToughCard` / `checkToughDuplicate`，不去动 `moveCard`。

---

## T-09 化身牌池（左慈）是新牌区还是 Mark

**问题**：左慈"化身"机制，游戏开始获得 2 张"化身牌"（关联武将+技能），回合开始可换 1 张。

- 选项 A：Mark `huashenCard`，payload = { characterId, skills }
- 选项 B：`PlayerState.huashenCards: HuashenCard[]`
- 选项 C：通用"临时技能容器"概念

**推荐**：B + 通用化。**未来 SP 武将的"临时技能"（如"觉醒后获得的技能"）也都走 huashenCards 路径**——这样 addSkill/removeSkill 的需求被弱化，统一为"管理 huashenCards 集合"。

**我的不确定**：化身牌的"展示给所有人"还是"只有左慈看"？官方：自己看。Mark 化就藏了，单独牌区可"owner-visible"。

---

## T-10 判定牌的"重排 vs 替换"是否用同一机制

**问题**：观星是"重排牌堆顶 N 张"，鬼道是"替换判定牌为某张手牌"。

- 选项 A：两者都是 `JudgeStep.beforeReveal: SkillPhase[]`，观星用 `rearrangeDeck`、鬼道用 `replaceJudge`
- 选项 B：观星是独立的"准备阶段重排牌堆"机制，不在 JudgeStep 里
- 选项 C：观星是"摸牌"前/后的 `rearrangeDeck`，不挂判定

**推荐**：A。**所有"判定生效前"的操作**都走 `beforeReveal: SkillPhase[]`。

**观星**：
```ts
{ kind: 'judge', player: ..., source: 'topOfDeck',
  visibility: 'self',
  check: { kind: 'suitOrder', ... },
  beforeReveal: [rearrangeDeckPhase(5, selfVisible: true)],
  ...
}
```
观星的"重排"实际上是"把牌堆顶 N 张暗看后重排"——属于"判定准备"的特例。

**我的不确定**：观星发生在**准备阶段**而非**判定阶段**，和判定绑在一起怪吗？是的，但语义上"观星"是"为后续判定做准备"——v2 把它注册到 `phaseBegin: '准备'` 应该是对的。v3 让 `JudgeStep` 显式说明"在哪个 phase 之前执行"：

```ts
{ kind: 'judge', when: { kind: 'beforePhase', phase: '判定' },
  ... }
```

---

## T-11 Damage 类型的完整集

**问题**：v3 的 DamageType 需要哪些值？

- 候选：`normal` / `fire` / `thunder` / `none`(loseHealth) / `cold`?(暴风雪？) / `hp-loss`(苦肉)

**官方规则**：标准版只有 fire / thunder / normal（火攻/雷击/普通）。军争加了一些。

**建议**：
- `DamageType = 'normal' | 'fire' | 'thunder'`
- `loseHealth` 是独立操作（`loseHealth` atom），不是 `damage(type: 'none')`——语义更清晰
- 黄盖苦肉 = `loseHealth(1)`，**不进入 damage 链、不触发濒死窗口**（除非降到 0 以下）

**我的不确定**：苦肉"自伤 1 体力"在官方规则里**会**触发濒死。是否要 `loseHealth` 走同样的濒死链？建议：**体力变化都触发濒死检查**（v2 是这样的），但 `damage` 链有 `preventableBy/hooks`，`loseHealth` 没有。

---

## T-12 仁德/张辽突袭是单卡移动还是事务

**问题**：仁德"出牌阶段给多张手牌给一个目标，2 张以上回 1 血"，**给多张**是单点（一次 moveCard 多次）还是事务？

- 选项 A：单点。每次给一张，2 张后自动 heal
- 选项 B：事务。一次性选 N 张，一次性转移 + heal
- 选项 C：单点 + 计数器。`incrementVar('仁德/countGivenThisPhase')` 满 2 触发 heal

**v2 当前实现**：v2 的仁德是**单卡移动** + `setVar('仁德/healedThisPhase')`（注意清空 glob 错配）。  
**v3 推荐**：A + C。**给一张就 emit**（UI 流畅），但**计数器是 turnScoped vars**。

**我的不确定**：张辽突袭"从每个其他角色拿一张"是否也是 A？是的，每个目标一次 gainCard。**但"每个目标必须都在攻击范围内"是同时还是连续检查？**官方："**可视为同时**，但在 v2 里是顺序的"。建议：v3 顺序处理，**若中途发现攻击范围不够就 abort 后续**。

---

## T-13 借刀杀人的"借"语义

**问题**：借刀杀人 A 对 B（A 有武器）使用，B 选"对 C 出杀"或"把武器给 A"。

- 选项 A：B 的杀是"视为 B 出的"（消耗 B 的出杀次数）
- 选项 B：B 的杀是"视为 A 出的"（消耗 A 的出杀次数）
- 选项 C：B 的杀是"独立的不消耗次数"

**官方规则**：**A 视为对 B 使用借刀，B 必须出杀；若 B 出杀则 B 的杀对 C 生效（消耗 B 的出杀次数）**。即选 B。

**v3 实现**：借刀是一个 Transaction，第一步是 `prompt(B, useKillOn: C) or giveWeaponTo(A)`。

**我的不确定**：B "出的杀"是否走 B 的 validate（攻击范围 / 手牌限制）？官方：攻击范围**借用 A 的武器范围**（B 借 A 的刀），其他正常。所以是 `useKillWithRange(B, weaponRangeA, target: C)`。

---

## T-14 RNG 重放保证

**问题**：v2 `rngState: number` 跳跃不可重放（不同 RNG 实现）。

- 选项 A：存完整 RNG 实例（`{ algorithm: 'sfc32', state: [u32, u32, u32, u32] }`）
- 选项 B：存所有 `rng.next()` 调用序列，deterministic 重放
- 选项 C：用 splitmix64 + 存一个 `state: BigInt`

**推荐**：A。RNG 算法固定（sfc32 或 xoshiro256**），state 4 个 u32 共 16 字节。**反序列化后用相同算法重建**。

**我的不确定**：洗牌操作（`shuffle(deck, rng)`）需要把洗过的顺序序列化还是重洗？**重洗**——重放时重新洗，state 从 seed 重建。

---

## T-15 时间确定性

**问题**：v2 用 `Date.now() + Math.random()` 作 pendingId，**重放失败**。

- 选项 A：pendingId = `${turnNumber}.${seq}.${kind}.${counter}`
- 选项 B：pendingId 完全去掉，**baseSeq（ADR 0009）已够用**
- 选项 C：保留 human-readable pendingId 用于日志，但**逻辑判断走 baseSeq**

**推荐**：A + 不用 baseSeq 重叠。**pendingId 纯粹是日志 / 调试用**，所有逻辑判断走 baseSeq（ADR 0009 已规定）。

**影响**：所有 `pending.id` 字段保留，但**保证确定性**（基于 seq + counter）。

---

## T-16 TriggerRule.priority 的标准值

**问题**：v2 只用 0/3/5。建议 v3 的 5 个标准值：

- `0` = 装备被动效果（无触发，纯属性）
- `1` = 角色被动效果（无触发）
- `3` = 装备触发（事件触发）
- `5` = 角色触发（事件触发）
- `7` = 主公技 / 全局 flag

**问题**：觉醒技和限定技需要新优先级吗？**否**——它们的 priority 用 5，但通过 `meta.type` 限制触发次数。

**我的不确定**：观星（诸葛亮）vs 裸衣（许褚）触发 `phaseBegin` 哪个先？建议：

- 同 phase 多个触发：按 priority 升序
- 同 priority：按角色座位顺序
- 同一切：emit 都到 stack，然后 engine 逐个处理

---

## T-17 强制结束 turn 时未完成 skill 怎么办

**问题**：玩家超时 / 断线时，pending 内的 skill 选择要默认策略。

- 选项 A：默认"放弃"（skipCurrentPending）
- 选项 B：默认"不发动"（skipSkill）
- 选项 C：per-pending 标注 `onTimeout: 'skip' | 'default' | 'autoFirst'`

**推荐**：C。**默认 `onTimeout: 'skip'`**（不发动），但响应窗口（杀→闪）的 `onTimeout: 'noDodge'` 是 `default`。
**影响**：每个 PromptDef 加 `onTimeout` 字段。
**我的不确定**：AOE 内的"目标跳过响应"是 `onTimeout: 'damage'`——这是 prompt 还是 pending？建议是 pending 级别的 onTimeout。

---

## T-18 隐藏牌 vs 不可见状态

**问题**：v2 `state` 序列化到客户端时，**其他玩家手牌不能传**。当前是 server 过滤。v3 怎么定？

- 选项 A：服务端用 view 系统裁剪后再发（v2 模式）— 服务端负担
- 选项 B：客户端接收"未知手牌占位" + "已知手牌"
- 选项 C：客户端用 ServerEvent 的 view 字段自己决定显示

**推荐**：A + view 系统结合。**服务端广播完整 ServerEvent（含 view 字段），客户端按 view 字段决定显示**。但 ServerEvent 永远不发"未授权可见的 cardId"——服务端在 emit 前裁剪。

**影响**：服务端在 emit 前做 `redact(event, playerId)`，客户端不再"看到不存在的卡牌"。

---

## T-19 删 v2 的 `vars` 字段后向兼容

**问题**：v2 大量 `vars['X/usedThisTurn']`，改成 v3 后怎么迁移？

- 选项 A：全量重写，**v2 vars 全部用 v3 机制替代**
- 选项 B：v3 保留 `vars` 字段作为"私有 any"，但**新技能不许用**
- 选项 C：v3 引入 `MarkMap` 替代 vars，**v2 vars 自动 import 时编译失败**，强制迁移

**推荐**：A。**v2 vars 全部迁移**——不兼容的代价是技能文件全改，但**v2 技能 handler 本来就大量 stub，重写**。

**影响**：约 50+ 技能 handler 重写。**这是 P0 的最后一步**。

---

## T-20 双源：CharacterConfig vs SkillDef

**问题**：v2 character.ts 的 `abilities.effect/condition/modifiers/passive` 是 dead code（v3 已规划删），但**删之前 UI 用什么展示技能详情？**

- 选项 A：UI 通过 `getSkillDef(id)` 查（v3 方案）
- 选项 B：保留 `CharacterConfig.abilities.description` 字段（其他全删）
- 选项 C：character.ts 完全删 abilities，UI 走 skill registry

**推荐**：B。**`CharacterConfig.abilities: { id, name, description }[]`**（仅元信息），效果/触发/handler 全在 skill registry。**UI 用 `getSkillDef(id).description`** 查最新描述。

**影响**：character 文件的 `abilities` 字段从 13 字段缩到 3 字段。

---

## T-21 与 v2 共存的过渡策略

**问题**：v3 实施期间，v2 仍是大头。怎么共存？

- 选项 A：v3 在 `engine/v3/` 独立目录，新功能走 v3，旧功能保持 v2
- 选项 B：v2 的 atom/skill 标注 `@deprecated`，v3 逐步替换
- 选项 C：v3 是 v2 的超集（继承所有 v2 类型），新技能用 v3 扩展

**推荐**：A。**两个引擎并行**，**v2 路径不再新增技能**，**bug fix 在两边都做**。**当 v3 覆盖 80% 技能时，删 v2**。

**影响**：`engine/v2/` 和 `engine/v3/` 目录分离。**`engine/handlers/card-handlers.ts`（v2 锦囊手写）保持**，v3 锦囊走 `engine/v3/cards.ts` 走 CardDef.effect 树。

---

## T-22 删 v2 路径的触发条件

**问题**：什么时候可以删 v2？

- 选项 A：v3 覆盖所有 P0 + P1 缺失能力后
- 选项 B：所有现有 v2 技能迁移到 v3 后
- 选项 C：v2 测试通过 + v3 测试通过 2 周稳定期后

**推荐**：C。**v3 必须有完整测试覆盖**（含回归测试）才能删 v2。

**指标**：
- v2 技能 0 个（全部 v3 化）
- v3 测试通过 = v2 测试通过 + 35 个 stub 技能的真测试
- 序列化/重放测试

---

## T-23 性能预算

**问题**：v3 引入 Mark / Transaction / Pindian 多个层，**性能是否会变差**？

- 担心点：
  - Mark lookup O(n) per operation
  - Transaction snapshot 拷贝成本
  - Pindian 双方 pending stack 复杂度

- 选项 A：性能不是 v3 关注点，先做对
- 选项 B：性能预算：单操作 < 1ms，Transaction < 5ms
- 选项 C：基准测试套件 + 性能回归

**推荐**：B + C。**B 定目标**（1ms 单点、5ms Transaction、100ms 全局 Turn），**C 加基准测试**。

**我的不确定**：观星的 2^N prompt 递归（v2 已实现）是否要重构为 O(N) 排序？建议：v3 改为"选 N 张的最终位置"而非递归 2^N。

---

## T-24 文档化测试覆盖

**问题**：v2 的测试覆盖是"假装真实路径"（直接 emitEvent 绕过引擎），v3 必须改。

- 选项 A：v3 测试强制走 `engine(state, action)` 真实路径
- 选项 B：v3 保留 emitEvent 单元测试，**新增 e2e 走真实路径**
- 选项 C：A + 新增"引擎事件审计"测试（v2 已有但不够）

**推荐**：A + C。**v3 测试禁止 emitEvent**（写 test helper 阻止），**所有技能测试走 createTestGame → engine → 真实路径**。

**指标**：
- 每个技能至少 1 个 e2e 测试（从 setup 到验证）
- 每个原子 1 个 toEvents 测试
- 每个 SkillPhase 1 个 control flow 测试
- 每个 CardDef 1 个 effect tree 测试

---

## 附录：未覆盖的边角案例（待讨论）

下列是 v2 实际跑过但没文档化、明天可能问到的：

1. **4 人 vs 8 人局的距离计算差异** — `distance.ts` 已支持但 identity distribution 不在 state 里
2. **AI 模式下的默认行为** — 当前没实现
3. **回放 / 录像** — `docs/design/日志与重播设计.md` 有规划但 v3 怎么重做
4. **多客户端同步** — 断线重连后 baseSeq 错位的恢复策略
5. **主公技 "其他同势力角色" 的距离计算** — 是否受主公距离 1 影响
6. **闪电是否会被连环触发** — 闪电不在连环链中
7. **喝酒后的酒杀对连环目标的伤害 +1** — type 复合
8. **丈八蛇矛出的杀是否享受酒加成** — 是（属性保留）
9. **神诸葛亮的"大雾"对所有非雷电伤害的防止** — 是全局 Mark
10. **借刀杀人 B 出杀时是否会被反间** — 借刀的杀是"对 C 出"，与 B 的当前状态独立

如需讨论任何一个，标 TODO-X 即可。
