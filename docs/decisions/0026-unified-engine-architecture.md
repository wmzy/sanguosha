# ADR 0026 — 统一引擎架构：技能编排 + Atom 执行 + 栈驱动

**状态**: 提案

**前置依赖**: ADR 0012（统一 applyAtoms）、ADR 0015（3 原子）、ADR 0016（useCard 3 原子）

## 背景

当前引擎存在三层耦合问题：

### 1. GameAction 是多余的抽象

`GameAction` 有 9 种变体（`打出一张牌`/`打出`/`结束回合`/`弃置`/`使用技能`/`技能选择`/`开始`/`切换自动跳过无懈可击`/`异步钩子响应`），但本质只有两类操作：**触发技能**和**响应选择**。

`打出一张牌` 和 `使用技能` 做的是同一件事——"杀"和"遗计"都是技能，区别只是前者需要消耗一张杀令牌。两个 action type 并存导致验证和 handler 各写一套。

### 2. 卡牌不应携带行为

`card-handlers.ts` 500+ 行 switch-case 把"牌的属性"和"使用这张牌的规则"混在一起。杀的 handler 知道"要开响应窗口等出闪"，桃的 handler 知道"回复1点体力"——这些是**游戏规则**，不是牌的属性。

牌只是令牌（token）：名称、花色、点数、类型。行为属于技能。

### 3. 验证分散在三处

- `validate.ts`：硬编码杀/桃/锦囊验证规则（"范围检查"、"出杀次数"、"体力不满"）
- `card-handlers.ts`：重复检查（目标存活、距离、手牌存在）
- `SkillDef`：无 `validate` 字段，技能验证散落在各 handler

同一件事（"杀能不能出"）的逻辑分散在 `validate.ts:198-210`、`card-handlers.ts:84-91`、`validate.ts:209`（空城检查只在 validate，handler 靠钩子兜底）。

### 4. 执行栈不可见

`applyAtoms` 内部通过 JS 调用栈递归处理钩子的 `additionalAtoms`，栈深度用 `MAX_HOOK_RECURSION = 16` 限制。GameState 上看不出"当前执行到哪、嵌套了什么、挂起原因"。Pending 状态机和 atom 执行是两套独立机制。

## 决策

### 决策 1：三层架构——客户端 → 技能 → Atom

```
客户端 ──触发技能──→ SkillDef.validate + orchestrate ──返回 atom 序列──→ applyAtoms ──执行──→ GameState
```

| 层 | 职责 | 知道什么 | 不知道什么 |
|---|---|---|---|
| 客户端 | 表达意图 | 我想用什么技能、用什么牌、对谁 | atom、state 内部结构 |
| 技能（SkillDef） | 验证 + 编排 | 这件事合法吗、应该产生什么 atom 序列 | 其他技能的存在 |
| Atom | 状态变更 | 怎么改 state | 为什么被调用、谁在调用 |

技能是编排层，Atom 是执行层。客户端不直接碰 Atom。

### 决策 2：牌是令牌，使用牌是技能

牌只有属性（名称、花色、点数、类型），不携带行为。

"使用杀"、"使用桃"、"使用决斗"、"使用诸葛连弩"都是技能。和武将技能（遗计、反馈、刚烈）的区别只是：卡牌技能需要消耗对应的令牌。

```ts
interface SkillDef {
  id: string;
  name: string;
  description: string;

  /** 技能消耗的令牌。undefined = 无需令牌（武将技能） */
  requiresCard?: string | ((card: Card) => boolean);

  /** 被动卡牌转换声明（倾国/龙胆/武圣等"X 当 Y"） */
  convertible?: SkillConvertible[];

  /** 验证：这件事在当前 state 下合法吗？返回 null = 合法 */
  validate(ctx: SkillContext, state: GameState): string | null;

  /** 编排：返回 atom 序列。可含 pending 节点（暂停等待玩家输入） */
  orchestrate(ctx: SkillContext, state: GameState): AtomOrPending[];

  /** v3 atom 钩子注册（被动技能） */
  registerHooks?: (registry: HookRegistry) => void;
}
```

`orchestrate` 返回的是 atom 序列，其中可以包含 `PendingAtom`（暂停点）。引擎逐个执行 atom，遇到 pending 就暂停栈，等玩家 resume 后继续。

### 决策 3：消除 GameAction

客户端协议统一为：

```ts
type ClientMessage =
  | { type: '使用技能'; skillId: string; params: Record<string, Json> }
  | { type: '选择'; choice: Json }
  | { type: '开始' }
```

| 旧 GameAction | 新映射 |
|---|---|
| `打出一张牌`（杀） | `使用技能 { skillId: '杀', params: { cardId, targets: [target] } }` |
| `打出一张牌`（桃） | `使用技能 { skillId: '桃', params: { cardId } }` |
| `打出一张牌`（装备） | `使用技能 { skillId: '装备', params: { cardId } }` |
| `打出一张牌`（锦囊） | `使用技能 { skillId: card.name, params: { cardId, target? } }` |
| `打出`（响应出闪） | `使用技能 { skillId: '闪', params: { cardId } }` |
| `打出`（响应出杀） | `使用技能 { skillId: '杀', params: { cardId } }` |
| `使用技能`（武将技能） | `使用技能 { skillId, params: {} }` |
| `技能选择` | `选择 { choice }` |
| `弃置` | `选择 { choice: { cardIds } }` |
| `结束回合` | `使用技能 { skillId: '结束回合', params: {} }` |

`card-handlers.ts` 的 500 行 switch-case 消失。每种牌的验证和编排逻辑在对应的 `SkillDef` 里。

### 决策 4：Atom 只做 validate + apply

Atom 是最小的状态变更单元，两个职责：

```ts
interface AtomDefinition<A = unknown> {
  type: string;
  /** 验证：这个 atom 在当前 state 下合法吗？ */
  validate(state: GameState, atom: A): string | null;
  /** 执行：修改 state 并返回新 state */
  apply(state: GameState, atom: A): GameState;
  /** 可选：per-player 可见性分叉 */
  toPlayerViews?(state: GameState, atom: A): AtomPlayerViews | undefined;
  /** 可选：apply 后提取结果注入 ctx.localVars */
  getResult?(state: GameState, atom: A): Record<string, Json>;
}
```

Atom 不知道为什么被调用、谁在调用。高层 atom（使用杀、使用桃）不存在——它们是技能，不是 atom。Atom 只有 `造成伤害`、`摸牌`、`移动牌`、`回复体力` 这些**不可再分**的操作。

`validateAction` 变薄为**阶段级守卫**（"当前有没有 pending"、"是不是你的回合"），数据级验证下放到 `SkillDef.validate` 和 `AtomDefinition.validate`。

### 决策 5：栈驱动执行

GameState 新增执行栈：

```ts
interface StackFrame {
  /** 当前处理的 atom */
  atom: Atom;
  /** 执行阶段：validate | apply | hooks | done */
  phase: 'validate' | 'apply' | 'hooks' | 'done';
  /** hooks 阶段：当前处理到第几个钩子 */
  hookIndex: number;
  /** onBefore 钩子列表缓存 */
  hooks: AtomHook[];
  /** 这一层是由哪个技能编排产生的（用于调试/回放） */
  sourceSkillId?: string;
}

interface GameState {
  // ... 现有字段
  /** 执行栈。栈顶 = 当前正在处理的 atom */
  stack: StackFrame[];
}
```

执行模型从递归改为栈驱动的循环：

```
while (stack 非空) {
  frame = stack.top

  switch (frame.phase) {
    case 'validate':
      error = atomDef.validate(state, frame.atom)
      if (error) → 标记取消，弹出
      else → phase = 'apply'

    case 'apply':
      state = atomDef.apply(state, frame.atom)
      写 logEntry
      phase = 'hooks'

    case 'hooks':
      查下一个钩子
      if 无剩余钩子 → phase = 'done'
      if 钩子返回 cancel → 标记取消，弹出
      if 钩子返回 additionalAtoms → 保存现场，additionalAtoms 依次压栈
      if 钩子返回 pending → 栈暂停，等待 resume

    case 'done':
      弹出栈顶
  }
}
```

**与 pending 的统一**：pending 不再是独立的 pending 状态机，而是"栈暂停等待输入"。

- 推入待定 atom 的 apply = 在栈顶设置"等待输入"标记
- 客户端发 `选择` = resume 栈顶，注入选择结果，继续循环
- onTimeout = 自动注入默认选择，resume 栈

**栈的可见性**：

- 调试时能看到完整的执行上下文（嵌套深度、每层在干什么）
- 重放时能精确恢复到任意暂停点
- 错误报告时能附带栈信息

**不需要 `skipHooks` 和 `MAX_HOOK_RECURSION`**：

- 钩子产生的 atom 通过规则控制（如"钩子产生的 atom 不再触发同级钩子"），而非布尔开关
- 栈深度由 `stack.length` 限制，溢出时抛异常

### 决策 7：异步 hook 不再需要（取代 ADR 0025）
ADR 0025 的异步 hook（`async function onBefore/onAfter` + `await pending(...)`）要解决的问题：钩子执行中需要等待玩家输入。

栈驱动模型下这个问题自然解决：

```
栈处理 damage atom → onAfter 钩子
  → 钩子返回 additionalAtoms: [推入待定(八卦阵判定)]
  → 推入待定压栈 → 栈暂停 → 等玩家响应
  → resume → 判定结果压栈 → 继续处理
  → 钩子处理完毕 → 弹出 → 回到 damage 继续下一个钩子
```

不需要 `async`/`await`，不需要 Promise，不需要第二套 `AsyncEngine`。栈暂停就是"异步等待"，栈继续就是"同步执行"，同一个执行模型。

可删除：
- `async-hook.ts`（AsyncHookRegistry）
- `atom-async.ts`（applyAtomsAsync）
- `async-engine.ts`（createAsyncEngine）
- `hook-helpers.ts`（pending/cancel/redirect）

## 后果

### 正面

- **验证集中**：每种技能/atom 的验证逻辑在 `SkillDef.validate` / `AtomDefinition.validate`，不再分散
- **handler 层消失**：`card-handlers.ts` 500 行 switch-case → 各 `SkillDef.orchestrate`，职责清晰
- **GameAction 简化**：9 种变体 → 3 种（使用技能/选择/开始），客户端协议更简洁
- **栈可观察**：执行状态显式在 GameState 上，调试和重放更精确
- **pending 统一**：不再有独立的 pending 状态机，pending = 栈暂停
- **扩展性好**：新牌/新技能只需注册 `SkillDef`，不改动引擎核心
- **消除双引擎**：异步 hook（ADR 0025）的 `AsyncEngine`/`applyAtomsAsync` 不再需要，一套执行模型覆盖所有场景

### 负面

- **迁移量大**：现有 ~15 种卡牌效果需重写为 `SkillDef`，所有 handler 需重写
- **客户端协议不兼容**：`GameAction` → `ClientMessage`，客户端需要适配
- **栈机制复杂度**：栈驱动的循环比递归更难直观理解
- **编排暂停点**：技能的 `orchestrate` 返回的 atom 序列中含 pending 节点，需要设计暂停/恢复的序列化格式

### 不改的部分

- Atom 的 `apply` 逻辑不变（造成伤害、摸牌、回复体力等）
- Expr resolve 机制不变
- RNG 和种子管理不变
- `HookRegistry` 类和 `registerAtomHook` API 不变
- `AtomLogEntry` + `toPlayerViews` 可见性分叉不变（决策 6 已在执行）

## 迁移路径

### Phase 1：基础设施

1. `SkillDef` 新增 `validate`、`orchestrate`、`requiresCard` 字段
2. `AtomDefinition` 新增 `validate` 字段
3. `GameState` 新增 `stack: StackFrame[]`
4. 重写 `applyAtoms` 为栈驱动循环
5. 删除异步 hook 相关文件（`async-hook.ts`、`atom-async.ts`、`async-engine.ts`、`hook-helpers.ts`）

### Phase 2：卡牌技能注册

6. 为每种卡牌（杀/桃/闪/装备/锦囊×8）注册 `SkillDef`
7. 每种卡牌的 `validate` + `orchestrate` 从 `validate.ts` + `card-handlers.ts` 迁入

### Phase 3：消除旧抽象

8. 删除 `GameAction`，替换为 `ClientMessage`
9. 删除 `card-handlers.ts`
10. `validate.ts` 只保留阶段级守卫
11. 统一 pending 为栈暂停

### Phase 4：客户端适配

12. 客户端协议适配 `ClientMessage`
13. view/reducer 从 event 驱动改为 atom 驱动

## 与现有 ADR 的关系

- **取代**：`card-handlers.ts` 的 switch-case 分发模式、ADR 0025（异步 hook PoC）
- **依赖**：ADR 0012（统一 applyAtoms）、ADR 0015（3 原子）、ADR 0016（useCard 3 原子）
- **包含**：atom-as-event 迁移（serverLog 存 AtomLogEntry）作为本 ADR 的一部分
- **被影响**：ADR 0013（技能-角色解耦）的 `SkillDef` 接口需扩展
