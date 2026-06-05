# ADR 0011 — Atom / GameEvent / ServerEvent 三者统一管道

**状态**: **已被 ADR 0012 / 0013 取代**——决策 1（turnStart 原子化）由 ADR 0011 落地，决策 4/5（统一 applyAtoms 入口、phases/atoms 不写 serverLog 修复、setPhase 拆分）由 ADR 0012 + 0013 解决。**保留本 ADR 作为历史记录。**

**前置依赖**: ADR 0009 (baseSeq CAS) / ADR 0010 (GameLogger)

## 背景

引擎层有**三个**事件概念，长期混淆：

- **Atom**（`engine/types.ts:195-222`）：唯一修改 `GameState` 的原语。handler 层 `applyAtoms` 调 `broadcast` 写 `state.serverLog` / 派 `playerEvents`。
- **GameEvent**（`engine/types.ts:411-428`）：技能钩子信号，扫 `state.triggers` 匹配后调 skill handler。**不**进 serverLog，**不**改 state。
- **ServerEvent**（`engine/types.ts:429-434`）：流水/广播/重放事件。**不**触发技能，**不**改 state。

不变量："**每个** atom 应用后派 1 个 server event 进 serverLog + 派对应 GameEvent 给技能"。

### 现状偏离

**问题 1：turnStart 绕开 atom**

`engine/phase-advance.ts:197-208` 处理回合开始时手工 `makeServerEvent('turnStart', ...)` 派 server event（不写 `state.serverLog`）+ 手工 `emitEvent({ type: 'turnStart' })` 派 GameEvent。两条派发路径都不走 atom 体系。ReplayEngine 重建状态时**看不到** `turnStart`。

**问题 2：phaseBegin / phaseEnd 同样绕开 atom**

`engine/phase-advance.ts:106, 140` 手工 `emitEvent({ type: 'phaseBegin' })` / `{ type: 'phaseEnd' }` 派 GameEvent。**没有** server event 派发（不写 serverLog），"进入X阶段"由 `setPhase` atom 派生表达。

但 `setPhase` atom 应用后**没有**自动派 `phaseBegin` GameEvent——38+ 技能监听 `phaseBegin` 完全依赖手工 `emitEvent`。`setPhase` atom 应用 → 写 serverLog → **跳过** `ATOM_GAME_EVENTS` 钩子。

**问题 3：phases/atoms.ts 不写 serverLog**

`engine/phases/atoms.ts:37-39` 手工 `atomToEvents` + `applyAtom` 应用技能触发的 atom，**不**调 `broadcast`——`state.serverLog` 不增长。

`engine-utils.applyAtoms` = `broadcast` 封装（写 serverLog）——`phases/atoms` 走的是**另一条**路径。

**后果**：
- `state.serverLog` 只含 handler 层派发的 server events
- 技能触发的 server events（"出牌阶段摸 1 张牌" 的 `draw` event）**不**进 serverLog
- ReplayEngine 重建 state 缺技能副作用
- GameLogger 流水不完整（虽然目前 logger 还没处理 `cardDrawn` 这类死代码 GameEvent）

**根因**：`ATOM_GAME_EVENTS` 钩子**只在 `phases/atoms` 路径**（技能内部）调用，**不在 `engine/atom.ts:broadcast`**（handler 层）调用——`broadcast` 是所有 atom 必经之路，应该挂这个钩子。

## 决策

**本期已落地**：

1. **`turnStart` 封装为 atom**。新 atom 注册在 `engine/atoms/turn.ts`，`toEvents` 派 `makeServerEvent('turnStart', { player })`，`apply` no-op。`Atom` 联合类型扩展 `{ type: 'turnStart'; player: Expr<string> }`。

2. **`phase-advance.ts:207-208` 手工 `makeServerEvent('turnStart')` 替换为 `applyAtoms(s, [{ type: 'turnStart', player }])`**。自动写 `state.serverLog`。

3. **保留 `emitEvent(turnStart)` GameEvent 派发**（`phase-advance.ts:198-199`）。新 atom apply 不调 `emitEvent`——由 `phase-advance.ts` 在 atom 落地后**显式**派 GameEvent。不需扩展 `AtomDefinition.apply` 签名为 `(state, atom) => { state, events }`，对既有 atom 零侵入。

**Future work（统一管道方案）**：

4. **`engine/atom.ts:broadcast` 增加 `ATOM_GAME_EVENTS` 钩子**。每个 atom 应用后查 `ATOM_GAME_EVENTS[atom.type]`，如有则调 `emitEvent(state, gameEvent)`，emitEvent 返回的 state 用于下一轮。**这让 `setPhase` atom → `phaseBegin` GameEvent、`nextPlayer` atom → `turnStart` GameEvent 等自动派生**。

5. **扩展 `ATOM_GAME_EVENTS` 映射**：补 `setPhase` → `phaseBegin`、`nextPlayer` → `turnStart`、`draw` → `cardDrawn`、`discard` → `cardDiscarded`、`equip` / `unequip` → `equipChanged`、`judge` → `judgeResult` 等。统一为"每个 atom 应用后自动派对应 GameEvent"。

6. **`phases/atoms.ts` 改用 `engine-utils.applyAtoms`**（handler 层统一入口）。这让**所有** atom 应用（含技能触发的）都写 `state.serverLog`。**问题 3 解决**。

7. **`phases/atoms.ts` 接收 `playerEvents` 但丢弃**（per-player 视角事件不派给全员——技能触发的 playerEvents 通常只对 target 玩家有意义）。或者 `applyAtoms` 加 `opts.skipPlayerEvents: true` 参数。

8. **删除手工 `emitEvent` 调用点**：`engine-utils.applyDamage:39-45`、`card-handlers.ts:44` 等。现在 `broadcast` 通过 `ATOM_GAME_EVENTS` 自动派 GameEvent，手工调用成为重复派发。

**未来 work 不在本次范围**，因为：
- 需要全技能扫描确认 `applyAtoms` 替代 `phases/atoms` 手工路径不破坏 per-player 视角隔离语义
- 补 `ATOM_GAME_EVENTS` 映射需对每个 GameEvent 语义重新审计（避免双重派发）
- 涉及面广（engine 核心），需要独立 PR/分支评审

## 后果

**正面**:
- `turnStart` server event 进 `state.serverLog`，ReplayEngine 用 `reduceGameState`（`engine/view/reducer.ts:559-562`）能正确 replay。
- 消除 `phase-advance.ts` 绕过 atom 的特殊路径，引擎不变量更严格。
- GameLogger 流水中 `turnStart` 仍走 `eventToServerOp` 的 `case 'turnStart': return null`（与 `nextPlayer` 流水不重复），serverLog 完整但流水清晰。

**负面**:
- `phaseBegin` / `phaseEnd` 仍手工 `emitEvent`（不进 serverLog），但本期范围限定 `turnStart`。
- `phases/atoms.ts` 仍不写 serverLog（决策 5-8 是 future work）。
- `applyDamage` 等手工 `emitEvent` 与未来统一管道可能形成"过渡期"重复派发风险——需要测试覆盖。

**未来 work 预期收益**:
- 引擎层不变量完全统一（每个 atom 必经 1 个 serverLog 写入 + 1 个 GameEvent 派生）
- 技能触发副作用完整进 serverLog，ReplayEngine 重建 state 准确
- GameLogger 流水完整（目前 GameEvent `cardDrawn` 等 5 个死代码类型有了派发源）
- 消除手工 `emitEvent` 调用点（38+ 个）——代码量减少

## 验证

- `pnpm test`: 1300 测试 / 1260-1261 通过 / 39 跳过（1 memo 偶发失败为预先存在）。
- `pnpm tsc --noEmit`: 0 错误。

## 改动文件

**本期**:
- `engine/atoms/turn.ts`: 新增 `turnStart` atom
- `engine/types.ts`: `Atom` 联合扩展 `turnStart` 变体
- `engine/phase-advance.ts`: 行 207-208 手工 `makeServerEvent` 替换为 `applyAtoms([{ type: 'turnStart', player }])`
- `docs/decisions/0010-game-logger-playerops.md`: 决策 1 "理由" 段更新（指向本 ADR）

**Future work**（不在本 PR）:
- `engine/atom.ts:broadcast`: 增加 `ATOM_GAME_EVENTS` 钩子
- `engine/atom-game-events.ts`: 扩展映射（`setPhase` → `phaseBegin` 等）
- `engine/phases/atoms.ts`: 改用 `applyAtoms`（含 playerEvents 跳过选项）
- `engine-utils.applyDamage` 等: 删除手工 `emitEvent` 调用
- `engine/phase-advance.ts:106, 140, 198`: 删除手工 `emitEvent`（如果未来钩子补全）
- `engine/types.ts`: 移除死代码 GameEvent 类型（`cardDrawn` / `cardDiscarded` / `equipChanged` / `judgeResult` / `skillActivated` 等如果仍无人监听）

## 关键概念再澄清

> **Atom** = 改 state 的原语（每次应用产生 1 个 server event）
> **GameEvent** = 触发技能钩子的信号（不改 state，不进 serverLog）
> **ServerEvent** = 流水/广播/重放事件（不改 state，不触发技能）

**不变量**：每个 atom 应用后 → 1 个 server event 进 serverLog + 自动派对应 GameEvent（如有）。

**当前违反**：
- `turnStart`（已修）
- `phaseBegin` / `phaseEnd`（手工 emitEvent，缺 server event）
- `phases/atoms.ts` 路径（不写 serverLog）

**期望状态**（future work 落地后）：
- 所有 atom 应用 → 1 个 serverLog 写入 + 1 个 GameEvent 派生
- 手工 `emitEvent` 调用点全删
- 38+ 技能监听通过统一管道接收 GameEvent
- ReplayEngine 重建 state 准确
