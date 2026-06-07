# 引擎架构与设计

> **唯一的设计文档**。3 国杀引擎当前的实现、缺口、决策档案。
> 配套：本档案 26 条决策的**完整记录**见 [§5 决策档案](#5-决策档案要点)
> ADR 索引：[§7](#7-adr-索引)

---

## 0. 当前状态

### 0.1 测试


- 总测试：**1410**（含 `it.skip` / `describe.skip` 占位）
- 跳过：**40**
- 测试目录：`tests/{unit,integration,server,scenarios,hooks,api,e2e}/`
### 0.2 实现状态总览

| 类别 | 已实现 | 部分实现 | 未实现 | 备注 |
|---|---|---|---|---|
| **武将** | 47 | 0 | 0 | 4 势力 + 风火林山 |
| **武将技能** | 53+ | 0 | 23 | 见 [§3](#3-现状未实现-it_skip) |
| **装备技能** | 8/8 武器 | 0 | 0 | v3 registerAtomHook 骨架全就位（青釭/仁王/丈八/方天 P1-1D-T3/T4 修；八卦阵真 game rule P3-T2 完整化）|
| **基本牌** | 3/6 | 1（火杀骨架）| 2 | 杀/闪/桃 实现；火杀 +1 钩子 P3-T1 骨架就位（依赖 CardDef subtype 扩展，完整 cards.ts 留 follow-up）；酒/雷杀 **未实现** |
| **锦囊** | 8 | 0 | 6+ | 见 [§3.2](#32-卡牌缺口) |
| **原子操作** | 33+ | 0 | — | P0 + P1 + P2 + P3 累计：loseHealth/loseCard/removeSkill/mark*3/shuffleDeck + useCard/becomeTarget no-op atoms（v3 钩子端到端测试用）；`设横置` 改写为加/去 Mark 'chained'，不再写 PlayerState.chained 字段 |
| **SkillPhase** | 7 | — | — | 缺 pindian/multiTarget/orderedChoice 等 |

**累计完成**（P0 2026-06-05 + P1 2026-06-06 + P2 2026-06-06 + P3 2026-06-06）：
- P0：6 Task / 12 commits / 1306 tests pass
- P1：18 Task / 20 commits（含 8 reducer handlers 修）/ 1361 tests pass
- P2：5 Task / 5 commits / 1385 tests pass
- P3：4 Task / 4 commits / 1404 tests pass
- P4（解耦重构）：4 commit / 1412 tests pass — 56 角色单文件、装备独立、createEngine 闭包 + clearForTest、currentEngineHooks fallback。详见 ADR 0013、0018

### 0.3 已知文档/代码不一致

- **技能转换硬编码**：`src/engine/validate.ts:73-119` 倾国/龙胆/武圣/奇才 的"手牌当 X 出" 写死，**validate 不该知道技能**。🟡（P1-1D-T1 迁移部分：武圣/龙胆/倾国已迁 `SkillDef.convertible` 字段，奇才留 stub）
- **八卦阵 var 不读**：P1-1D-T2 写 v3 registerAtomHook 兜底 cancel；P2-T4 改为读 `ctx.baguaJudgeResult`；P3-T2 加 useCard 阶段判定注入（真 game rule）✅ 修复
- **4 个武器空 stub**：P1-1D-T3/1D-T4 修完（青釭剑/仁王盾/丈八蛇矛/方天画戟 v3 registerAtomHook 骨架）✅ 修复
- **触发器 `phase` 字段**：P1-1E-T2 修完（所有事件类型都检查 phase）✅ 修复
- **双钩子系统**：🟡 仍并存（v3 registerAtomHook + 老 trigger.event + GameEvent 映射）。P1 + P2 增 v3 实现；P3-T1/T2/T3 + P2-T4 加 useCard / becomeTarget atoms 让 v3 钩子可端到端。38+ 老技能迁移按 [T-22] 渐进 PR。
- **判定牌取错位置**：P1-1E-T1 修完（`localVars.judgeCardId`）✅ 修复
- **draw 重洗未 emit 事件**：✅ P0 修复（ADR 0014，commit `364eb4a`）

### 0.3.1 P3 修复的真 game rule

- **大雾/藤甲反转**：P1-1A-T2 写错（藤甲防 fire、大雾防 thunder）→ P3-T1 反转：藤甲防 normal 杀，大雾防 non-thunder（normal+fire 取消，thunder 穿透）
- **火杀 +1 伤害**：P3-T1 加 `_fireKillDamageBonus.ts` v3 useCard 钩子（subtype='火杀'/'fire' → amount=2 damageType='fire'）
- **useCard / becomeTarget atoms**：P3-T1/T2 implementer 加 no-op atoms（让 v3 useCard / becomeTarget 钩子可端到端 applyAtoms 测试）

### 0.4 阅读路径

- 想看"为什么这样设计" → [§5 决策档案（要点）](#5-决策档案要点)
- 想看"现在能用什么" → [§1 核心模型](#1-核心模型)
- 想看"什么没做" → [§3 现状：未实现](#3-现状未实现-it_skip)
- 想看"什么不对" → [§0.3 已知不一致](#03-已知文档代码不一致)
- 想看"下一步做什么" → [§6 改进路径](#6-改进路径按依赖)

### 0.5 引擎分层（2026-06-06 重构后）

`src/engine/` 按业务概念物理隔离：

| 子目录 | 内容 | 文件组织 |
|---|---|---|
| `characters/` | 角色声明（`CharacterConfig`）| 按势力：`wei.ts` `shu.ts` `wu.ts` `qun.ts` |
| `skills/` | 武将技能实现（`SkillDef`）| **按角色单文件，汉字命名**：`曹操.ts` `刘备.ts` `孙悟空.ts` ... 共 56 个 |
| `equipment/` | 装备技能实现（`SkillDef` + v3 hooks）| `stubs.ts` + `bagua.ts` `daqi.ts` `leiji.ts` ... + 辅助文件（`chained-propagation` `_fireKillDamageBonus` 等）|
| `create-engine.ts` | 引擎入口 | `createEngine(config)` 返回带闭包的 `EngineInstance`（含 `skillsMap` / `hooks` / `clearForTest()`）|
| `skill.ts` / `skill-hook.ts` | 全局注册表（v2，向后兼容）| 已 `@deprecated`，迁移指南见 ADR 0018 |

**关键不变量**：
- `createEngine()` 的 `hookRegistry` 是闭包独立的，dispatch 期间 `applyAtoms` 优先用闭包 hooks
- `engine.clearForTest()` 重置全局 skill registry + atom hooks，重新注册本 instance 技能
- 测试隔离：`createTestEngine()` 替代旧的 `clearXxx()` 三件套（详见 ADR 0018）

---

## 1. 核心模型

## 1.1 状态机

**核心承诺**：状态机内部（`engine(state, action)`）完全确定性——同 state + action = 同 result。

- **不使用时间**：`Date.now()` / `Math.random()` **只出现在状态机外部**（事件 id、pending id、deadline 初始化、server `setTimeout`）
- **不调 RNG**：所有随机性由 `state.rngState: number` 决定
- **重放**：`reduceGameState`（`src/engine/view/reducer.ts:22`）纯函数，从 serverLog 推演 state，**不调 RNG**

**状态字段**（`src/engine/types.ts`）：

```ts
interface GameState {
  meta: { id; seed; round; turnNumber; status; createdAt; playerCount; autoSkipWuxie };
  players: Record<PlayerId, PlayerState>;
  currentPlayer: PlayerId;
  turn: { phase; killsPlayed; skillsUsed; turnStarted };
  zones: { deck; discardPile; pendingTricks? };
  cardMap: Record<CardId, Card>;
  triggers: TriggerRule[];        // 🟡 老技能，仍在用
  rngState: number;               // 单 number seed
  playerLogs: Record<PlayerId, ServerEvent[]>;
  pending?: PendingAction;
  deferredDyingCheck?: {...};
}

interface PlayerState {
  info: { name; role; faction; gender; alive };
  health: number;
  maxHealth: number;
  hand: CardId[];
  equipment: { weapon; armor; mount; plus; minus };
  judgmentZone: PendingTrick[];
  vars: Record<string, Json>;     // 🟡 类型不安全，v3 不再用
  // chained（铁索连环）已迁出：作为 Mark 存在 GameState.marks[playerId]，id='chained'。
  // 读取走 hasMark(state, player, 'chained')，不再用 PlayerState.chained 字段。
  // 其他持续状态（faceDown、leijiPending 等）同理。
}
```

## 1.2 操作（Atom）

`src/engine/atom.ts:applyAtoms`（ADR 0012）是**唯一入口**。所有 atom 应用必经此函数。

**29 个现有 atom**（`src/engine/types.ts:195-230`）：

| 类别 | atom | 备注 |
|---|---|---|
| 卡牌 | `draw` `discard` `discardRandom` `moveCard` `gainCard` `equip` `rearrangeDeck` | |
| 角色 | `damage` `heal` `kill` `modifyMaxHealth` | `damage` 无 type 字段（[T-11](#5-决策档案要点)）|
| 状态 | `addVar` `setVar` `addTag` `removeTag` `addSkill` | `addSkill` 无对应 `removeSkill` |
| 流程 | `setPhase` `nextPlayer` `turnStart` `phaseBegin` `phaseEnd` `incrementKills` | 阶段推进原子化（ADR 0013）|
| 判定 | `judge` `pendingTrick` `ctxVar` | `judge` 有取牌 bug（[§0.3](#03-已知文档代码不一致)）|
| 其他 | `pushPending` `popPending` `setCtxVar` | |

**累计 33+ atom**（P0/P1/P2/P3 实际）：

| 类别 | atom | 备注 |
|---|---|---|
| 卡牌 | `draw` `discard` `discardRandom` `moveCard` `gainCard` `equip` `rearrangeDeck` `giveCard` `takeCard` `useCard` `becomeTarget` `loseCard` `reshuffle` `shuffleDeck` | P0 加 giveCard/takeCard/reshuffle；P1 加 loseCard；P2 加 shuffleDeck；P3 加 useCard/becomeTarget no-op（v3 钩子端到端用）|
| 角色 | `damage` `heal` `kill` `modifyMaxHealth` `loseHealth` | P1 damage 加 type 字段 + loseHealth atom |
| 状态 | `addVar` `setVar` `addTag` `removeTag` `addSkill` `removeSkill` `addMark` `removeMark` `clearExpiredMarks` `setChained` | P1 加 removeSkill/3 个 mark atom/setChained |
| 流程 | `setPhase` `nextPlayer` `turnStart` `phaseBegin` `phaseEnd` `incrementKills` | 阶段推进原子化（ADR 0013）|
| 判定 | `judge` `pendingTrick` `ctxVar` | `judge` 已修 1E-T1（`localVars.judgeCardId`）|
| 其他 | `pushPending` `popPending` `setCtxVar` | `setCtxVar` 当前 no-op state.localVars（仅写 SkillPhase ctx）；v3 钩子直写 `state.localVars` |

**已实现钩子扩展**（P0 + P1 + P2 + P3 累计）：

| 钩子 | 实现位置 | 真 game rule |
|---|---|---|
| 完杀（贾诩）| `src/engine/equipment/wansha.ts` | 阻桃非濒死 |
| 空城（诸葛亮）| `src/engine/equipment/kongcheng.ts` | 手空时拒【杀】/【决斗】 |
| 帷幕（贾诩）| `src/engine/equipment/weimu.ts` | 拒黑色锦囊 |
| 藤甲 | `src/engine/equipment/tengjia.ts` | **P3-T1 反转**：防 normal 杀 |
| 大雾 | `src/engine/equipment/daqi.ts` | **P3-T1 反转**：防 non-thunder |
| 八卦阵 | `src/engine/equipment/bagua.ts` + `_baguaJudgeInject.ts` | **P3-T2 真 rule**：useCard 阶段 inject baguaJudgeResult，damage onBefore 读 ctx |
| 雷击（张角）| `src/engine/equipment/leiji.ts` | **P3-T3 真 rule**：读 ctx.leijiJudgeResult，success 才 emit 3 点 thunder |
| 火杀 +1 | `src/engine/equipment/_fireKillDamageBonus.ts` | **P3-T1 骨架**：subtype='火杀'/'fire' → amount=2 |
| 青釭剑 / 丈八蛇矛 / 方天画戟 / 仁王盾 | `src/engine/equipment/qinggang.ts` / `zhangba.ts` / `fangtian.ts` / `renwang.ts` | v3 钩子骨架（穿透防具 / 2 张当杀 / 多目标 / 黑杀无效）|
| 铁索连环传导 | `src/engine/equipment/chained-propagation.ts` | fire/thunder 伤害链上其他角色 |

## 1.3 钩子机制

**`src/engine/skill-hook.ts:registerAtomHook`**（ADR 0012 新 API）：

```ts
registerAtomHook({
  atomType: 'heal' | 'damage' | 'moveCard' | 'useCard' | 'becomeTarget' | ...,
  filter?: (ctx: { state, atom, self }) => boolean,         // 过滤哪些 atom 触发
  onBefore?: (ctx: { state, atom, self, serverEvent }) => {
    cancel?: true;                                          // 整个链断
    newAtom?: Atom;                                         // 替换 atom
    redirect?: string;                                      // 改 target（damage/becomeTarget 适用，P1-1E-T3）
    additionalAtoms?: Atom[];                               // 注入更多 atom（onAfter 也有）
  },
  onAfter?: (ctx) => { additionalAtoms?: Atom[]; cancel?: true },
  // 注意：v3 去掉了 priority 字段（[T-26](#5-决策档案要点)）——钩子顺序 = 注册顺序
});
```

**真实 onAfter/onBefore 签名（**P1 实施确认**）**：`ctx = { state, atom, self, serverEvent }` —— 不是 `(state, atom)`。**所有 v3 钩子应使用 ctx 解构**（看 `src/engine/equipment/bagua.ts:31` / `leiji.ts:75` / `_baguaJudgeInject.ts` 真实用法）。
**钩子执行顺序**（[T-26](#5-决策档案要点)）：
- 同 `atomType` 下，钩子**按注册顺序**触发
- `filter` 不过 → 跳
- 第一个 `onBefore` 返回 `cancel: true` → **整个链断**（后续钩子不跑）
- `onBefore` 返回 `{ atom: NewAtom }` → 后续钩子看到的是**新 atom**
- `onAfter` 的 `additionalAtoms` 递归 `applyAtoms(..., { skipHooks: true })`（**不再次触发钩子**）
- `MAX_HOOK_RECURSION = 16`（`src/engine/atom.ts:71`）给嵌套留位
**独立性约束**（[T-26](#5-决策档案要点)）：
- 钩子**不应依赖同链上其他钩子的 state 修改**
- 依赖场景（如"先判定再决定是否取消"）：把判定逻辑内联到自己的 filter，**自给自足**
- 例：八卦阵 var 写 + 读 → 改为"filter: target has 八卦阵, inline 判定 + 取消"

**已注册钩子**（P0 后）：3 演示技能使用 —— 完杀/空城/帷幕（`src/engine/equipment/wansha.ts` / `kongcheng.ts` / `weimu.ts`）。38+ 老技能仍走 `trigger.event`，按 [T-22] 渐进迁移。

**🎯 v3 决策**（[T-25](#5-决策档案要点)）：**完全迁移到 `registerAtomHook`，老技能（trigger.event）作废**。v3 测试**只用** registerAtomHook 路径。38+ 技能迁移是渐进 PR。

**v3-only skill 写法**（commit `d90be01`）：`SkillDef.trigger` 已改为 optional（`src/engine/types.ts:390`）。v3 钩子驱动的技能可不填 `trigger` 字段。完全迁移前的过渡做法是填占位 `trigger.event: 'v3HookOnly'` —— 不在 GameEvent union 中，v2 `emitEvent` 永不触发；但 `state.triggers` 仍命中以支持 v2 `targetHasSkill` 验证路径（`src/engine/validate.ts:61-63 hasEmptyCityShield` 等）。4 处 registerTriggers 路径加 `if (!def.trigger) return state/continue` 防御性保护。

## 1.4 SkillPhase 控制流

7 种（`src/engine/types.ts:342-350`）：

| 类型 | 用途 | 示例 |
|---|---|---|
| `sequence` | 顺序执行 | 摸牌阶段 |
| `loop` | 循环 | 准备阶段 |
| `foreach` | 遍历 | 兵粮寸断 / 乐不思蜀判定 |
| `condition` | 条件 | 武将死亡检查 |
| `respond` | 响应窗口 | 杀→闪、锦囊→无懈、濒死→桃 |
| `emit` | emit GameEvent | 触发技能 |
| `prompt` | 玩家输入 | 选牌/选目标 |

**待新增**（[§6 改进路径](#6-改进路径按依赖)）：`pindian` / `multiTarget` / `orderedChoice` / `counter` / `branch` / `forEachLiving`

## 1.5 序列化与重放

- **`src/engine/serializer.ts`** + **`src/engine/replay.ts`**（ADR 0010）
- GameState 序列化为 `StateSnapshot + ServerEvent[]`
- `reduceGameState` 从 snapshot + events 重建 state
- **重放不调 RNG**——serverLog 包含 `draw.cards` 字段
- **重洗牌未 emit 事件**——[§0.3](#03-已知文档代码不一致) 已知 bug

---

## 2. 现状：已实现

## 2.1 武将技能（按势力）

> **实现状态说明**：
> - 🟢 **常规**：技能 handler 在 `src/engine/skills/`
> - 🟡 **v2 硬编码**：handler 是 stub，真逻辑在 `src/engine/validate.ts` 硬编码（倾国/龙胆/武圣/奇才）
> - 🔴 **未实现**：测试 `it.skip` / `describe.skip`

**47 武将注册**，覆盖**4 势力 + 风火林山**。

### 🟢 已实现（标准）

| 势力 | 武将 | 技能 | 实现位置 |
|---|---|---|---|
| 蜀 | 刘备 | 仁德 | `src/engine/skills/仁德.ts` |
| 蜀 | 关羽 | 武圣 🟡 | `src/engine/skills/武圣.ts` stub，逻辑在 `src/engine/validate.ts:116` |
| 蜀 | 张飞 | 咆哮 | `src/engine/skills/咆哮.ts` |
| 蜀 | 赵云 | 龙胆 🟡 | `src/engine/skills/龙胆.ts` stub，逻辑在 `src/engine/validate.ts:113/117` |
| 蜀 | 马超 | 铁骑 | `tests/scenarios/蜀/铁骑.test.ts` |
| 蜀 | 黄忠 | — | `tests/scenarios/蜀/黄忠.test.ts` |
| 蜀 | 魏延 | — | `tests/scenarios/蜀/魏延.test.ts` |
| 蜀 | 诸葛亮 | 观星 / 空城 🟢 v3 钩子 | 观星 `src/engine/skills/观星.ts`；空城 v3 `src/engine/equipment/kongcheng.ts` |
| 蜀 | 卧龙诸葛 | 火计 / 看破 | `src/engine/skills/火计.ts` |
| 蜀 | 庞统 | 涅槃 | `src/engine/skills/涅槃.ts` |
| 蜀 | 姜维 | 挑衅 / 志继 | `tests/scenarios/蜀/姜维.test.ts` |
| 蜀 | 刘禅 | 享乐 / 放权 / 若愚 | `tests/scenarios/蜀/刘禅.test.ts` |
| 蜀 | 孟获 | 祸首 / 再起 | `tests/scenarios/蜀/孟获.test.ts` |
| 蜀 | 祝融 | 烈刃（拼点赢拿牌）| `tests/scenarios/蜀/祝融.test.ts` |
| 蜀 | 黄月英 | 集智 / 奇才 🟡 | `src/engine/skills/集智.ts` stub，奇才逻辑在 `validate.ts` |
| 魏 | 曹操 | 奸雄 | `src/engine/skills/奸雄.ts` |
| 魏 | 司马懿 | 反馈 / 鬼才 | `src/engine/skills/反馈.ts` |
| 魏 | 夏侯惇 | 刚烈 | `tests/scenarios/魏/刚烈.test.ts` |
| 魏 | 张辽 | 突袭（偷 2 人各 1 张）| `src/engine/skills/突袭.ts` |
| 魏 | 许褚 | 裸衣 | `tests/scenarios/魏/裸衣.test.ts` |
| 魏 | 郭嘉 | 遗计 | `tests/scenarios/魏/遗计.test.ts` |
| 魏 | 甄姬 | 倾国 🟡 / 洛神 | `src/engine/skills/倾国.ts` stub，倾国在 `validate.ts:112` |
| 魏 | 典韦 | 强袭 | `tests/scenarios/魏/典韦.test.ts` |
| 魏 | 荀彧 | 节命 | `tests/scenarios/魏/荀彧.test.ts` |
| 魏 | 曹仁 | 据守 | `tests/scenarios/魏/曹仁.test.ts` |
| 魏 | 曹丕 | 放逐 / 颂威 / 行殇 | `tests/scenarios/魏/曹丕.test.ts` |
| 魏 | 邓艾 | 凿险 | `tests/scenarios/魏/邓艾.test.ts` |
| 魏 | 徐晃 | — | `tests/scenarios/魏/徐晃.test.ts` |
| 魏 | 张郃 | 巧变 | `tests/scenarios/魏/张郃.test.ts`（逻辑实现，阶段拦截待验证）|
| 魏 | 夏侯渊 | 神速 | `tests/scenarios/魏/夏侯渊.test.ts` |
| 吴 | 孙权 | 制衡 | `src/engine/skills/制衡.ts` |
| 吴 | 甘宁 | 奇袭 | `tests/scenarios/吴/奇袭.test.ts` |
| 吴 | 吕蒙 | 克己 | `tests/scenarios/吴/克己.test.ts` |
| 吴 | 黄盖 | 苦肉 | `tests/scenarios/吴/苦肉.test.ts` |
| 吴 | 大乔 | 国色 | `tests/scenarios/吴/国色.test.ts` |
| 吴 | 周瑜 | 英姿 / 反间 | `src/engine/skills/英姿.ts` |
| 吴 | 陆逊 | 谦逊 / 连营 | `tests/scenarios/吴/谦逊.test.ts` |
| 吴 | 孙尚香 | 结姻 / 枭姬 | `tests/scenarios/吴/结姻.test.ts` |
| 吴 | 太史慈 | — | （除天义外有）|
| 吴 | 孙坚 | 英魂 | `tests/scenarios/吴/英魂.test.ts` |
| 吴 | 凌统 | 救援 | `tests/scenarios/吴/救援.test.ts` |
| 群 | 张角 | 雷击 🟢 P3-T3 完整化 | 雷击 `src/engine/equipment/leiji.ts`（v3 useCard 钩子，读 ctx.leijiJudgeResult）；鬼道 / 黄天 `src/engine/skills/鬼道.ts` / `src/engine/skills/黄天.ts`（stub）|
| 群 | 貂蝉 | 离间 | `src/engine/skills/离间.ts` |
| 群 | 吕布 | — | （无双外）|
| 群 | 董卓 | — | （肉林/酒池/暴虐外）|
| 群 | 贾诩 | 完杀 🟢 v3 钩子 / 帷幕 🟢 v3 钩子 | 完杀 `src/engine/equipment/wansha.ts`；帷幕 `src/engine/equipment/weimu.ts`；（乱武外）|
| 群 | 蔡文姬 | 悲歌 | `tests/scenarios/群/悲歌-断肠.test.ts`（悲歌实现，断肠未实现）|
| 群 | 左慈 | 闭月 | `tests/scenarios/群/闭月.test.ts` |
| 群 | 华佗 | 急救 / 马术-鞬出 | `tests/scenarios/群/急救.test.ts` |

### 🟡 实现是 v2 stub + validate.ts 硬编码

- **武圣**（关羽）：`src/engine/skills/武圣.ts` stub，逻辑在 `src/engine/validate.ts:116`
- **龙胆**（赵云）：同上 `validate.ts:113/117`
- **倾国**（甄姬）：同上 `validate.ts:112`
- **奇才**（黄月英）：同上 stub
- **急救**（华佗）：🟡 部分，`src/engine/skills/急救.ts` 实际是 stub，靠 red 牌当桃（**待核查**）
- **看破**（卧龙诸葛）：`src/engine/skills/看破.ts` stub，逻辑靠 "锦囊可被无懈可击"
- **火计**（卧龙诸葛）：stub
- **咆哮**（张飞）：stub
- **激将**（刘备）：stub
- **空城**（诸葛亮）：🟢 **P0 v3 钩子实现**（`src/engine/equipment/kongcheng.ts`）——监听 `becomeTarget` atom，filter 收窄到【杀】/【决斗】，手牌为空时取消

### 🔴 未实现（27 个 it.skip / describe.skip）

见 [§3.1](#31-技能缺口)。

## 2.2 装备技能

| 装备 | 技能 | 状态 | 实现位置 |
|---|---|---|---|
| 诸葛连弩 | 诸葛连弩 | 🟡 stub | ``src/engine/equipment/stubs.ts`:8-15` |
| 雌雄双股剑 | 雌雄双股剑 | 🟡 stub | ``src/engine/equipment/stubs.ts`:42-49` |
| 青龙偃月刀 | 青龙偃月刀 | 🟢 | ``src/engine/equipment/stubs.ts`:51-69` |
| 贯石斧 | 贯石斧 | 🟢 | ``src/engine/equipment/stubs.ts`:71-100` |
| **青釭剑** | 青釭剑 | 🟢 **P1-1D-T3 修** | `src/engine/equipment/qinggang.ts`（v3 registerAtomHook 骨架：damage onAfter 注入 `penetrateArmor=true`）|
| **丈八蛇矛** | 丈八蛇矛 | 🟢 **P1-1D-T4 修** | `src/engine/equipment/zhangba.ts`（v3 registerAtomHook 骨架：specifyTarget filter 收窄）|
| **方天画戟** | 方天画戟 | 🟢 **P1-1D-T4 修** | `src/engine/equipment/fangtian.ts`（v3 registerAtomHook 骨架）|
| **八卦阵** | 八卦阵 | 🟢 **P3-T2 真 game rule 完整落地** | `src/engine/equipment/bagua.ts`（damage onBefore 读 `ctx.baguaJudgeResult`）+ `src/engine/equipment/_baguaJudgeInject.ts`（useCard 阶段 becomeTarget 钩子：读 deck 顶牌花色注入 `baguaJudgeResult` 到 state.localVars）|
| **仁王盾** | 仁王盾 | 🟢 **P1-1D-T4 修** | `src/engine/equipment/renwang.ts`（v3 registerAtomHook：黑杀 cancel）|
| 防具（**藤甲**/白银/寒冰）| 防具 | 🟢 **P3-T1 真 game rule 修** | `src/engine/equipment/tengjia.ts`（**P3-T1 反转**：防 normal 杀；旧实现"防 fire" 是 P1-1A-T2 错误已修）|
| 防具（**大雾**）| 防具 | 🟢 **P3-T1 真 game rule 修** | `src/engine/equipment/daqi.ts`（**P3-T1 反转**：防 non-thunder；旧实现"防 thunder" 是 P1-1A-T2 错误已修）|
| 进攻马/防御马 | 距离 | 🟢 | `src/engine/distance.ts` |

**火杀 +1 伤害**（P3-T1 骨架）：`src/engine/equipment/_fireKillDamageBonus.ts` —— v3 useCard 钩子，subtype='火杀'/'fire' → 2 点 damageType='fire' damage atom。**依赖** CardDef subtype 扩展（cards.ts 留 follow-up）。

## 2.3 卡牌

| 类型 | 卡牌 | 状态 | 实现位置 |
|---|---|---|---|
| 基本 | 杀 / 闪 / 桃 | 🟢 | `src/engine/handlers/card-handlers.ts:73-260` |
| 基本 | 酒 | 🔴 | `src/shared/cards/basic.ts` 未定义 |
| 基本 | 火杀 / 雷杀 | 🔴 | `src/shared/cards/basic.ts` 未定义 |
| 锦囊 | 过河拆桥 / 顺手牵羊 | 🟢 | `src/engine/handlers/card-handlers.ts:181-407` 手写 |
| 锦囊 | 南蛮入侵 / 万箭齐发 | 🟢 | `src/engine/handlers/response/aoe.ts` |
| 锦囊 | 决斗 | 🟢 | `src/engine/handlers/response/duel.ts` |
| 锦囊 | 无中生有 / 桃园结义 / 五谷丰登 | 🟢 | `src/engine/handlers/card-handlers.ts:181-407` 手写 |
| 锦囊 | 借刀杀人 | 🔴 | 未实现 |
| 锦囊 | 火攻 | 🔴 | 未实现 |
| 锦囊 | 铁索连环 | 🔴 | 卡牌定义存在但连环状态未建 |
| 锦囊 | 无懈可击 | 🟢 | `src/engine/handlers/response/trick.ts:17-62` |
| 延时 | 乐不思蜀 / 兵粮寸断 | 🟢 | `src/engine/atoms/pendingTrick.ts` |
| 延时 | 闪电 | 🟡 卡牌定义在，phase-advance 未处理 | `src/shared/cards/tricks.ts:82-89` |
| 装备 | 16 张全部 | 🟢 | `src/engine/atoms/equip.ts` |

**待新增**：
- 酒 / 火杀 / 雷杀 基本牌
- 借刀 / 火攻 完整流程
- 铁索连环 + 连环状态字段

---

## 3. 现状：未实现 (it.skip)

**23 个未实现技能**（来源：所有 `it.skip` / `describe.skip` 测试；P1/P2/P3 累计落 4 个 🔴 → 🟢）。按"缺失机制"分组。

## 3.1 技能缺口

### 拼点机制（5 个）

| 技能 | 武将 | 原因 | 落地建议 |
|---|---|---|---|
| 驱虎 | 荀彧 | 双方各出一张手牌比点数 | 抽 `pindian` SkillPhase + 新 atom `compareRank` |
| 天义 | 太史慈 | 同上 | 同上 |
| 制霸 | 孙策 | 同上 + 主公技 | 同上 + 主公判定 |
| 烈刃 | 祝融 | 拼点赢拿对手 1 张 | 同上 + 拿牌 atom |
| 双雄 | 颜良文丑 | 摸牌阶段展示 2 张选花色 | `pindian` 衍生 + 选花色 prompt |

**机制需求**（[T-03](#5-决策档案要点)）：**双方同时揭示**。pending 状态机表达"双方都在选"，揭示时一次 emit。

### 主公技 + 跨势力（3 个）

| 技能 | 武将 | 原因 | 落地建议 |
|---|---|---|---|
| 激将 | 刘备 | 蜀势力替他出杀 | `registerAtomHook(useKill, onAfter, filter: sourceRole=lord, prompt: 蜀势力角色)` |
| 黄天 | 张角 | 群势力交闪/闪电 | 主公判定 + 跨势力 prompt |
| 暴虐 | 董卓 | 群势力造成伤害后判定 | 监听 damage 事件 + 主公判定 |

**机制需求**：主公身份判定 + 同势力过滤。`registerAtomHook` filter 可查 `player.role === 'lord'`。

### 多步 prompt（4 个）

| 技能 | 武将 | 原因 | 落地建议 |
|---|---|---|---|
| 固政 | 张昭张纮 | 弃牌阶段拦截 | 多步 prompt：选目标 + 选牌 + 取牌 |
| 离间 | 貂蝉 | 选目标 + 选弃牌 | `multiRespond` SkillPhase |
| 乱武 | 贾诩 | 遍历所有其他角色 | `forEachLiving` + 强制出杀或掉血 |
| 蛊惑 | 于吉 | 多玩家质疑链 | `orderedChoice` + 判定链 |

**机制需求**（[T-04](#5-决策档案要点)）：**多步 prompt 链**。当前 skill handler 只能 `return [prompt, atoms, prompt, ...]`，第一个 prompt 完成时 plan 不会 emit，第二个 prompt 无法预知第一个的选择。**v3 SkillPhase 需支持 `multiStep` 或 `sequence` 内嵌 prompt**。

### 伤害转移 / 目标转移（3 个）

| 技能 | 武将 | 原因 | 落地建议 |
|---|---|---|---|
| 天香 | 小乔 | 弃红桃转移伤害 | `registerAtomHook(damage, onBefore, filter: sourceRole=x, return { cancel, redirect: target })` |
| 流离 | 大乔 | 杀目标转移 | `registerAtomHook(becomeTarget, onBefore, filter: target=self, prompt: 范围内其他角色)` |
| 借刀杀人 | 卡牌 | 借别人武器 | 借刀卡 = `useCard` 拆 3 原子（[T-13](#5-决策档案要点)）|

### 卡牌转换 / 酒牌 / 火攻 / 铁索（5 个）

| 技能 / 卡牌 | 原因 | 落地建议 |
|---|---|---|
| 断粮（徐晃）| 黑色基本牌当兵粮寸断 | `registerAtomHook(useCard, onBefore, filter: cardName=兵粮寸断, check: handIsBlack)` |
| 酒池（董卓）| 黑桃当酒 | 酒基本牌 + 卡牌转换 |
| 借刀杀人 | 卡牌效果 | 抽 `lendKill` SkillPhase |
| 火攻 | 卡牌效果 | 展示手牌 + 火属性判定 + 弃红桃 |
| 铁索连环 | 卡牌 + 连环状态 | 抽连环状态 + 重做 damage 链 |

### 状态系统：创牌 / 化身 / 翻面 / 主公技（7 个）

| 技能 | 武将 | 原因 | 落地建议 |
| 不屈 | 周泰 | 创牌系统 | `PlayerState.toughCards: CardId[]` + 专属原子（[T-08](#5-决策档案要点)）|
| 化身 / 新生 | 左慈 | 化身牌池 + 动态技能 | `PlayerState.huashen` 专用字段（[T-09](#5-决策档案要点)）|
| ~~完杀~~ | 贾诩 | 🟢 **P0 v3 已实现** | `src/engine/equipment/wansha.ts` —— 监听 `heal` atom，filter 查 characterId + 贾诩回合 + 目标非濒死，cancel |
| 断肠 | 蔡文姬 | 死亡移除技能 | `removeSkill` atom（[T-11 连带](#5-决策档案要点)）|
| 雷击 | 张角 | 🟢 **P3-T3 完整化** | `src/engine/equipment/leiji.ts` —— v3 useCard 钩子，filter 收窄 source=张角 + card.suit=♠ + card.rank 2-9，onAfter 读 `state.localVars.leijiJudgeResult === 'success'` 才 emit 3 点 `damageType='thunder'` damage atom。完整 useCard 阶段 inject `leijiJudgeResult` prompt 留 follow-up。|
| 鬼道 | 张角 | 判定牌替换 | `registerAtomHook(judge, onBefore, filter: 判定牌将生效, return { atom: replace })` |
| ~~帷幕~~ | 贾诩 | 🟢 **P0 v3 已实现** | `src/engine/equipment/weimu.ts` —— 监听 `becomeTarget` atom，filter 查 characterId + 黑色锦囊，cancel |

**机制需求**（[T-05/T-07](#5-决策档案要点)）：**Mark 体系**（faceDown 等状态）。Mark 不带 hooks 字段（[T-05](#5-决策档案要点)），所有"读点"走 registerAtomHook。

### 装备：雌雄双股剑

| 装备 | 原因 | 落地建议 |
|---|---|---|
| dualWeapon | 装备注册但 handler 空 | `registerAtomHook(specifyTarget, onAfter, filter: cardName=杀 && target.gender !== self.gender, prompt: 双方各弃 1 张)` |

## 3.2 卡牌缺口

| 卡牌 | 状态 | 落地建议 |
|---|---|---|
| 酒 | 🔴 `src/shared/cards/basic.ts:29` 未定义 | 加 CardDef，type='basic', subtype='酒' |
| 火杀 / 雷杀 | 🔴 | 加 CardDef，type='basic', subtype='火杀' / '雷杀' |
| 借刀杀人 | 🔴 | 抽 useCard 拆 3 原子（[T-13](#5-决策档案要点)）|
| 火攻 | 🔴 | 展示手牌 + 火判定 + 弃红桃 |
| 铁索连环 | 🔴 卡牌定义在 | chained 已迁 Mark（id='chained'），本任务仅需卡牌 handler 调用 `设横置` atom |
| 闪电 | 🟡 `pendingTrick.name === '闪电'` phase-advance 未处理 | `src/engine/phase-advance.ts:77-81` 加分支 |

---

## 4. 现状：实现与设计不一致

> 这些代码"在跑"，但**不是按设计文档表达**。未来重构需要修复。

## 4.1 validate.ts 硬编码技能转换

**位置**：`src/engine/validate.ts:73-119` `getSkillConvertedCards`

```ts
// src/engine/validate.ts:111-118
if (targetType === '闪' && (trigger.event === 'killResponse' || trigger.event === 'aoeResponse')) {
  if (skillId === '倾国' && isBlack) return true;
  if (skillId === '龙胆' && card.name === '杀') return true;
}
if (targetType === '杀') {
  if (skillId === '武圣' && isRed) return true;
  if (skillId === '龙胆' && card.name === '闪') return true;
}
```

**问题**：validate 不该知道技能。新增"X 当 Y"技能要改 validate。

**修复方向**：抽 `SkillDef.convertible: { from: CardName, to: CardName, filter: Expr<boolean> }`，validate 读这个字段。

## 4.2 八卦阵 var 写了不读

**位置**：
- 写：``src/engine/equipment/stubs.ts`:144-176` `八卦阵/dodged` var
- 读：**无**
- 测试 `tests/scenarios/装备/八卦阵.test.ts:31` 查这个 var

**问题**：测试通过但**实际 八卦阵不生效**（validate 不查 var）。

**修复方向**：把"是否生效"判断移到 `validate.ts` 或 `useKill` 钩子。

## 4.3 4 个武器空 stub

**位置**：``src/engine/equipment/stubs.ts``

- 青釭剑 ignoreArmor (line 17-28)
- 丈八蛇矛 twoCardsAsKill (line 200-203)
- 方天画戟 multiTarget (line 185-189)
- 仁王盾 blockBlackKill (line 172-174)

**问题**：handler 存在但**实际无效果**。装备注册但穿防具 / 2 张当杀 / 多目标 / 黑杀无效 **都不生效**。

**修复方向**：抽对应 `registerAtomHook`：
- ignoreArmor = `onBefore(useCard, filter: 杀)` 改 penetrateArmor 字段
- twoCardsAsKill = `onBefore(useCard, filter: cardName=杀 && source has 丈八蛇矛, prompt: 选 2 张手牌当杀)`
- multiTarget = `onAfter(specifyTarget, filter: source has 方天画戟, additionalAtoms: 出更多杀)`
- blockBlackKill = `onBefore(useCard, filter: 杀 && isBlack && target has 仁王盾, cancel)`

## 4.4 触发器 phase 字段仅 phaseBegin 生效

**位置**：`src/engine/skill.ts:147-153`

```ts
// 仅 phaseBegin 事件检查 phase 字段
if (def.trigger.phase && event.type === 'phaseBegin' && event.phase !== def.trigger.phase) {
  continue;
}
```

**问题**：其他事件（`onCardPlayed` 等）的 `phase` 字段**被静默忽略**。技能注册时写 `phase: '出牌'` 但事件是 `cardPlayed` → 永远触发。

**修复方向**：每个事件类型的 phase 检查都加分支。

## 4.5 双钩子系统长期并存

详见 [§0.3](#03-已知文档代码不一致) + [T-25](#5-决策档案要点)。

## 4.6 判定牌取错位置

**位置**：`src/engine/atoms/judge.ts:34-79`

**问题**：`getResult` 从 `discardPile[top]` 取最后一张作判定牌，但 discardPile 是全局弃牌堆，期间其他弃牌（杀/无懈/出牌）会插入错牌。

**修复方向**：`apply` 时把判定牌 cardId 显式存到 `ctx.localVars.judgeCardId`，`getResult` 读这个字段（不读弃牌堆）。

## 4.7 draw 重洗未 emit 事件

**位置**：`src/engine/atoms/draw.ts:7-28` `reshuffleIfNeeded`

**问题**：重洗牌堆后**不发 `reshuffle` 事件**，reducer 不知道牌堆被洗过。

**修复方向**：抽 `reshuffle` atom，draw atom 在 `reshuffleIfNeeded` 后 `applyAtoms(reshuffle)`（[T-14](#5-决策档案要点)）。

## 4.8 持续状态走 Mark 体系

`src/engine/mark.ts` + `src/engine/atoms/mark.ts` 是**所有持续状态**的唯一通道。

**当前 PlayerState（`src/engine/types.ts:75-88`）**：
* 不含 `chained: boolean` —— **chained 已迁 Mark**：id='chained', scope='player', duration='permanent'。由 `设横置` atom 在 chained=true 时 `加标记({id:'chained',...})`，chained=false 时 `去标记('chained')`。钩子读 `hasMark(state, player, 'chained')`。
* 不含 `faceUp: boolean` —— 翻面（曹仁据守、贾诩放逐）用 Mark `faceDown`，duration='untilTurnEnd'，由 phase-advance 在 `回合结束` 时清。
* `state.marks: Record<PlayerId, Mark[]>`（顶层字段，**不**进 PlayerState）：所有按玩家分组的 Mark 列表。
* 不含 `dying: boolean` —— 濒死走 PendingDyingWindow，不是状态。

**决策**（[T-05/T-07](#5-决策档案要点)）：`Mark = { id, scope, payload?, duration }`。**所有"持续状态"都是 Mark**（含 chained、faceDown、leijiPending 等），不走独立字段。例外：`toughCards`（创牌，[T-08]）是牌区，`huashen`（化身，[T-09]）是动态技能注册子系统——这两类不归 Mark。

**迁移记录**：
* chained：✅ 本次迁移完成（Mark id='chained'，原子 `设横置` 改写）
* faceDown：未实现（断肠/曹仁据守/贾诩放逐 仍 stub）
* leijiPending：未实施（雷击占位真 game rule 完整判定需此 Mark）


---

## 5. 决策档案（要点）

这里是 26 条决策的**摘要**。每条决策的具体推导在 2026-06-04 / 06-05 议程中讨论。

| 编号 | 主题 | 决策摘要 | 影响 |
|---|---|---|---|
| **T-01** | 同步冻结 | 沿用 v2 + `registerAtomHook` 拦截 | 不改 pending 模型 |
| **T-02** | 事务回滚 | **不引入事务** | 多步 `applyAtoms` + 钩子 cancel + 目标检查 |
| T-03 | 拼点揭示 | 双方同时揭示 | pending 状态机表达 |
| T-04 | 缔盟差值 | 标准鲁肃自己弃差值，不够不发动 | 界鲁肃/神陆逊推迟 |
| T-05 | Mark 读点 | 走 `registerAtomHook` 钩子 | Mark 本身不带 hooks 字段 |
| T-06 | 不能成为目标 | 被 T-01 解决 | 空城/帷幕/谦逊同模式 |
| T-07 | 翻面持续 | Mark `faceDown` + `untilTurnEnd` | phase-advance 跳过 |
| T-08 | 创牌 | 独立牌区 `toughCards`（不走 Mark）| 周泰不屈 |
| T-09 | 化身 | 左慈专用 `huashen` 数据结构 | 不与 T-08 合并 |
| T-10 | 观星 vs 鬼道 | 不统一，YAGNI | 观星走 rearrangeDeck，鬼道走 judge 钩子 |
| T-11 | Damage 类型 | 加 `type: 'normal' \| 'fire' \| 'thunder'` 字段 | 藤甲/大雾/连环读 type |
| T-12 | 仁德/突袭 | 抽 3 原子 `giveCard` / `takeCard` / `moveCard` | 13+ 技能语义统一 |
| T-13 | 借刀 / useCard | 拆 3 原子 `specifyTarget` / `becomeTarget` / `resolveCard` | 取消 GameEvent 概念 |
| T-14 | RNG / 重洗 | 新增 `reshuffle` atom | 修 [§4.7](#47-draw-重洗未-emit-事件) |
| T-15 | 时间确定性 | 状态机已确定（v2 现状 OK）| 0 变更 |
| T-16 | ~~priority~~ | ~~沿用 0/3/5 + 座位决胜~~ 已被 T-26 推翻 | — |
| T-17 | timeout 默认 | 沿用 v2 per-pending onTimeout 显式 | 0 变更 |
| T-18 | 视图 | 已被 ADR 0010 解决 | 0 变更 |
| T-19 | vars 迁移 | v3 不用 vars 触发技能 | vars 字段保留作私有 any |
| T-20 | 双源 | character.ts 只留元信息 | effect/condition 全删 |
| T-21 | v2/v3 共存 | v3 在 `src/engine/v3/` 独立目录 | v2 路径保持 |
| T-22 | 删 v2 触发 | 38+ 技能迁完 + 2 周稳定期 | 渐进 PR |
| T-23 | 性能 | 1ms / 5ms / 100ms 预算 | 加基准测试 |
| T-24 | 测试覆盖 | v3 强制走真实路径 | 禁止 emitEvent 直接驱动 |
| **T-25** | 三套钩子 | **完全迁移 `registerAtomHook`，老技能作废** | v3 测试只用 registerAtomHook |
| **T-26** | priority 字段 | **去掉** priority，顺序 = 注册顺序 | 改 `src/engine/skill-hook.ts:49-50,71` + 加独立性约束 |

**推翻昨天 0001 设计的章节**：
- §1.4 时序原子 → 钩子拦截
- §2.1 Mark 统一 → 拆 Mark / 独立牌区 / 左慈专用 3 种
- §2.2 Transaction → 不引入
- §2.4 JudgeStep → 观星/鬼道不统一
- §2.6 Damage "preventableBy Mark" → type 字段
- §3 Skill Handler → 取消 GameEvent

---

## 6. 改进路径（按依赖） ✅ **P0/P1/P2/P3 全部完成**（2026-06-05 / 06-06，43 commits）

> 排序按"解锁技能数"。

### P0：必做（落地 5 技能 + 4 atom 解锁 18 技能） ✅ 全部完成（2026-06-05，12 commits / 1306 tests pass）

| 项 | 工作量 | 解锁技能 | 状态 |
|---|---|---|---|
| 抽 `reshuffle` atom | 1h | draw 重洗重放修复 | ✅ |
| 抽 `giveCard` / `takeCard` / `moveCard` 3 原子 | 2h | 仁德/突袭/反间/好施/黄天/集智/借刀失败/归心/反馈/烈刃/雷击/顺手牵羊/过河拆桥 语义统一 | ✅ |
| 抽 `useCard` 3 原子 + 取消 GameEvent | 4h | 借刀/五谷/桃园/南蛮/万箭 的 3 阶段钩子 | ✅ |
| 抽 `pindian` SkillPhase | 4h | 驱虎/天义/制霸/烈刃/双雄 5 个技能 | ✅ |
| 抽 `multiStep` SkillPhase | 4h | 固政/离间/乱武/蛊惑 4 个技能 | ✅ |
| 实现完杀 + 空城 + 帷幕（用 `registerAtomHook` 模板）| 1h | 3 技能演示 | ✅ |

**P0 完成后**：18 个未实现技能中的 16 个**有了清晰落地路径**。

**P0 实际交付**（2026-06-05，6 Task / 12 commits / 1306 tests pass）：

| 项 | Commit | ADR |
|---|---|---|
| `reshuffle` atom | `ce2cb39` + `364eb4a` | [0014](#7-adr-索引) |
| `giveCard` / `takeCard` 原子 | `fdbefe1` + `cbd1bd4` | [0015](#7-adr-索引) |
| `useCard` 3 原子 | `6901023` + `30f2d55` | [0016](#7-adr-索引) |
| `pindian` SkillPhase + `compareRank` | `aa8bec6` + `f1e97dd` | [0017](#7-adr-索引) |
| `multiStep` SkillPhase | `0be358b` + `fd31f69` | [0017](#7-adr-索引) |
| 完杀 / 空城 / 帷幕 | `38d327f` + `c0f97b1` + `d90be01` | （演示模板，commit `d90be01` 修 trigger 残留）|

### P1：推荐 ✅ 全部完成（2026-06-06，18 Task / 20 commits / 1361 tests pass）

| 项 | 工作量 | 解锁技能 | 状态 |
|---|---|---|---|
| 抽 `damage.type` 字段 | 1h | 藤甲 / 大雾 / 雷电伤害 / 火杀 / 雷击 / 连环传导 | ✅ |
| 抽 `loseHealth` atom | 1h | 苦肉 | ✅ |
| 抽 `loseCard` atom | 1h | 过河拆桥 / 借刀失败 | ✅ |
| 抽 chained Mark + Mark faceDown | 4h | 铁索连环 / 周泰创牌 / 曹仁据守 / 贾诩放逐 / 雷击 | ✅（chained 本次迁 Mark）|
| 抽 `removeSkill` atom | 1h | 断肠 / 化身换技能 | ✅ |
| 抽 `addBuff` / `removeBuff` atom | 2h | 诸葛连弩 / 裸衣 / 白酒 | ❌ 留 P2 范围外（无技能真实使用）|
| 修 4 武器 stub | 4h | 4 装备 | ✅ |
| 修 validate.ts 硬编码（抽 `convertible` 字段）| 2h | 武圣/龙胆/倾国 迁出 validate | ✅（奇才留 stub）|
| 修八卦阵 var 不读 | 1h | 八卦阵真实生效 | 🟡 P1-1D-T2 占位 cancel（真 game rule 留 P3-T2）|
| 修判定牌取错位置 | 1h | 洛神/刚烈/再起/悲歌 修复 | ✅ |
| 修触发器 phase 字段 | 1h | 所有"phase=出牌" 的 onCardPlayed 技能 | ✅ |
| 抽 `redirect` / `transferDamage` | 2h | 天香 / 流离 / 借刀 | ✅（钩子就位，技能实现留后续）|
| 抽 `shuffleDeck` | 1h | 鬼道 / 闪电改判 | ✅ |

**P1 完成后**：再解锁 **20+ 技能 / 装备**。

### P2：长期 ✅ 全部完成（2026-06-06，5 Task / 5 commits / 1385 tests pass）

| 项 | 工作量 | 解锁技能 | 状态 |
|---|---|---|---|
| RNG 统一 | - | reshuffle / shuffleDeck 语义一致 | ✅ |
| faceDown Mark 跳整回合 | - | 曹仁据守 / 贾诩放逐 / 雷击前置 | ✅ |
| 雷击 v3 钩子骨架 | - | 张角雷击 | ✅（占位，完整判定留 P3-T3）|
| 八卦阵 damage onBefore 读 ctx | - | 八卦阵真 game rule 兜底 | 🟡 占位 red（真 game rule 留 P3-T2）|
| memo test 改逻辑模式 | - | 修 pre-existing timing flake | ✅ |

### P3：4 个 P2 follow-up ✅ 全部完成（2026-06-06，4 Task / 4 commits / 1404 tests pass）

| 项 | 工作量 | 解锁技能 | 状态 |
|---|---|---|---|
| **大雾反转** | - | 大雾防 non-thunder | ✅ |
| **藤甲真规则** | - | 藤甲防 normal 杀 | ✅ |
| **火杀 +1 伤害骨架** | - | 火杀 amount=2 | ✅（依赖 CardDef subtype 扩展）|
| **八卦阵 useCard 阶段判定注入** | - | 八卦阵真 game rule 完整化 | ✅ |
| **雷击完整判定** | - | 读 ctx.leijiJudgeResult，success 才 emit | ✅ |
| **faceDown + 死亡玩家兼容** | - | nextPlayer 已处理死亡，faceDown 路径无冲突 | ✅ |

**累计解锁 23 个真 game rule**（其中 4 个 P1 addBuff/removeBuff 仍未实施）。

| 项 | 工作量 | 解锁技能 |
|---|---|---|
| 抽 `forEachLiving` / `forEachWithDistance` | 4h | 乱武（已 P0） / 火攻展示 |
| 抽 `multiRespond` SkillPhase | 4h | 肉林 / 无双 |
| 抽 `orderedChoice` SkillPhase | 4h | 蛊惑（已 P0）|
| 抽 `counter` SkillPhase | 2h | 双雄（已 P0）|
| 抽 `branch` SkillPhase | 2h | 明哲（陈宫）|
| 抽酒/火杀/雷杀 基本牌 | 2h | 酒池 / 火杀 / 雷击 / 火攻 |
| 抽借刀杀人 完整流程 | 4h | 借刀 |
| 抽火攻 完整流程 | 4h | 火攻 |
| 抽铁索连环 完整流程 | 4h | 铁索连环 / 庞统连环 |
| 抽化身牌池 系统 | 8h | 化身 / 新生 |
| 抽断肠 unregister 系统 | 2h | 断肠 |
| 抽救援 onHealFromAlly | 1h | 救援 |
| 抽完杀桃使用限制 | 1h | ~~完杀（已 P0 完杀钩子）~~ ✅ P0 已 v3 实现（commit `38d327f`/`c0f97b1`）|
| 抽闪电视效 完整流程 | 4h | 闪电 |

### 性能 + 测试

- 性能基准测试套件（[T-23](#5-决策档案要点)）
- v3 测试覆盖：每个技能 1 个 e2e + 每个 atom 1 个 toEvents（[T-24](#5-决策档案要点)）

### 渐进迁移（38+ 老技能）

- 每次 PR 迁 1-3 个 `trigger.event` 技能到 `registerAtomHook`
- 迁完一个，删一个 `state.triggers` 引用
- 全部迁完 + 2 周稳定期后，删 v2 路径（[T-22](#5-决策档案要点)）

---

## 7. ADR 索引

| 编号 | 标题 | 何时读 |
|---|---|---|
| [0008](./decisions/0008-styling-linaria.md) | Linaria 样式 | UI 改样式时 |
| [0009](./decisions/0009-cas-baseSeq.md) | CAS baseSeq | 序列号 / 并发 / 断线重连 |
| [0010](./decisions/0010-game-logger-playerops.md) | GameLogger + PlayerOps | 视图隔离 / 服务端日志 / ReplayEngine |
| [0011](./decisions/0011-lifecycle-atoms.md) | 生命周期原子（已被 0012 取代）| 历史 |
| [0012](./decisions/0012-unified-apply-atoms.md) | 统一 applyAtoms | **核心**：所有 atom 必经 `src/engine/atom.ts:applyAtoms` |
| [0013](./decisions/0013-phase-begin-end-atoms.md) | phaseBegin/End 显式成对 | 阶段推进原子化 |
| [0014](./decisions/0014-reshuffle-atom.md) | reshuffle atom | 修 §4.7 draw 重洗不写 serverLog |
| [0015](./decisions/0015-give-take-move-3-atoms.md) | giveCard/takeCard 3 原子 | 13+ 技能语义统一 |
| [0016](./decisions/0016-use-card-3-atoms.md) | useCard 3 原子 | specifyTarget / becomeTarget / resolveCard |
| [0017](./decisions/0017-skill-pindian-multistep.md) | pindian / multiStep SkillPhase | 拼点 + 多步 prompt 骨架 |
| [0013](./decisions/0013-skill-character-decouple.md) | 技能/角色/装备解耦 | **架构**：engine/{characters,skills,equipment} 分层（56 单文件、equipment 独立目录）|
| [0018](./decisions/0018-deprecated-test-apis.md) | 废弃全局测试 API | 测试从 `clearXxx()` 迁到 `engine.clearForTest()`；`currentEngineHooks` 实现多实例隔离 |
| [0025](./decisions/0025-async-hooks.md) | 异步钩子（v3 引擎终态） | onBefore/onAfter 改 async function + `pending()` helper 挂起等玩家；替代 v2 SkillPhase DSL；51 技能 v3 化前置架构 |
**未来 ADR 候选**：
- Mark 体系（[T-05/T-07](#5-决策档案要点)）
- 钩子迁移 38+ 技能策略（[T-25](#5-决策档案要点)）

---

## 8. 附录

## 8.1 关键代码位置

| 模块 | 路径 |
|---|---|
| 状态机入口 | `src/engine/create-engine.ts:createEngine` → `engine.dispatch(state, action)` |
| 统一 atom 入口 | `src/engine/atom.ts:applyAtoms` |
| Skill registry | `src/engine/skill.ts`（v2 全局，已 `@deprecated`）| 
| 引擎实例 | `src/engine/create-engine.ts:createEngine` 返回 `EngineInstance` |
| 钩子注册 | `src/engine/skill-hook.ts:HookRegistry` / `applyAtoms(_setCurrentEngineHooks)` 机制 |
| 阶段推进 | `src/engine/phase-advance.ts` |
| 触发器 | `src/engine/skill.ts:emitEvent`（🟡 老）|
| 重放 | `src/engine/replay.ts` + `src/engine/view/reducer.ts` |
| 服务端 | `src/server/session.ts:engineLoop` |

## 8.2 关键测试位置

| 类别 | 路径 |
|---|---|
| 单元 atom | `tests/atoms/` |
| 单元 skill | `tests/unit/skill-hook.test.ts` |
| 场景技能 | `tests/scenarios/{魏,蜀,吴,群,装备,交互}/` |
| 端到端 | `tests/e2e-regression.test.ts` |
| 重放 | `tests/serializer.test.ts` |

## 8.3 文档

- 设计文档（本文）：`docs/ENGINE.md`
- 决策档案：[§5 决策档案（要点）](#5-决策档案要点)（26 条决策摘要）
- ADR 索引：[§7](#7-adr-索引)
