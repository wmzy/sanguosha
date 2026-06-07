# ADR 0025: 异步钩子 — v3 引擎终态

> **状态**：设计中
> **日期**：2026-06-07
> **决策者**：（TBD）

## 背景

当前 v3 `registerAtomHook` API（`src/engine/skill-hook.ts`）的 `onBefore` / `onAfter` 是**纯同步函数**，返回值是 `{ cancel?, atom?, state?, redirect?, additionalAtoms? }`——原子级别的副作用，无"等待玩家"概念。

51 个 v2 老技能（监听 `受到伤害` / `出牌` / `回合结束` / `杀被闪避` / `杀命中` 5 个 GameEvent）的 handler 返回 `SkillPhase[]`——`prompt` / `judge` / `multiStep` / `respond` 节点可以**挂起等玩家响应**。

v3 钩子要 100% 替代 v2 handler，必须**支持挂起-恢复**。

## 决策

`onBefore` / `onAfter` 改为 **`async function`**，可以 `await pending(...)` 挂起等玩家响应。

引擎调度器在钩子挂起时**冻结当前 dispatch**（不进入下个 action），等玩家响应后**从 `await` 恢复**继续执行。

### API 形状

```ts
export interface AsyncHook {
  /** 稳定标识（序列化 / 日志 / 调试） */
  id: string;
  /** 调试 / UI 描述（i18n key 或纯文本） */
  description?: string;
  /** 监听哪个 atom type */
  atomType: string;
  /** 玩家过滤（self === player 才触发） */
  player?: string;
  /** 动态启用（return false 视为未注册） */
  filter?: (state: GameState, atom: Atom, self: string) => boolean;
  /** apply 之前：可取消 / 替换 atom / 改 state / 挂起等玩家 */
  onBefore?: (ctx: HookCtx) => Promise<HookResult> | HookResult;
  /** apply 之后：可改 state / 追加 atom / 挂起等玩家 */
  onAfter?: (ctx: HookCtx) => Promise<HookResult> | HookResult;
  /** 异步挂起的统计 / 元数据 */
  metadata?: {
    /** 教学引导 / 玩法说明 */
    tutorial?: string;
    /** AI Bot 响应策略标识（'random' | 'firstOption' | 'hostileTarget' | ...）*/
    aiPolicy?: string;
    /** 该钩子在 UI 中的"等待秒数"默认值 */
    defaultTimeout?: number;
  };
}

export interface HookCtx {
  state: GameState;
  atom: Atom;
  self: string;
  serverEvent?: ServerEvent;
  /** 仅 onAfter：恢复响应（pending 解决后） */
  resume?: { response: Json | 'cancel' | 'timeout' };
}

export type HookResult =
  | { kind: 'continue' }
  | { kind: 'cancel' }
  | { kind: 'redirect'; target: string }
  | { kind: 'modifyState'; state: GameState }
  | { kind: 'additionalAtoms'; atoms: Atom[] }
  | { kind: 'pending'; def: PendingDef; tag?: Json }
  | { kind: 'pendingThen'; def: PendingDef; then: (resume: ResumeData) => Promise<HookResult | HookResult[]>; tag?: Json };

export interface PendingDef {
  type: '选项' | '判定' | '出牌响应' | '多步' | '弹窗';
  player: string;
  data: Json;
  timeout?: number;
  onTimeout?: Json;
  cancelable?: boolean;
  broadcastTo?: string[];
  ui: {
    title: string;
    description?: string;
    options?: Array<{ value: Json; label: string; description?: string; disabled?: boolean }>;
  };
}

export type ResumeData =
  | { kind: 'response'; value: Json }
  | { kind: 'cancel' }
  | { kind: 'timeout' };

/** 钩子内 helper：挂起等玩家 */
declare function pending<T = Json>(def: PendingDef, tag?: Json): Promise<T | ResumeData>;
declare function cancel(): HookResult;
declare function redirect(target: string): HookResult;
```

### 关键约束（**必须**遵守）

1. **钩子禁止闭包状态**：所有中间状态显式存 `state.localVars[hookId:key]`
2. **钩子禁止全局副作用**：副作用只能通过 `HookResult.kind` 表达
3. **`pending()` 是唯一 await 点**：不允许 `await setTimeout` / `fetch` 等非 pending 异步
4. **钩子必须 `id` 稳定**：跨序列化、跨重启必须保持唯一
5. **钩子内读 state 必须在 await 之间重新取**：`const newState = await pending(...); state` 是旧 state

### Pending 序列化协议

```ts
interface SerializedPending {
  id: string;                         // 稳定 uuid
  hookId: string;                     // 恢复时调哪个钩子
  resumePoint: 'onBefore' | 'onAfter' | 'onResume';
  atomSnapshot: Atom;                 // 重放上下文
  self: string;                       // 钩子 self 引用
  def: PendingDef;                    // PendingDef 完整数据
  startedAt: number;                  // 挂起时间戳
  deadline: number;                   // 绝对 deadline
  tag?: Json;                         // 钩子自定义 tag
}
```

### 32 个场景的覆盖确认

| # | 场景 | 覆盖机制 |
|---|---|---|
| 1 | 倒计时 | `pending.timeout` + `onTimeout` |
| 2 | 序列化 | `SerializedPending` 进 `state.serverLog` / DB |
| 3 | 重启恢复 | 重启时 `state.pending` 重建，broadcastTo 玩家 UI |
| 4 | 并发请求 | 引擎单线程；pending 不匹配拒绝 |
| 5 | 嵌套异步 | `await pending(...); await pending(...)` 自然嵌套 |
| 6 | 钩子间依赖 | `state.localVars[hookId1:result]` 通信（约定 namespace）|
| 7 | 异常处理 | async/await + try/catch |
| 8 | 性能 | O(n) 钩子链遍历，n 当前 ~11，可接受 |
| 9 | 调试 | hookId + ui.description + serverLog 全链路 |
| 10 | 测试 | mock `pending()` helper 直接驱动 |
| 11 | 取消 | `Result<T, Cancel>` 类型 |
| 12 | 动态注册 | filter 收窄，替代动态 register |
| 13 | 可发现性 | `id` 稳定 + `description` + `metadata` |
| 14 | 重入语义 | onBefore cancel 短路后 onAfter 不跑 |
| 15 | 可重入性 | 钩子可多次注册，filter 收窄；多目标 atom 走 additionalAtoms |
| 16 | 原子性 | additionalAtoms 失败不影响主 atom |
| 17 | 事务边界 | v3 非事务性（ADR 0012 T-02 决策）|
| 18 | 权限边界 | 钩子只能改 state、附加 atom、挂 pending |
| 19 | 调度公平性 | pending FIFO 队列，超时优先级最高 |
| 20 | 日志 / 审计 | pending id + hookId + 时间戳全进 serverLog |
| 21 | 组合性 | onAfter 内 await pending(...) 调其他钩子（自然组合）|
| 22 | 撤销 | pending.cancelable 字段，cancel 响应走 Result.cancel |
| 23 | 教学 | `metadata.tutorial` + `ui.description` |
| 24 | i18n | 结构化 `ui: { title, description, options[] }` |
| 25 | 统计 | `metadata.aiPolicy` + 引擎统计每 hookId 触发次数 |
| 26 | 多玩家私有信息 | 钩子可读 `state.players[target].hand`（v2 行为不变）|
| 27 | 事件溯源 | hookId + atomSnapshot 进 serverLog |
| 28 | 网络协议 | SerializedPending → JSON，前端渲染 |
| 29 | 超时嵌套 | pending 接受 `timeout` + `onTimeout` |
| 30 | AI 集成 | `metadata.aiPolicy` + SerializedPending.data 自描述 |
| 31 | 概率事件 | 走 `pending({ type: '判定' })` |
| 32 | 多人同步 | `pending.broadcastTo: string[]`——多人必须同时响应 |

## 影响

### 引擎核心
- `src/engine/atom.ts:applyAtoms` 改 async + 支持 pending 挂起
- `src/engine/skill-hook.ts:HookRegistry` 支持异步钩子
- `src/engine/create-engine.ts:dispatch` 接受 pending 状态
- `src/engine/state.ts:GameState` 已有 `pending: PendingAction | null` 字段——**复用**

### 类型系统
- 新增 `src/engine/async-hook.ts`（核心类型）
- `src/engine/hook-helpers.ts`：`pending()`, `cancel()`, `redirect()` 等
- `src/engine/atom-async.ts`：`applyAtomsAsync` 异步版

### 51 技能迁 v3
- `SkillDef.handler` 字段标记 `@deprecated`（v2 老系统）
- 51 个技能逐个翻译为 `AsyncHook`
- 5 处 emitEvent 调用全部删除
- v2 SkillPhase DSL 全部删除

### 测试
- 5+ 核心场景 e2e 测试
- 异步钩子单元测试（mock pending）

## 不实施

- **钩子"组合"**（场景 21）——v2 无此能力，新增需求。**YAGNI**。
- **时间旅行调试**（场景 33）——调试工具范畴，引擎层不做。

## 备选方案

### 方案 B：skillPhase 字段

```ts
onAfter: ({ state, atom }) => ({
  skillPhase: [
    { type: 'prompt', text: '...', options: [...] },
    { type: 'atoms', ops: [...] },
  ],
});
```

**缺点**：在 v3 钩子 API 里"开后门"调 v2 DSL（SkillPhase），双 DSL 共存。

### 方案 C：保留 v2 trigger.event + emitEvent 永久共存

**缺点**：v3 钩子永远只是 v2 的"补充"，51 技能永久 v2 路径。架构不收敛。

## 推荐

**方案 A（异步钩子）**——单一原语（async function + `pending()` helper），概念数最少，与 v2 老系统彻底分离。

## 实施

阶段 A 已完成（v3 钩子基础设施）。
**本 ADR 描述的目标是 v3 引擎的"6 周工程"**——分阶段实施：

1. **第 1 周**：API 类型定义 + 关键 helper（本次产出）
2. **第 2-3 周**：`applyAtomsAsync` / `engine.dispatch` 重构
3. **第 4 周**：51 技能 v3 翻译（每技能 30 分钟模板化）
4. **第 5 周**：v2 SkillPhase DSL 删除 + emitEvent 站点删除
5. **第 6 周**：完整测试覆盖 + 文档更新

## 已完成的原型

本次设计产出了 3 个文件（仅骨架，未集成到引擎）：

- `src/engine/async-hook.ts`：核心类型（AsyncHook / HookResult / PendingDef / AsyncPending / SerializedPending / AsyncHookRegistry）
- `src/engine/hook-helpers.ts`：`pending()` / `cancel()` / `redirect()` / `setLocalVar()` / `getLocalVar()` + `PendingRequestSignal` + `currentHookContext`
- `src/engine/atom-async.ts`：`applyAtomsAsync` 异步版骨架——逐 atom 跑 onBefore → apply → onAfter，pending 挂起返回 AsyncPending

**尚未完成**：
- `create-engine.ts:dispatch` 改 async（接受 AsyncPending）
- `state.ts:GameState.pending` 字段扩 type 联合
- 51 技能翻译
- v2 SkillPhase DSL 删除
- 5 处 emitEvent 站点删除
