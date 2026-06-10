# 三国杀引擎重写评审（对照 `docs/ENGINE-DESIGN.md`）

> 评审日期：2026-06-10  
> 评审范围：`src/engine/`（新引擎）、`src/server/`、`src/client/`、`tests/`  
> 评审对照：设计文档 `docs/ENGINE-DESIGN.md`（§1–11）

---

## 总体结论

**P0 重写完成度约 60%**。架构骨架（atom + skill + settlement + createEngine）已就位，5 个简单技能（杀/闪/桃/酒/仁德/制衡/护甲）跑通 dispatch，端到端 gameplay 测试 12/12 通过。但**与设计文档"完成态"的差距仍然巨大**：服务端缺超时/旁观/事件流差量；客户端有旧 v2 路径完全并行残留（`GameBoard`/`DebugPlayerList`/`Prompts`/`GameBoardData`/5 个 utils），它们继续 import 已删除的旧类型（`GameAction`/`ValidAction`/`PendingAction`/`PromptOption`/`AvailableSkill`/`SequencedEvent`/`FrontendState`）和已不存在的模块路径（`@engine/validate`、`@engine/characters`、`@engine/skill-hook`、`@engine/distance`、`@engine/state`、`@engine/engine`、`@engine/atom`/`view/reducer`），全量测试 **154/194 文件 fail**；技能实现 4 完整 / 4 部分 / 3 骨架；设计文档 §11 五场景 A–E 中**只有杀/护甲/仁德有端到端 dispatch 测试**。

按维度估算完成度：

| 维度 | 完成度 | 备注 |
|---|---|---|
| 引擎核心骨架（atom + skill + settlement） | 75% | 接口与流程正确，awaits/notification 不完整 |
| Atoms 覆盖 | 100% | 38 atoms 全在；与 spec 字段有 5 处增量（CHANGELOG 记录） |
| 技能实现正确性 | 40% | 11 个技能中 4 完整 / 4 部分 / 3 骨架 / 0 个"装备技能" |
| 服务端（`src/server/`） | 70% | 切到新引擎，但缺超时/差量/旁观；actionLog baseSeq 写错 |
| 前后端契约 | 80% | ClientMessage 对齐，旧类型有 5 处残留 |
| 前端解耦 | 60% | 新流（`GameViewComponent`）纯渲染；旧流（`DebugPlayerList`）调 `computeValidActions`/`getDistance` 仍在前端算规则 |
| 测试 | 35% | 12/12 新引擎独立通过；全量 154/194 fail，**全部 fail 根因是 v2 残留模块路径** |
| 文档 §11 场景覆盖 | 20% | 场景 A 跳过 / B 缺 / C 缺 / D 缺 / E N/A |
| Tree-shaking | 0% | 前后端用同一份 `src/engine/skills/index.ts`，未做 entry 分离 |

---

## 1. 引擎核心（`src/engine/`）

### ✓ 已实现（与设计一致）

- **Atom 注册表 + 同步 apply pipeline**：`atom.ts`（30 行）— `registerAtom` / `applyAtom` / `resolvePlayerViews`（`src/engine/atom.ts:7-35`）
- **Settlement stack 与 frame 构造**：`settlement.ts` — `makeFrame` 实现的 apply pipeline 顺序为 `before hooks → validate → apply → awaits 检测 → after hooks`，与设计 §6.1 完全一致（`src/engine/settlement.ts:46-118`）
- **Per-player 实例化技能**：`createEngine.bootstrap` 按 `state.players[].skills` 给每个玩家 `createSkill + onInit`（`src/engine/create-engine.ts:35-54`）
- **action 注册与路由**：`registerActionEntry` / `findActionEntry(skillId, ownerId, actionType)`（`src/engine/skill.ts:43-55`）
- **CAS 静默丢弃**：`GameSession.handleAction` 中 `if (baseSeq !== undefined && baseSeq !== this.state.seq) return`（`src/server/session.ts:189-191`）
- **ClientMessage 路由**：`{ skillId, actionType, ownerId, params, baseSeq }` 与 spec §2 一致（`src/engine/types.ts:302-308`）

### ⚠ 部分实现（偏离设计）

1. **awaits 实现割裂**
   - 现状：settlement frame 的 `awaits` 只在 `settlement.ts:87-100` 触发 `PendingInterrupt`，但仅**杀/闪场景**在 `create-engine.ts:60-148` 显式判断 `pendingRequest.status === 'waiting'` 处理回应。
   - 偏离：`请求回应` atom（遗计/激将/护甲/其他"是否发动"流程）**没有 `awaits` 字段**（`src/engine/atoms/请求回应.ts:6-21`），所以调用后**不会暂停**——execute 直接跑完。
   - 影响：遗计确认"是否发动"、激将请"是否出杀"、护甲黑杀减伤**全都不会真的等玩家回应**。当前测试通过是因为只测了同步路径。

2. **Pending 结算逻辑硬编码在 `create-engine.ts:106-141`**
   - 杀闪的多目标 settlement 逻辑（`settlement[*].dodged` → 扣血 → 弃牌）**没在技能 execute 里**，而是被 dispatch 顶层代码"代为执行"（`src/engine/create-engine.ts:107-141`）。
   - 偏离设计：§4.3 写"杀 execute 包含全部结算"（含最终造成伤害、移动到弃牌堆）。当前实现是 "skill 只管一半"。
   - 风险：所有受多目标 / 跳过闪影响的技能（南蛮入侵、万箭齐发、决斗）都要在 dispatch 里继续硬编码，或者重构 settlement 机制。
   - 修法：让 `frame.apply` 在 after hooks 后**继续**执行 skill execute 的剩余代码（用 `async` 回调/迭代器），而不是抛 `PendingInterrupt` 终止。

3. **notify 事件未实现**
   - `frame.notify` 在 settlement.ts:122 是 no-op；`api.notify` 在 skill.ts:159 也是 no-op（`src/engine/skill.ts:158-160`）。
   - 缺：技能主动广播 UI 事件（如八卦阵翻牌动画、无懈可击链）的能力。
   - 缺：event-stream.ts 只是 `perPlayerEvents[]` 的内存 Map（`src/engine/event-stream.ts:5-16`），但**没有调用方**。

4. **frame.apply 对 after-hook 的 apply 处理半截**
   - `afterCtx.apply`（`settlement.ts:108-111`）递归 `frame.apply(a)`，但当前 after-hook 内调 apply 的代码（如遗计、护甲）**没在任何测试里覆盖**，因为他们根本不会进入 after（`请求回应` atom 不暂停）。

5. **`buildView` 中 `pending` 提示硬编码 2 种**
   - 设计 6 种 ActionPrompt：buildView 只把 `询问闪` 映射到 useCard，`询问杀` 映射到 useCard，其余都退化为 `confirm`（`src/engine/view/buildView.ts:36-48`）。
   - 缺：`distribute`（遗计分配牌）、`choosePlayer`（反馈）、`useCardAndTarget`、`selectTarget` 都无 UI 路径。

6. **drop/modifyParams 副作用语义对 after hook 不到位**
   - 设计 §4.5："after 钩子 modifyParams 影响后续 atom 读到的参数"。当前 afterCtx.modifyParams 修改的是 frame.params（`settlement.ts:105-107`），但因为 execute 已被 PendingInterrupt 终止，**后续代码不会跑**，相当于 modifyParams 失效。

7. **`api.apply` 在 makeBackendAPI 是 no-op**（`src/engine/skill.ts:155-157`）
   - 技能代码里 `api.apply(atom)` 直接返回 `Promise.resolve()`，**不真的入栈**。这意味着护甲、遗计、激将这些用 `api.apply({ type: '请求回应' })` 的代码完全没生效。

8. **ownerId 协议混乱**
   - `ClientMessage.ownerId` 字段在协议层是**玩家中文名**（'刘备'/'P1'），不是 webSocket 端生成的 `player_1_xxx` ID。session.ts 用 `playerNames.get(playerId)` 映射（`src/server/session.ts:192-197`）。
   - 风险：debug 模式 / 多人模式下 playerId 规则不同（`session.ts:98-109`），容易引发"非预期 owner" 误判。

### ✗ 缺失

1. **Tree-shaking**：`src/engine/skills/index.ts` 一次性 import 所有技能，前后端用同一份。设计 §4.1 "前端不引用 onInit, BackendAPI 及后端逻辑被 tree-shake" 未实现。`vite.config.ts` / `tsconfig.json` 没有为后端/前端分别定义 entry。
2. **`tree-shaking` 衍生：技能模块未按 player 懒加载**。设计 §4.13 写"添加技能时 import 模块 → createSkill → onInit/onMount"，当前 `bootstrap` 一次性为所有玩家的所有技能 instantiate。
3. **服务端超时**：`buildView` 写 `Date.now() + 30_000`/`+ 60_000` 硬编码（`src/engine/view/buildView.ts:45,54`），但**服务端不调度**——客户端倒计时跑完会发"不出"或"结束回合"，但服务端没 setTimeout 兜底（`PendingInterrupt.deadline` 字段写了却无人读）。
4. **重连事件流差量**：`ServerMessage` 定义了 `events: { fromSeq, events[] }`（`src/server/protocol.ts:17`）但**无人使用**。重连是整包 `initialView`/`debugGameState` 推送（`src/server/session.ts:217-233, 245-254`）。
5. **旁观**：不支持。ServerMessage 没 spectator 类型，buildView 的 `viewer` 只用于手牌隔离。
6. **distance / validate 引擎模块缺失**：`src/engine/distance.ts`、`src/engine/validate.ts` 不存在，但旧 GameBoard / DebugPlayerList 还在 import。`computeValidActions`/`getDistance` 等老入口无处可寻。
7. **`settle/modifyParams` 接口**：`SettlementFrame` 类型定义（`src/engine/types.ts:286-298`）声明的 apply/modifyParams/notify 字段全是 `any`/空——实际方法只在 `makeFrame` 内闭包实现，类型与实现完全不对齐。

---

## 2. 技能实现正确性（对照 §4.10）

### 矩阵

| 技能 | 文件 | 状态 | 与 §4.10 差异 |
|---|---|---|---|
| 杀 | `skills/杀.ts` | ⚠ 部分 | 单目标 OK；多目标 `settlement` 循环在 `create-engine.ts:106-141` 代为执行；未加 `+酒/1` 等加伤 mark（酒独立处理）；不更新 `frame.params['杀/killsPlayed']`（移到 `player.marks` 由每 turn 清理） |
| 闪 | `skills/闪.ts` | ⚠ 部分 | 通过 `frame.parent.params.settlement` 改 dodged（间接），非设计要求"在当前帧上操作 + drop"；且不调用 `frame.drop()` |
| 桃 | `skills/桃.ts` | ✓ 完整 | 移动→回复→弃牌流程正确 |
| 酒 | `skills/酒.ts` | ✓ 完整 | onAtomBefore + 加标记/再 apply |
| 仁德 | `skills/仁德.ts` | ✓ 完整 | 多目标给牌 + ≥2 张回血 + 限一次 |
| 护甲 | `skills/护甲.ts` | ⚠ 部分 | before 钩子 drop + 加 guard mark + re-apply 思路对，但 amount=1 时不发任何伤害 atom（直接 drop），与设计 §4.5 例子"modifyParams + drop"语义不同 |
| 制衡 | `skills/制衡.ts` | ✓ 完整 | 弃1摸2 |
| 武圣 | `skills/武圣.ts` | ✗ 骨架 | `onMount` 缺失（CHANGELOG 也确认）；`defineAction('transform')` 缺失；onAtomAfter 还原钩子体为空（`src/engine/skills/武圣.ts:19-24`） |
| 遗计 | `skills/遗计.ts` | ⚠ 部分 | after 钩子跑 confirm + 摸 2 + 第二次"分配"——但 `cardIds: []`（`skills/遗计.ts:33`）空分配，分配循环全无，**没有真正的给予牌 atom** |
| 激将 | `skills/激将.ts` | ✗ 骨架 | 只发"是否出杀"请求，**没有后续读取回应 + 出杀/摸牌的逻辑**（`skills/激将.ts:26-35`） |
| 回合管理 | `skills/回合管理.ts` | ✓ 完整 | 自动推进 6 阶段；摸牌阶段自动摸 2；出牌/弃牌阶段让玩家操作 |

**未实现的核心技能**（与设计 §4.10 强相关）：
- 八卦阵（无独立文件，CHANGELOG 提到的"八卦阵"测试在 `tests/scenarios/装备/八卦阵*` 走的还是 v2 路径 + `applyAtoms`，**不是新 createEngine**）
- 流离（`tests/scenarios/吴/流离.test.ts` 是 `it.skip`："引擎暂不支持"）
- 南蛮入侵 / 万箭齐发 / 决斗（无文件）
- 无懈可击（无文件）
- 反馈（无文件，遗计+反馈联动场景 D 缺一半）
- 借刀 / 火攻 / 过河拆桥 / 顺手牵羊（无文件）

**所有装备技能（8 个）缺失**。CHANGELOG 写"PR 7-10: 17 锦囊 + 8 装备" pending。

### 关键偏差举例

1. **闪的实现路径错误**（`src/engine/skills/闪.ts:29-36`）  
   设计 §4.10：
   ```ts
   const item = frame.params.settlement.find(s => s.target === from);
   item.dodged = true;
   frame.drop();  // 丢栈顶——询问闪 atom 不会真正 apply
   ```
   当前：直接改 `frame.parent.params.settlement`（破坏封装），且不调 `frame.drop()`。
   后果：询问闪 atom 仍会"真正 apply"（虽然 apply 是空操作，但 after 钩子会跑），影响后续帧的 hook 顺序。

2. **杀的 execute 不完整**（`src/engine/skills/杀.ts:25-44`）  
   杀 execute 只做 4 步：移牌→指定目标→询问闪→（pending）。**没有** §4.10 例子中的：
   - `for (const item of settlement)` 循环多目标
   - 询问闪之后**造成伤害**
   - 处理区→弃牌堆
   - 出杀次数自增
   
   这部分被 `create-engine.ts:107-141` "代为执行"。违反"技能自己控制结算"原则。

3. **遗计分配空跑**（`src/engine/skills/遗计.ts:29-35`）  
   第二次 `请求回应` 卡牌列表是空（`cardIds: []`），且没有读取回应的 `params.遗计分配`，更没有 `给予` atom。  
   后果：遗计实际行为 = 摸 2 张牌后**无事发生**，与设计 §11 场景 D 不符。

4. **武圣 onMount 缺失**（`src/engine/skills/武圣.ts:1-26`）  
   没有 `export function onMount`、没有 `api.defineAction('transform', ...)`。客户端无法显示"武圣"转化按钮。  
   `onAtomAfter('移动牌')` 体为空（`skills/武圣.ts:19-24`），注释自己写 "TODO: 真正的包装/还原逻辑"。

---

## 3. 前后端契约对齐

### ✓ 对齐

- `ClientMessage` 字段：`{ skillId, actionType, ownerId, params, baseSeq }`（`src/engine/types.ts:302-308`）
- WS 协议：`{ type: 'action', action: { ... EngineClientMessage }, baseSeq }`（`src/server/protocol.ts:48`）
- ServerMessage `initialView` / `debugGameState` 用 `GameView`（`src/server/protocol.ts:15-16`）
- 旧 `GameAction` 类型入口（`handleAsyncHookResponse` / `handleResponse`）已删除（`src/server/app.ts:358-360` 显式注释）

### ⚠ 部分对齐 / bug

1. **actionLog.baseSeq 写错**（`src/server/session.ts:201-206`）  
   ```ts
   this.actionLog.push({
     ...
     baseSeq: this.state.seq,  // ← 这是 dispatch 之后的 seq
   });
   ```
   设计 §8.1 要求 `baseSeq` = 客户端发送的 `baseSeq`（用于重放校验）。当前写的是 dispatch 推进后的新 seq，**重放时会用错位 seq 跳过校验**。
   修法：`baseSeq: action.baseSeq` 或 `baseSeq: baseSeq`（参数传入）。

2. **baseSeq 在两层重复传递**（`src/client/hooks/useDebugLobbyController.ts:108-110`）  
   ```ts
   send({ type: 'action', action: { ...action, baseSeq: ... }, baseSeq: ... })
   ```
   内外都传，session 只读外层，**内层 baseSeq 实际未被服务端用**。冗余且混淆。

### ✗ 残留旧类型与旧路径

`grep` 全量扫描发现以下**设计文档 §10 明确要求删除**的旧概念仍存在：

| 旧概念 | 残留位置 | 状态 |
|---|---|---|
| `GameAction` | `src/client/components/debug/DebugPlayerList.tsx:10` | import + 使用 |
| `ValidAction` | `GameBoard.tsx` / `GameBoardData.ts` / `DebugPlayerList.tsx` / `Prompts.tsx` | 多文件 import |
| `PendingAction` | `GameBoard.tsx` / `GameBoardData.ts` / `Prompts.tsx` | 多文件 |
| `PromptOption` | `DebugPlayerList.tsx` / `GameBoardData.ts` / `Prompts.tsx` | |
| `AvailableSkill` | `GameBoardData.ts` / `SkillButtons.tsx` | |
| `PlayerState` (old) | `DebugPlayerList.tsx:10` | 与新 `PlayerState` 同名但是旧版 |
| `SequencedEvent` | `ReplayBoard.tsx` / `useDebugLobbyController.ts:4` 注释 | 仅注释 |
| `FrontendState` / `reduceFrontend` | `useDebugLobbyController.ts:4` 注释 | 仅注释 |
| `@engine/validate` | `DebugPlayerList.tsx:13` / 19 个 test files | **import 路径不存在** |
| `@engine/characters` | `GameBoard.tsx:4` / 5 个 test files | **import 路径不存在** |
| `@engine/skill-hook` | 8 个 test files | **import 路径不存在** |
| `@engine/distance` | `DebugPlayerList.tsx:14` / test | **import 路径不存在** |
| `@engine/state` | `tests/scenario-runner.ts:4` / 多个 test | **不存在** |
| `@engine/atom` (old) | 多个 test | 旧 `applyAtoms` API |
| `@engine/engine` | `tests/scenario-runner.ts:5` | 旧 `engine()` API |
| `@engine/view/reducer` | `tests/scenario-runner.ts:11` | 旧 reducer |
| `toCardInfoMap` | `GameBoard.tsx:6` | **新 buildView 不导出** |

`tsc --noEmit` 在 `moduleResolution: "bundler"` 模式下**对 unresolved import 不报错**（已实测），所以 0 类型错误不能说明 import 合法。**真正编译/跑测试时这些 import 全部失败**。

---

## 4. 前端解耦验证

### ✓ 已解耦的"新流"

- `GameViewComponent`（`src/client/components/GameView.tsx:1-470`）仅做：渲染 `view`、手写 if/else 判断 `pending.target` / `currentPlayerIndex` / `view.phase`、把用户操作封装为 `ClientMessage`。  
  唯一触达"规则"的代码是 `card.name === '闪' || card.name === '杀'` 过滤响应牌（`GameView.tsx:159, 233, 376`）——这是过滤手牌 UI 元素，**不是计算游戏结果**，可接受。
- `MultiplayerGameBoard.tsx` / `useDebugLobbyController.ts` / `useWebSocket.ts` 都只搬运 GameView、转发 ClientMessage。无规则计算。
- `buildView.ts` 是纯数据投影（`viewer` 隔离手牌、提取 pending、格式化 log），不计算规则。

### ✗ 违反解耦的"旧流"（仍编译可执行）

- `src/client/components/debug/DebugPlayerList.tsx:13-14`：
  ```ts
  import { computeValidActions } from '../../../engine/validate';
  import { getDistance } from '../../../engine/distance';
  ```
  **前端调引擎算"我可以出什么牌"和"我到目标距离多少"**——这是规则计算！违反 §1 "前端只做状态展示和 action 输入"。

- `src/client/components/GameBoard.tsx:4,6`：从 `engine/characters` 拿全武将数据；从 `buildView.toCardInfoMap`（不存在）拿卡牌信息。

- `src/client/components/game/Prompts.tsx`：基于 `state.pending` (old) 渲染 8 种旧 prompt，**前端拿到 GameState 全量数据**而非 GameView。

### ⚠ 新流也不算"声明式"

- 设计 §4.7："前端引擎监听 atom 事件流，根据事件自动管理按钮的显示/隐藏时机"。  
  现状：`GameViewComponent` 全是 `if (isMyAwaiting) ... else if (isMyTurn) ...` 手写分支（`GameView.tsx:222-265`），**没有事件订阅**。
- 6 种 ActionPrompt 渲染**只有 1 种**（useCard 用于询问闪/询问杀）。`distribute`/`choosePlayer`/`useCardAndTarget`/`selectTarget`/`confirm` 都没有专用 UI 组件。

### DebugLobby 现状

- `DebugLobby.tsx` 是新流的入口（`src/client/components/DebugLobby.tsx:1-52`），只是路由：拿到 view 就 `GameViewComponent`。
- `DebugRoomList` 用来创建/选择房间，**没有**"配置初始牌堆/手牌/技能"的 UI。CHANGELOG 写的 "PR 6 DebugLobby 复刻" 完成度 10%。

---

## 5. 测试与基础设施

### 新引擎独立测试（12/12 通过）

```
tests/engine-smoke.test.ts                          4/4 ✓
tests/integration/new-engine-kill.test.ts           3/3 ✓
tests/integration/new-engine-hujia.test.ts           1/1 ✓
tests/integration/new-engine-rende.test.ts           2/2 ✓
tests/integration/server-gameplay.test.ts           3/3 ✓
                                                    ─────
                                                    12/12
```

### 全量测试：194 文件，154 fail / 28 pass / 12 skip

**所有 154 fail 根因 = 旧 v2 路径 import 失败**：
- `@engine/validate` (无对应文件)
- `@engine/characters` (无对应文件)
- `@engine/skill-hook` (无对应文件)
- `@engine/distance` (无对应文件)
- `@engine/state` (无对应文件)
- `@engine/atom` (旧 API，无 `applyAtoms`/`clearAtomRegistry` 等)
- `@engine/engine` (旧 `engine()` 工厂)
- `@engine/view/reducer` (旧 `eventsToAnimations`)
- `@engine/atoms` (旧注册 API)

**绕过路径**：`vitest.config.ts` 没配 alias 转回 `_legacy/`，CHANGELOG 也没说要切。

### 设计 §11 场景覆盖

| 场景 | 描述 | 是否有端到端 dispatch 测试 |
|---|---|---|
| A | 杀→流离改目标→出闪 | **无**（流离 `it.skip` "引擎暂不支持"） |
| B | 杀→八卦阵判定→视为闪 | **无**（八卦阵是 v2 测试，@engine/skill-hook 失败） |
| C | 南蛮入侵→逐个响应 | **无**（南蛮无文件） |
| D | 伤害→遗计→反馈 | **部分**（遗计 1 个场景测试但用 v2 路径；反馈无文件） |
| E | 玩家级超时配置 | N/A（未设计） |

### `_legacy/` 残留

- `src/engine/_legacy/` 完整保留旧 v2 引擎（50+ 文件），约 148 个 TS 编译错误（语法错——`_legacy/skills/乱击.ts:17` 等出现 `error TS1005 ',' expected`，**说明这些文件源码层面就有问题**，是迁移过程中没收尾的脏代码）。
- CHANGELOG "src/engine/_legacy 清理时机" 仍是待写 ADR。

---

## 6. 最关键的 5 个差距（按业务影响排序）

1. **`请求回应` atom 没有 awaits**（`src/engine/atoms/请求回应.ts:6-21`）  
   后果：遗计/激将/护甲/八卦阵"是否发动"流程**全都不会等玩家回应**，execute 直接跑完。当前测试通过纯属巧合。  
   修：给 `请求回应` 加 `awaits: { target, prompt }`，把 settlement.ts:87-100 的等待逻辑完整接入。

2. **前端 v2 路径与新流并行残留**（`DebugPlayerList` / `GameBoard` / `Prompts` / `GameBoardData` / `activePlayer.ts`）  
   后果：路由表里 `GameBoard` 没人 import，但 `App.tsx` 路由懒加载一旦误用 / 别人复用就触发 "Cannot find module" 错误。19 个测试 fail 完全因为这个。  
   修：删除所有 v2 残留文件 + 修复 19 个 test 的 import 路径（或在 `vitest.config.ts` 加 alias 把 `@engine/*` 指到 `_legacy/` 作为临时桥）。

3. **服务端超时 / 旁观 / 差量事件流全部缺失**（`buildView.ts:45,54` 写 deadline 但无人调度）  
   后果：掉线/不响应玩家将无限挂起；重连必须接收全量 GameView（无 seq 差量），1000 步后单包过大；旁观者无法加入。  
   修：服务端加 `setTimeout(pendingRequest.deadline)`，到期自动 inject 默认 choice；server 维护 per-player event queue 用 `fromSeq` 拉差量；ServerMessage 加 `spectate` 类型。

4. **actionLog.baseSeq 写错**（`src/server/session.ts:205`）  
   后果：重放时 CAS 校验会错位，旧 action 被错误丢弃/重放。  
   修：`baseSeq: action.baseSeq`。

5. **杀的多目标 settlement 在 dispatch 顶层代执行**（`create-engine.ts:107-141`）  
   后果：所有需要多目标/嵌套 settlement 的技能（南蛮、万箭、决斗、连环）都要在这里继续堆 if/else。  
   修：让 `frame.apply` 用 `await` 跨 PendingInterrupt 续跑（不要在 awaiting 时直接 throw 出 execute），或重构成显式 "settlement fragment"。

---

## 7. 建议的清理顺序

按依赖关系，最小破坏面：

1. **立即修复 actionLog.baseSeq**（1 行，单点）
2. **给 `请求回应` 加 awaits + 修遗计分配 + 修激将**（解锁 3 个骨架技能）
3. **删除/重写旧客户端文件**（`GameBoard` / `DebugPlayerList` / `Prompts` / `GameBoardData` / `activePlayer.ts`），消除 v2 import
4. **修测试 import 路径**（19 个 test files 改路径或 vitest alias）
5. **写八卦阵 / 流离 / 南蛮 / 反馈 / 借刀 / 无懈**（设计 §11 场景 A-D 完整覆盖）
6. **服务端超时 + 差量事件流 + 旁观**
7. **tree-shaking**（分离前/后端 entry；`engine/skills/index.ts` 不能两边共用）
8. **清理 `_legacy/`**（写 ADR，决定删除时机）

---

## 8. 附录：核对清单

### Atoms（38 个，CHANGELOG 声明）

实际 `src/engine/atoms/index.ts` 列 38 个，对应 `src/engine/atoms/*.ts`。与设计 §5 比对：

- ✓ 卡牌/资源（12）：摸牌 / 弃置 / 移动牌 / 获得 / 给予 / 抽牌 / 装备 / 卸下 / 洗牌 / 重洗 / 整理牌堆
- ✓ 角色状态（5）：造成伤害 / 回复体力 / 失去体力 / 击杀 / 设上限
- ✓ 标记/状态（6）：加/去标记 / 清过期标记 / 设横置 / 加/去标签
- ✓ 技能管理（2）：添加技能 / 移除技能
- ✓ 流程（6）：回合开始/结束 / 阶段开始/结束 / 设阶段 / 下一玩家
- ✓ 目标（1）：指定目标
- ✓ 判定（3）：判定 / 添加延时锦囊 / 移除延时锦囊
- ✓ 拼点（1）：拼点
- ✓ 等待回应（3）：询问闪 / 询问杀 / 请求回应

✓ 全部 atom 类型与 spec §5 一致。CHANGELOG 列出 5 处增量字段（弃置复数、造成伤害 cardId、回复体力 source 可选、添加延时锦囊 trick 对象、询问闪/杀加 source），都是对 spec 的补充，不冲突。

### 已删除的旧概念（§10）落实

| 设计要求删除 | 实际状态 |
|---|---|
| `GameAction` | ✗ `DebugPlayerList.tsx` 仍 import |
| `ServerEvent` / `PlayerEvent` | ✓ 删除，统一为 `GameEvent` |
| `card-handlers.ts` | ✓ 杀/桃/酒/仁德/制衡全部进 `skills/`，无 handler 文件 |
| `SkillPhase` / `OrchestrationFrame` | ✓ 删除 |
| `requestStack` / `actionStack` | ✓ 合并为 `SettlementFrame` |
| `AtomResult` / `AtomHookContext` / `ActionContext` | ✓ 拆为 `AtomBeforeContext` / `AtomAfterContext` / `SettlementFrame` |
| `setResult` / `cancel` | ✓ 统一为 `drop()` + `modifyParams()`（settlement.ts:52-58） |
| `atom.result` 字段 | ✓ 删除（types.ts:179-225 全 atom 无 result） |
| `MAX_HOOK_RECURSION` / `skipHooks` | ✓ 删除 |
| `AtomLogEntry` / `serverLog` | ✓ 改为 `ActionLogEntry` + `actionLog`（types.ts:317-322） |
| `累计出杀` / `设置变量` atom | ✓ 删除（杀/技能用 marks 或 settlement params） |
| `成为目标` | ✓ 合并到 `指定目标` |
| `解决` / `出牌` | ✓ 删除 |
| `杀命中` / `杀被闪避` | ✓ 删除（settlement.dodged） |

✓ 大部分已删除。**残留 1 项**：`GameAction`（仅在 DebugPlayerList）。
