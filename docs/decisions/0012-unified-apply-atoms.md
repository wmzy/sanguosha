# ADR 0012 — 统一 applyAtoms 入口 + onAfterAtom 钩子

**状态**: 已接受

**前置依赖**: ADR 0009 (baseSeq CAS) / ADR 0010 (GameLogger) / ADR 0011 (turnStart 原子化)

## 背景

引擎层 atom 应用长期存在两条独立路径：

- **handler 层**：handler 调 `engine-utils.applyAtoms` → `broadcast` → 写 `state.serverLog` / 派 `playerEvents`
- **技能层（`phases/atoms`）**：技能内部手工 `atomToEvents` + `applyAtom`——**不**写 `state.serverLog`

### 深层漏洞

`phases/atoms.ts:37-39` 走手工路径，**state.serverLog 不增长**。这意味着：

1. 技能触发的 server events（如"出牌阶段摸 1 张牌"技能的 `draw` event）**不**进 `state.serverLog`
2. `state.serverLog` 与 `result.events` 在含技能触发的 action 后**永久不一致**
3. **ReplayEngine 重建 state 不准确**——即使 ADR 0011 让 `turnStart` 进 serverLog，技能触发的 `draw` / `damage` / `heal` 仍缺
4. **GameLogger 流水不完整**

### 第二层问题

引擎事件的"钩子"机制有多种并存：

- `ATOM_GAME_EVENTS` 映射：只在 `phases/atoms` 路径调，**handler 层 `applyAtoms` 路径不调**
- 手工 `emitEvent(phaseBegin/phaseEnd/turnStart)`：在 `phase-advance.ts` / `turn-handlers.ts` 散落调
- 38+ 技能 `trigger.event: 'phaseBegin' | 'damageReceived' | 'cardPlayed' | ...` 注册在 `state.triggers`

`ATOM_GAME_EVENTS` 钩子**只**在技能层调——这意味着 `phaseBegin` atom 走 handler 层 `applyAtoms` 时**不**触发 `phaseBegin` GameEvent，38+ `phaseBegin` 技能监听**失效**（Phase 10 修复时遇到此问题）。

## 决策

### 决策 1：统一 `applyAtoms` 入口（单路径）

`src/src/engine/atom.ts` 顶层 `applyAtoms(state, atoms, opts?)` 是**所有** atom 序列应用的唯一入口：

- 内部走 `broadcast` 写 `state.serverLog` / 派 `playerEvents`
- `opts.skipPlayerEvents: true` 让技能层（`phases/atoms`）复用同一路径，serverLog 仍正常写入
- 旧 `engine-utils.applyAtoms` 函数**删除**——不留 deprecated alias
- 14 个调用点（3 引擎层 + 9 handler + 3 测试）**全部迁移**

### 决策 2：onBefore / onAfter 钩子 API

`src/src/engine/skill-hook.ts` 新增 `registerAtomHook(def)` API：

```ts
interface AtomHookDef {
  atomType: string;                                  // 监听哪个 atom
  player?: string;                                    // 玩家过滤（self === player）
  priority?: number;                                  // 高优先级先触发
  filter?: (state, atom, self) => boolean;
  onBefore?: ({ state, atom, self }) => 
    | { cancel?: boolean; atom?: Atom; state?: GameState }
    | void;
  onAfter?: ({ state, atom, self, serverEvent }) =>
    | { additionalAtoms?: Atom[]; state?: GameState }
    | void;
}
```

`applyAtoms` 内部集成钩子：

- **onBefore**：每个 atom 应用前查钩子；返回 `{ cancel: true }` 跳过该 atom（不写 serverLog）、返回 `{ atom: NewAtom }` 替换
- **onAfter**：每个 atom 应用后查钩子；返回 `{ additionalAtoms }` 递归 `applyAtoms`（不再次触发 onAfter，防无限递归）
- `opts.skipHooks: true` 让递归应用不触发钩子

`MAX_HOOK_RECURSION = 16` 防止堆栈溢出。

### 决策 3：保留 `ATOM_GAME_EVENTS` 钩子

`damage` / `heal` 的 `ATOM_GAME_EVENTS` 映射**保留**——它是"把 atom 派生 GameEvent"的工具，**与** `onAfterAtom` 钩子是不同抽象层（前者是"事件类型映射"，后者是"通用技能钩子"）。两者并存不冲突。

**`phases/atoms` 路径**仍调 `ATOM_GAME_EVENTS`——保留现有 `damage` / `heal` 技能监听。

### 决策 4：不立即迁移 38+ 技能到 onAfterAtom

38+ 现有技能继续用 `trigger.event` 注册系统（`src/src/engine/skill.ts:emitEvent`）。新功能用 `registerAtomHook` API。**不**一次性迁移——避免大规模重写。

未来某个技能"用 onAfterAtom 比 trigger.event 更合适"时，再单独迁移。

## 后果

**正面**:
- `state.serverLog` 现在**全员一致**——所有 atom 应用都写 serverLog
- ReplayEngine 用 `reduceGameState` 重建 state 准确
- GameLogger 流水完整
- 引擎核心"统一 applyAtoms 入口"不变量被维护
- 新技能用 `registerAtomHook` API 更优雅（如"造成伤害时摸牌"、"免疫伤害"、"出牌阶段额外摸牌"）
- 测试覆盖：15 个 skill-hook 单元测试 + 已有 1260 测试无破坏

**负面**:
- `applyAtoms` 内部循环复杂度提升（hooks 查找 + 递归）——`getAtomHooks(atomType)` 每次调
- 38+ 现有技能继续用 `trigger.event`——两套钩子 API 并存，需要 ADR 明确标记
- `phases/atoms` 路径仍手工走 `ATOM_GAME_EVENTS` 钩子——**未**与 `applyAtoms` 的 `onAfter` 钩子完全统一（语义不同：ATOM_GAME_EVENTES 派 GameEvent，onAfter 派 additionalAtoms）

## 验证

- `pnpm test`: 1315 测试 / 1276 通过 / 39 跳过 / 0 失败
- `pnpm tsc --noEmit`: 0 错误
- `tests/unit/skill-hook.test.ts`: 15/15 通过（API + cancel + replace + additionalAtoms + player 过滤 + priority + skipHooks + 递归深度保护）

## 改动文件

**新增**:
- `src/src/engine/skill-hook.ts` (62 行)
- `tests/unit/skill-hook.test.ts` (15 测试)

**修改**:
- `src/src/engine/atom.ts`: 顶层 `applyAtoms`（含 `skipHooks` 选项、`_recursionDepth` 内部参数）；`broadcast` 函数**删除**
- `src/src/engine/handlers/engine-utils.ts`: 删 `applyAtoms` 函数；保留 `mergePlayerEvents` / `applyDamage` / `createDyingPending`
- `src/src/engine/phases/atoms.ts`: 改用 `applyAtoms(s, [atom], { skipPlayerEvents: true })`
- 9 个 handler 文件 + 2 引擎核心文件 + 3 测试文件：import 全部迁移到 `src/src/engine/atom.ts:applyAtoms`
- `src/src/engine/skill.ts:152`: 删 `phaseFlags` 防重死代码

## ADR 关系

- **取代**：ADR 0011 第 5 节"phases/atoms 不写 serverLog 是更广义问题"——已被本 ADR 决策 1 解决
- **依赖**：ADR 0009 (baseSeq) / ADR 0010 (GameLogger) / ADR 0011 (turnStart 原子化)
- **被未来依赖**：ADR 0013 (setPhase 拆分) 依赖本 ADR 的统一 `applyAtoms` 入口
