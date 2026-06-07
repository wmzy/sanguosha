# ADR 0013 — setPhase 拆分为 phaseBegin / phaseEnd atom

**状态**: 已接受

**前置依赖**: ADR 0012 (统一 applyAtoms)

## 背景

`src/src/engine/atoms/phase.ts` 的 `setPhase` atom 应用 = `state.phase = atom.phase`，**单字段切换**。但**没有**显式的"阶段开始 / 阶段结束"通知。

### 现状

`src/src/engine/phase-advance.ts:processPhaseStep` 内部：

1. 派 `phaseBegin` GameEvent（手工 `emitEvent`）
2. 执行阶段内 actions
3. 派 `phaseEnd` GameEvent（手工 `emitEvent`）
4. 调 `applyAtoms([{ type: 'setPhase', phase: nextPhase }])`

### 问题：阶段切换乱序

某些技能（克己、放权、神速、巧变）会**强制**结束当前阶段跳到下一阶段。例如：

**克己**（吴国吕蒙）："若你未于出牌阶段内使用过【杀】，则你跳过弃牌阶段。"

技能监听 `phaseBegin('弃牌')` 触发 → 内部调 `{ type: 'setPhase', phase: '结束' }` 强制跳过弃牌。

但**当前实现**：
- `phase-advance.ts:148-150` 已经在循环里派 `setPhase('弃牌')`（state.phase 切到弃牌）
- 紧接着 `processPhaseStep` 再次被调用——因为 `state.phase === '弃牌'`
- 技能（克己）触发 `setPhase('结束')` 调——state.phase = '结束'
- 循环继续——又一次 `processPhaseStep`，进入"结束"阶段
- **但** `phaseBegin('弃牌')` GameEvent **已经在循环开始时派发过了**——技能触发的 `phaseBegin('弃牌')` 也已经在前一次循环派发
- **现在 `phaseBegin('结束')` 又要派**——但**没有 `phaseEnd('弃牌')` 派发**

**结果**：
- 流水看到 `phaseBegin(弃牌) → setPhase(结束)`（中间没 phaseEnd(弃牌)）
- 技能监听 `phaseEnd('弃牌')` 的（如貂蝉闭月）**没**触发
- **serverLog 与 result.events 不一致**——`state.serverLog` 含 `setPhase('弃牌')` server event，但 `phaseEnd('弃牌')` **没** server event

### state.turn.phaseFlags 字段问题

`src/src/engine/types.ts:84` 字段 `phaseFlags: string[]` 注释说"skipDraw, skipPlay, etc."——但实际**这些是 `state.players[].tags[]`，不是 `phaseFlags`**。

`phaseFlags` 字段实际**只有** `'turnStarted'` 字符串在用（`src/src/engine/phase-advance.ts:197`）——**形式是 `string[]`，类型不安全**。

## 决策

### 决策 1：setPhase 拆分为显式 phaseBegin/phaseEnd atom

`src/src/engine/atoms/phase.ts` 新增 2 个 atom：

- `phaseBegin(phase, player)` atom: 写 serverLog `phaseBegin` server event
- `phaseEnd(phase, player)` atom: 写 serverLog `phaseEnd` server event

`setPhase` atom 仍保留：单纯改 `state.phase` 字段。

### 决策 2：processPhaseStep 改为显式 4 步序列

```ts
1. applyAtoms([{ type: 'phaseBegin', phase, player }])   // 写 serverLog
   emitEvent({ type: 'phaseBegin', ... })                 // 派 GameEvent 给技能
2. 阶段内 actions
3. applyAtoms([{ type: 'phaseEnd', phase, player }])     // 写 serverLog
   emitEvent({ type: 'phaseEnd', ... })                   // 派 GameEvent 给技能
4. applyAtoms([{ type: 'setPhase', phase: nextPhase }])  // 切 state.phase
```

**显式成对**的 `phaseBegin` + `phaseEnd` 避免乱序——每对 begin/end 由调用方负责。

**当前**显式 `emitEvent` 派 GameEvent——因为 `ATOM_GAME_EVENTS` 钩子**只**在 `phases/atoms` 路径调，不在 `applyAtoms` 路径调。Phase 12（统一 applyAtoms）**未**自动统一这个钩子——**未来**可以扩展 `applyAtoms` 在 atom 应用后自动调 `ATOM_GAME_EVENTS` 派 GameEvent，那时 `processPhaseStep` 可简化为单步。

### 决策 3：state.turn.phaseFlags: string[] 改为 turnStarted: boolean

`src/src/engine/types.ts:84` `TurnState`：

```ts
// 之前：
phaseFlags: string[]; // 'turnStarted' 等防重位

// 之后：
turnStarted: boolean; // turnStart atom 是否已派发（防重用）
```

**类型安全**——不再用 `string[]` 装 `turnStarted` 字符串。`nextPlayer` atom 重置 `turnStarted: false`——`advanceToInteractivePhase` 检查 `state.turn.turnStarted` 防重。

### 决策 4：保留 38+ 现有技能的 trigger.event 注册

`src/src/engine/skill.ts:emitEvent` 仍按 `trigger.event` 匹配——`phaseBegin` / `phaseEnd` GameEvent 派发后扫 `state.triggers` 找匹配技能，触发 skill handler。**不**迁移到 `onAfterAtom` 钩子。

## 后果

**正面**:
- 显式成对的 `phaseBegin` + `phaseEnd` 解决"乱序"问题——克己/放权/神速/巧变等强制跳阶段技能触发时 `phaseEnd` 仍派
- `state.serverLog` 现在**包含** `phaseBegin` / `phaseEnd` server event——ReplayEngine 能正确 replay
- GameLogger 流水能区分"进入X阶段"和"X阶段结束"（未来 logger 扩展）
- `turnStarted: boolean` 类型安全
- 测试覆盖：38+ 现有技能不破（`pnpm test` baseline 1260 通过）

**负面**:
- `processPhaseStep` 比之前**多 4 行**（atom + emitEvent 两步）——但**正确性收益**值得
- `turnStarted: boolean` 字段增加 state.turn 大小（微不足道）

## 验证

- `pnpm test`: 1315 测试 / 1276 通过 / 39 跳过 / 0 失败
- `pnpm tsc --noEmit`: 0 错误
- 端到端：观星（4 测试）+ 英姿（1 测试）— 之前 fail 修复后通过

## 改动文件

**修改**:
- `src/src/engine/atoms/phase.ts`: 新增 `phaseBegin` / `phaseEnd` atom（apply no-op，toEvents 派 server event + player event）
- `src/src/engine/types.ts`: `Atom` 联合扩展 `phaseBegin` / `phaseEnd` 变体；`TurnState.phaseFlags: string[]` → `turnStarted: boolean`
- `src/src/engine/phase-advance.ts`: `processPhaseStep` 重构为 4 步显式序列；`advanceToInteractivePhase` turnStart 防重改用 `state.turn.turnStarted`
- `src/src/engine/atoms/phase.ts` `nextPlayer` atom: 重置 `turnStarted: false`
- `src/src/engine/state.ts`: 初始 `turnStarted: false`
- `src/src/engine/view/reducer.ts`: turnStart 重建 turn 时 `turnStarted: false`
- `src/src/engine/skill.ts`: 删 `phaseFlags` 防重死代码

## ADR 关系

- **取代**：ADR 0011 第 4 节"phaseBegin / phaseEnd 仍是 GameEvent 派发"——已被本 ADR 决策 1 解决
- **依赖**：ADR 0012 (统一 applyAtoms)
- **未来 work**: `applyAtoms` 内部集成 `ATOM_GAME_EVENTS` 钩子（让 `processPhaseStep` 不再需要显式 `emitEvent`）
