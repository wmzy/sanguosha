# Per-State Stable Point 等待机制设计

> 用 per-state Promise 替代 `dispatch` / `fireTimeout` 中的 `setInterval(0)` 忙轮询,显式通知 "execute 完成" 和 "新 pending 创建" 两个稳定点事件,消除轮询带来的不确定性和 DRY 违规。

**日期**: 2026-06-13
**状态**: 设计完成,待用户 review
**前置依赖**:
- `src/engine/create-engine.ts` `dispatch` / `fireTimeout` / `applyAtom` 现状
- `src/engine/types.ts` `GameState` 接口

---

## 1. 目标与边界

### 1.1 目标

- 消除 `setInterval(0)` 忙轮询(确定性差、Node 调度依赖、replay 友好性差)
- 统一"等待稳定点"机制:主动 action 路径、回应路径、`fireTimeout` 三处走同一通道
- 修复"主动 action 路径有显式通知、回应/fireTimeout 用轮询"的不一致
- 类型上明确"等稳定点"是一个一等公民机制(挂在 GameState 上,生命周期清楚)

### 1.2 范围

**改**
- `src/engine/create-engine.ts`:
  - `dispatch` 主动 action 路径:把局部 `dispatchReady` Promise 改为 per-state `_waitForStable`
  - `dispatch` 回应路径:删除 setInterval(0) 块,改为 await `_waitForStable`
  - `fireTimeout`:删除 setInterval(0) 块,改为 await `_waitForStable`
  - `applyAtom` 创建 pending slot 处(line 516 附近):加 `resolveStable(state)` 调用
  - 删除模块级 `currentDispatchReady` / `setDispatchReady` / `clearDispatchReady` / `notifyDispatchReady` 整块
- `src/engine/types.ts`:
  - `GameState` 加 `_waitForStable?: Promise<void>` 和 `_resolveStable?: () => void` 字段

**不改**
- `_activeExecuteP` 字段:保留(其他场景可能直接 await 它,删除需 audit 引用)
- 任何 skill / atom 实现
- `slot.resolve` / `slot._fireTimeoutNow` 等 PendingSlot 内部机制

---

## 2. 设计

### 2.1 数据结构

在 `GameState` 上加两个配套字段(用于 per-execute 稳定点等待):

```ts
export interface GameState {
  // ... 已有字段

  /**
   * 当前 dispatch/fireTimeout 在等的"稳定点" Promise。
   * 每个 execute lifecycle 创建一个新 Promise,execute 完成或新 pending 创建时 resolve。
   * 等价于"下一个 pending 出现 OR 当前 execute 真的结束"二者择一。
   */
  _waitForStable?: Promise<void>;

  /** 配套的 resolve 函数,供通知触发点使用(applyAtom 创建 pending / executeP finally) */
  _resolveStable?: () => void;
}
```

### 2.2 通知触发点(2 处)

#### 2.2.1 `applyAtom` 创建 pending slot 时

在 `create-engine.ts:516` 附近,**替换** `notifyDispatchReady()` 为 `resolveStable(state)`:

```ts
const timer = setTimeout(fireTimeoutNow, timeoutMs);
resolveStable(state);             // 替换旧的 notifyDispatchReady()
```

#### 2.2.2 主动 action 的 `executeP.finally`

在 `create-engine.ts:276-279` 的 `.finally` 块里,**替换** `clearDispatchReady()` / `fireDispatchReady()` 为 `resolveStable(state)`:

```ts
const executeP = entry.execute(state, message.params).finally(() => {
  resolveStable(state);            // 替换旧的 clearDispatchReady + fireDispatchReady
});
```

### 2.3 `resolveStable` helper

作为内部函数定义在 `create-engine.ts` 模块顶部 helpers 区域:

```ts
/** 解析当前 _waitForStable Promise(若存在)。通知 stable point 事件已发生。 */
function resolveStable(state: GameState): void {
  const r = state._resolveStable;
  if (r) {
    r();
    state._waitForStable = undefined;
    state._resolveStable = undefined;
  }
}
```

### 2.4 主动 action 路径(dispatch line 263-285)

把 `dispatchReady` 局部 Promise 改为 per-state 字段。删除 `setDispatchReady` / `clearDispatchReady` / `fireDispatchReady` 的所有局部闭包。

```ts
// 主动 action 路径(修改后)

// 1. 创建 stable wait(per-execute)
let resolveStableLocal: () => void = () => {};
state._waitForStable = new Promise<void>((r) => { resolveStableLocal = r; });
state._resolveStable = resolveStableLocal;

// 2. 启动 execute,完成时 resolve stable
const executeP = entry.execute(state, message.params).finally(() => {
  resolveStable(state);    // execute 完成 → 稳定点
});
state._activeExecuteP = executeP;

// 3. 等稳定点(显式通知,不是轮询)
await state._waitForStable;
```

### 2.5 回应路径(dispatch line 222-237)

删除 setInterval(0) 块,**重新建立** `_waitForStable` Promise 捕捉原 execute 续跑后的事件:

> **设计澄清**:回应路径是"续跑路径"——原 execute 在 pending slot 处挂起,主路径的 `_waitForStable` 已经被 `applyAtom` 创建 pending 时 resolve 掉并清成 `undefined` 了。回应路径需要**自己建立**新的 `_waitForStable` 来等待原 execute 续跑后的 `.finally`(完成)或新 `applyAtom`(新 pending)事件。同样的模式适用于 `fireTimeout`(§2.6)。

```ts
// 回应路径(修改前)
const resolve = slot.resolve;
slot.resolve = () => {};
resolve();

// 等原始 execute 完成 或 产生新 pending
if (state._activeExecuteP) {
  await Promise.race([
    state._activeExecuteP,
    new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (state.pendingSlot) { clearInterval(timer); resolve(); }
      }, 0);
      state._activeExecuteP!.then(() => clearInterval(timer));
    }),
  ]);
}
if (!state.pendingSlot) state._activeExecuteP = undefined

// 回应路径(修改后)
const resolve = slot.resolve;
slot.resolve = () => {};
resolve();

// 等稳定点:重新建立 per-state stable wait,捕捉原 execute 续跑后的
// .finally(完成)或 applyAtom 创建新 pending 事件。
let resolveStableLocal: () => void = () => {};
state._waitForStable = new Promise<void>((r) => { resolveStableLocal = r; });
state._resolveStable = resolveStableLocal;
await state._waitForStable;
if (!state.pendingSlot) state._activeExecuteP = undefined
```

### 2.6 fireTimeout(create-engine.ts:304-321)

同样删除 setInterval(0) 块,同样**重新建立** `_waitForStable`:

```ts
// fireTimeout(修改前)
export async function fireTimeout(state: GameState): Promise<DispatchResult> {
  const slot = state.pendingSlot;
  if (!slot) return {};
  await slot._fireTimeoutNow?.();
  if (state._activeExecuteP) {
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (state.pendingSlot) { clearInterval(timer); resolve(); }
      }, 0);
      state._activeExecuteP!.then(() => { clearInterval(timer); resolve(); });
    });
  }
  if (!state.pendingSlot) state._activeExecuteP = undefined
  const { gameOver, winner } = checkGameOver(state);
  return { gameOver, winner };
}

// fireTimeout(修改后)
export async function fireTimeout(state: GameState): Promise<DispatchResult> {
  const slot = state.pendingSlot;
  if (!slot) return {};
  await slot._fireTimeoutNow?.();
  // 续跑路径:重新建立 stable wait 捕捉原 execute 续跑后的事件(同 §2.5)
  let resolveStableLocal: () => void = () => {};
  state._waitForStable = new Promise<void>((r) => { resolveStableLocal = r; });
  state._resolveStable = resolveStableLocal;
  await state._waitForStable;
  if (!state.pendingSlot) state._activeExecuteP = undefined
  const { gameOver, winner } = checkGameOver(state);
  return { gameOver, winner };
}
```

### 2.7 删除项

模块级 `currentDispatchReady` / `setDispatchReady` / `clearDispatchReady` / `notifyDispatchReady` 整块从 `create-engine.ts` 删除(line 335-349)。被 per-state 字段完全替代。

---

## 3. 验证

### 3.1 现有测试应继续通过

直接受影响的测试:

- `tests/integration/new-engine-fire-timeout.test.ts` —— 覆盖 `fireTimeout` 路径
- `tests/integration/new-engine-kill.test.ts` —— 覆盖 `dispatch` + 等待型 atom
- `tests/integration/new-engine-hujia.test.ts` —— 覆盖护甲伤害拦截 + 回应
- `tests/integration/new-engine-rende.test.ts` —— 覆盖仁德 + 等待型牌
- `tests/integration/create-game.test.ts` —— 覆盖 bootstrap(经 dispatch)
- `tests/integration/restore-from-log.test.ts` —— 覆盖 dispatch 回放

### 3.2 新增防御性测试

1. **`_waitForStable` 在 execute 创建 pending 时 resolve**
   - 调 `dispatch` 触发一个会创建 pending slot 的 execute
   - 验证 `state._waitForStable` 已被 resolve(undefined)
2. **`_waitForStable` 在 execute 正常完成时 resolve**
   - 调 `dispatch` 触发一个不创建 pending 的 execute
   - 验证 `state._waitForStable` 已被 resolve
3. **回应路径不再 setInterval**
   - 集成测试: 回应 pending slot 后,state `_waitForStable` 在合理时间内已 resolve(无遗留 timer)
4. **`fireTimeout` 不再 setInterval**
   - 集成测试: `fireTimeout` 后 `_waitForStable` 解析

### 3.3 手动验证

```bash
pnpm test                         # 全量
pnpm typecheck                    # 0 错误
rg "setInterval" src/engine/      # 期望:0 命中
rg "currentDispatchReady\|setDispatchReady\|notifyDispatchReady" src/  # 期望:0 命中
```

---

## 4. 安全性 & 边界

### 4.1 并发安全

- 引擎假设**串行 dispatch**(`currentDispatchReady` 也是这么假设的)。per-state 字段同样假设串行。
- 多个 dispatcher 不会同时调 `await state._waitForStable` —— 当前 `dispatch` 是 async 但调用方同步等结果

### 4.2 leak 风险

- `resolveStable` 总是同时清 `_waitForStable` / `_resolveStable`,避免 stale resolver
- execute 异常路径(`.finally`):保证 resolve,避免 waiter 永远挂起
- 主动 action 创建的 wait,在 dispatch 返回时已被清(下个 dispatch 会创建新的)

### 4.3 _activeExecuteP 是否仍需要

保留。原因:
- 回应路径上 `entry.execute(state, message.params)` 是新 execute,**不是** `_activeExecuteP`
- 但其他场景(测试代码、未来重构)可能直接 await `_activeExecuteP`
- 删除需 audit 全部引用,超出本次 spec 范围

### 4.4 失败模式

- 如果 applyAtom 在 executeP 之前就出错(validate 失败),stable wait 没创建,无需 resolve —— 自然路径
- 如果 executeP 抛非预期的错,`.finally` 仍会 resolve stable,waiter 解锁 —— 安全
