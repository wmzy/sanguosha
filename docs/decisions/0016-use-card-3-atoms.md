# ADR 0016 — useCard 3 原子（specifyTarget / becomeTarget / resolveCard）

**状态**: 已接受

**前置依赖**: ADR 0012 / ADR 0015

## 背景

`useCard` 当前是单一 `GameEvent`（`cardPlayed`），但卡牌生命周期有 3 个独立阶段：

1. **目标指定**：source 选 target（武器/技能可改数量，如方天画戟多目标）
2. **成为目标**：target 被确定（可被帷幕/空城/谦逊等"不能成为目标"技能拦截）
3. **效果解决**：卡牌效果真正应用（可被借刀/五谷/桃园钩子影响）

单一 `cardPlayed` 事件无法表达这 3 阶段，导致：
- 帷幕/空城用 `trigger.event: 'cardPlayed'` 但实际应在"成为目标"阶段拦截
- 方天画戟多目标、改判等无法在正确阶段钩入
- 借刀杀人的"借武器"和"出杀"是两阶段，但只能监听一个事件

## 决策

### 抽 3 个独立 atom

```ts
// src/src/engine/types.ts Atom 联合新增
| { type: 'specifyTarget'; cardId: Expr<string>; source: Expr<string>; target: Expr<string> }
| { type: 'becomeTarget'; cardId: Expr<string>; source: Expr<string>; target: Expr<string> }
| { type: 'resolveCard'; cardId: Expr<string>; source: Expr<string>; target?: Expr<string> }
```

3 个 atom 的 `apply` 都是 no-op（返回 state 不变）。状态变化由 card handler 在 emit 这些 atom **之前**完成；atom 本身只做"通知钩子"的作用。

理由：v3 中，状态变更在 handler 层显式调 `applyAtoms` 完成；3 阶段 atom 作为"阶段标记"被技能钩子监听。技能可以"在 X 阶段 cancel 之后的所有动作"，但不需要 redo 状态变更。

### 取消 `cardPlayed` GameEvent（渐进）

`GameEvent` union 的 `cardPlayed` 变体加 `@deprecated` JSDoc，引用本 ADR 与 [T-13] / [T-22]。

**不立即删除**：38+ 现有技能仍用 `trigger.event: 'cardPlayed'`。等 [T-22] 渐进迁移完成 + 2 周稳定期后删除（详见 `docs/ENGINE.md` §5 T-22 / §6）。

### 引擎 entry 暂不 emit 3 atom

**当前状态**：`src/src/engine/handlers/card-handlers.ts` 等仍 emit `cardPlayed` GameEvent，**不** emit 3 atom。Task 6 演示技能（完杀/空城/帷幕）的测试用 `applyAtoms` 直接调 `becomeTarget` 跳过引擎 entry。

**P1 跟进**：在 card handler 关键点（出牌、响应、AOE）插入 `applyAtoms` 调用 emit 3 atom，逐步替换 `cardPlayed` GameEvent 发射点。

## 后果

**正面**:
- 3 阶段钩子就位：完杀/空城/帷幕已用 `becomeTarget.onBefore` 实现
- `cardPlayed` GameEvent 标记 deprecated，v3 迁移有清晰目标
- 借刀/五谷/桃园等 v3 技能有落地路径

**负面**:
- 引擎 entry 暂不 emit 3 atom，集成测试需绕道（用 `applyAtoms` 直接调）
- 38+ 现有 `cardPlayed` 技能未迁移，两套系统长期并存（与 ADR 0012 的 trigger.event vs registerAtomHook 并存类似）
- `cardPlayed` 删除是 T-22 + 2 周稳定期后的事，时间表未明确

## 验证

- `tests/atoms/use-card-lifecycle.test.ts`: 4 测试
  - specifyTarget: payload 含 target
  - becomeTarget: onBefore.cancel 阻止事件
  - resolveCard: onAfter.additionalAtoms 追加 damage
  - resolveCard 带 target: payload 含 target
- Task 6 演示技能（完杀/空城/帷幕）依赖 `becomeTarget` 钩子
- 全量测试：1306 pass
- `pnpm typecheck`: clean

## 改动文件

**新增**:
- `src/src/engine/atoms/specifyTarget.ts` (22 行)
- `src/src/engine/atoms/becomeTarget.ts` (22 行)
- `src/src/engine/atoms/resolveCard.ts` (24 行)
- `tests/atoms/use-card-lifecycle.test.ts` (4 测试)

**修改**:
- `src/src/engine/atoms/index.ts`: 注册 3 个
- `src/src/engine/atom.ts`: re-export `registerAtomHook` / `clearAtomHooks`
- `src/src/engine/types.ts`: Atom 联合 + 3 变体；`cardPlayed` GameEvent 加 `@deprecated`

## 跟进项（P1）

- card handler 关键点插入 3 atom 发射
- 38+ `cardPlayed` 技能渐进迁移到 `registerAtomHook`
- view reducer 需不需要处理 3 atom（待定，目前是 no-op）

## ADR 关系

- **依赖**: ADR 0012
- **取代**: T-13 决策"取消 GameEvent"概念（**部分**——`cardPlayed` 标记 deprecated，未删）
- **被未来依赖**: 借刀 / 五谷 / 桃园 v3 实现（P1+）
