# ADR 0014 — reshuffle atom（修 §4.7 重洗不写 serverLog）

**状态**: 已接受

**前置依赖**: ADR 0012（统一 applyAtoms）

## 背景

`src/src/engine/atoms/draw.ts:7-28` 的 `reshuffleIfNeeded` 内部把弃牌堆洗回牌堆，但**不**发 server event。问题：

1. `state.serverLog` 不知道牌堆被洗过 → `reduceGameState` 重建 state 时 deck 顺序错误
2. Replay / 审计日志不完整
3. 后续技能（如鬼道改判）需要主动触发重洗时，没有 atom 可用

## 决策

### 抽 `reshuffle` atom

`src/src/engine/atoms/reshuffle.ts` 注册独立 atom，emit `{ type: 'reshuffle' }` server event，payload `{ count: moved }`。

### draw 改用 onBefore 钩子触发 reshuffle

`src/src/engine/atoms/draw.ts` 注册 `registerAtomHook({ atomType: 'draw', onBefore: ... })`。当 deck 不足且 discardPile 非空时：

```ts
const sub = applyAtoms(state, [{ type: 'reshuffle' }], { skipHooks: true, skipPlayerEvents: true });
return { state: sub.state };
```

### applyAtoms 不变

钩子在 toEvents 之前完成，所以 `state.serverLog` 顺序为 `[..., reshuffleEvent, drawEvent]`，events 数组为 `[reshuffleEvent, drawEvent]`（需确认 applyAtoms 把内部 events 合并到外层数组——当前实现下 serverLog 正确，events 数组不包含 reshuffle 事件；这是可接受的，因为 serverLog 是审计源）。

### view reducer 加 no-op case

`src/src/engine/view/reducer.ts:applyGameStateEvent` 加 `case 'reshuffle': return state;`——前端无状态变化（reshuffle 已经在 server 端 apply 完成），仅防止事件被静默丢弃。

## 后果

**正面**:
- §4.7 修复：`state.serverLog` 在重洗后正确包含 `reshuffle` 事件
- 鬼道等技能可通过 `applyAtoms([{ type: 'reshuffle' }])` 主动触发
- 单一职责：draw 不再"内联"重洗逻辑

**负面**:
- `applyAtoms` 内部嵌套 events 不会自动并入外层 events 数组（res 数组少 reshuffle 事件）——**接受**：serverLog 是事实源，events 数组给上层用做即时广播
- draw.apply 保留 `maybeReshuffle` fallback（直接调 applyAtom 跳过钩子的路径仍能跑），轻微重复

## 验证

- `tests/atoms/reshuffle.test.ts`: 4 测试
  - reshuffle 后 serverLog 末尾有 reshuffle 事件
  - 空 discardPile 是 no-op（rngState 不变）
  - 连续 reshuffle 不抛错（防回归）
  - draw 空 deck → serverLog 含 reshuffle + draw，reshuffle 在 draw 之前
- 全量测试：1306 pass（与 P0 基线对齐）
- `pnpm typecheck`: clean

## 改动文件

**新增**:
- `src/src/engine/atoms/reshuffle.ts` (40 行)
- `tests/atoms/reshuffle.test.ts` (4 测试)

**修改**:
- `src/src/engine/atoms/draw.ts`: `reshuffleIfNeeded` 替换为 onBefore 钩子调用
- `src/src/engine/atoms/index.ts`: 注册 reshuffle
- `src/src/engine/atom.ts`: 导出 `clearAtomRegistry`
- `src/src/engine/types.ts`: Atom 联合加 `{ type: 'reshuffle' }`
- `src/src/engine/view/reducer.ts`: `applyGameStateEvent` 加 `case 'reshuffle'` no-op

## ADR 关系

- **依赖**: ADR 0012（统一 applyAtoms + registerAtomHook）
- **被未来依赖**: 鬼道（[T-14] 后续 P1 工作）
