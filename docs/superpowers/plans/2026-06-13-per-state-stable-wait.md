# Per-State Stable Wait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 per-state Promise (`_waitForStable` / `_resolveStable`) 替代 `dispatch` / `fireTimeout` 中的 `setInterval(0)` 忙轮询,消除确定性差和 DRY 违规。

**Architecture:** 在 `GameState` 上加两个配套字段(per-execute lifecycle),用 `resolveStable(state)` 显式通知"execute 完成"或"新 pending 创建"事件;三处等待点(主动 action / 回应 / `fireTimeout`)都 `await state._waitForStable`。删除模块级 `currentDispatchReady` 通知器整块。

**Tech Stack:** TypeScript、Vitest、pnpm

**重构性质说明**: 本 plan 是机制替换(setInterval 轮询 → 显式 Promise 通知),语义不变(都是"等稳定点")。不做严格 TDD(无法为"消除 setInterval"写有意义的 red 测试),改用"现有集成测试做回归"模式:每个 task 完成后跑相关测试,确保行为不变。

---

## File Structure

**Modify:**
- `src/engine/types.ts` —— `GameState` 接口加 `_waitForStable` / `_resolveStable` 字段
- `src/engine/create-engine.ts` —— 加 `resolveStable` helper;`applyAtom` 改用它;`dispatch` 三处改用 `_waitForStable`;`fireTimeout` 改用 `_waitForStable`;删 `setInterval(0)` 三处;删模块级 `currentDispatchReady` 块

**No-op(显式声明):**
- `src/engine/skill.ts` —— 不动
- 任何 atom 文件 —— 不动
- `_activeExecuteP` 字段保留(其他场景可能直接 await)
- 不新增测试(现有集成测试覆盖 dispatch / response / fireTimeout 全路径)

---

## Task 1: 加类型字段 + `resolveStable` helper + `applyAtom` 接入

**Files:**
- Modify: `src/engine/types.ts` (GameState 接口)
- Modify: `src/engine/create-engine.ts` (helpers 区域 + applyAtom)

- [ ] **Step 1: 在 `GameState` 接口加两个字段**

打开 `src/engine/types.ts`,在 `GameState` 接口的 `_activeExecuteP?: Promise<void>;` 字段后加:

```ts
  /**
   * 当前 dispatch/fireTimeout 在等的"稳定点" Promise。
   * 每个 execute lifecycle 创建一个新 Promise,execute 完成或新 pending 创建时 resolve。
   * 等价于"下一个 pending 出现 OR 当前 execute 真的结束"二者择一。
   */
  _waitForStable?: Promise<void>;
  /** 配套的 resolve 函数,供通知触发点使用 */
  _resolveStable?: () => void;
```

- [ ] **Step 2: 加 `resolveStable` helper**

打开 `src/engine/create-engine.ts`,在 `// ==================== 模块级 helpers ====================` 区块内(`extractPendingTarget` 函数附近)加:

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

- [ ] **Step 3: `applyAtom` 创建 pending slot 处用 `resolveStable(state)` 替代 `notifyDispatchReady()`**

打开 `src/engine/create-engine.ts`,找 line 515-516 附近:

```ts
      const timer = setTimeout(fireTimeoutNow, timeoutMs);
      notifyDispatchReady();
```

把 `notifyDispatchReady();` 替换为 `resolveStable(state);`。

**注意**: 模块级 `notifyDispatchReady` / `setDispatchReady` / `clearDispatchReady` / `currentDispatchReady` 暂时还在,但已无人调(Task 6 删除)。这是增量重构的中间态。

- [ ] **Step 4: 跑相关集成测试,确认行为不变**

Run: `pnpm test tests/integration/create-game.test.ts tests/integration/restore-from-log.test.ts tests/integration/new-engine-hujia.test.ts tests/integration/new-engine-kill.test.ts tests/integration/new-engine-rende.test.ts tests/integration/new-engine-fire-timeout.test.ts 2>&1 | tail -5`
Expected: 全部通过。注意此时 `_waitForStable` 仍未被任何路径创建或 await,但 `resolveStable` 是 no-op,行为应当不变。

如果失败,检查:
- `resolveStable` 是否被 `import` 进 applyAtom 的作用域(同文件内 helper 直接调)
- applyAtom 是否真的走到了创建 pending slot 的分支

- [ ] **Step 5: 提交**

```bash
git add src/engine/types.ts src/engine/create-engine.ts
git commit -m "refactor(engine): 加 _waitForStable 字段 + resolveStable helper,applyAtom 接入"
```

---

## Task 2: 主动 action 路径改用 `_waitForStable`

**Files:**
- Modify: `src/engine/create-engine.ts:263-291` (主动 action 路径)

- [ ] **Step 1: 替换局部 Promise 为 per-state 字段**

定位 `// === 主动 action 路径 ===` 之后的局部 Promise 创建块(line 264-285):

```ts
  // execute 到达 pending 时 fireDispatchReady → dispatch 返回。
  // 不等 activeExecuteP:execute 在 pending 处挂起,等回应/超时后才完成。
  // fireDispatchReady 走模块级 currentDispatchReady。
  let dispatchReadyResolve: () => void = () => {};
  const dispatchReady = new Promise<void>((r) => {
    dispatchReadyResolve = r;
  });
  let fired = false;
  const fireDispatchReady = (): void => {
    if (!fired) {
      fired = true;
      dispatchReadyResolve();
    }
  };
  setDispatchReady(fireDispatchReady);
  const executeP = entry.execute(state, message.params).finally(() => {
    clearDispatchReady();
    fireDispatchReady();
  });
  state._activeExecuteP = executeP;

  // 等到 execute 抵达 pending 挂起点(fireDispatchReady 触发)就返回当前 state。
  // 不 await executeP 本身 —— execute 可能挂在 pending slot 上,要等回应或
  // fireTimeout 推进,主动 action 的调用方不需要阻塞等待。
  await dispatchReady;
```

替换为:

```ts
  // 主动 action 路径:启动 execute,await per-state stable wait。
  // 通知触发点:execute 完成(.finally) / 新 pending 创建(applyAtom via resolveStable)。
  let resolveStableLocal: () => void = () => {};
  state._waitForStable = new Promise<void>((r) => { resolveStableLocal = r; });
  state._resolveStable = resolveStableLocal;

  const executeP = entry.execute(state, message.params).finally(() => {
    resolveStable(state);    // execute 完成 → 稳定点
  });
  state._activeExecuteP = executeP;

  // 等到稳定点(execute 完成 OR 新 pending 创建)就返回当前 state。
  // 不 await executeP 本身 —— execute 可能挂在 pending slot 上。
  await state._waitForStable;
```

- [ ] **Step 2: 跑相关测试**

Run: `pnpm test tests/integration/create-game.test.ts tests/integration/new-engine-hujia.test.ts tests/integration/new-engine-kill.test.ts tests/integration/new-engine-rende.test.ts tests/integration/new-engine-fire-timeout.test.ts 2>&1 | tail -5`
Expected: 全部通过。这些测试都涉及 dispatch 主动 action 路径。

如果失败,检查:
- `resolveStable` 是否在 `.finally` 里被调到(必然,因为 finally 总跑)
- `await state._waitForStable` 是否在 dispatch 已被 resolveStable 之后执行(时序问题,正常应该不会)

- [ ] **Step 3: 提交**

```bash
git add src/engine/create-engine.ts
git commit -m "refactor(engine): 主动 action 路径改用 per-state _waitForStable"
```

---

## Task 3: 回应路径删除 setInterval

**Files:**
- Modify: `src/engine/create-engine.ts:222-238` (回应路径)

- [ ] **Step 1: 删 setInterval 块,改用 `_waitForStable`**

定位 `// 等原始 execute 完成 或 产生新 pending` 注释后的 setInterval 块:

```ts
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
```

替换为:

```ts
    // 等稳定点(主路径的 _waitForStable 会被 .finally 或新 pending 触发)
    if (state._waitForStable) {
      await state._waitForStable;
    }
    if (!state.pendingSlot) state._activeExecuteP = undefined
```

- [ ] **Step 2: 跑涉及回应路径的测试**

Run: `pnpm test tests/integration/new-engine-hujia.test.ts tests/integration/new-engine-kill.test.ts tests/integration/new-engine-rende.test.ts 2>&1 | tail -5`
Expected: 全部通过。这些测试都涉及"玩家被要求出闪/桃/杀"等回应场景。

如果失败,检查:
- `slot.resolve()` 是否真的让原 execute 继续(应该)
- 原 execute 完成后,`resolveStable` 是否被调到(通过 .finally)
- 新 pending 是否真的通过 `applyAtom` 调 `resolveStable`

- [ ] **Step 3: 提交**

```bash
git add src/engine/create-engine.ts
git commit -m "refactor(engine): 回应路径删除 setInterval(0),改用 _waitForStable"
```

---

## Task 4: fireTimeout 删除 setInterval

**Files:**
- Modify: `src/engine/create-engine.ts:310-318` (fireTimeout 内部)

- [ ] **Step 1: 删 setInterval 块,重新建立 per-state stable wait**

> **设计澄清**:fireTimeout 也是"续跑路径"——和回应路径一样,原 execute 在 pending slot 处挂起,主路径的 `_waitForStable` 已经被清成 `undefined`。需要自己建立新的 `_waitForStable` 来等待原 execute 续跑后的 `.finally` 或新 `applyAtom` 事件。**同 Task 3 回应路径的模式**。

定位 fireTimeout 内的 setInterval 块:

```ts
  if (state._activeExecuteP) {
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (state.pendingSlot) { clearInterval(timer); resolve(); }
          }, 0);
          state._activeExecuteP!.then(() => { clearInterval(timer); resolve(); });
        });
      }
  if (!state.pendingSlot) state._activeExecuteP = undefined
```

替换为:

```ts
  // 续跑路径:重新建立 stable wait 捕捉原 execute 续跑后的事件(同 Task 3 回应路径)
  let resolveStableLocal: () => void = () => {};
  state._waitForStable = new Promise<void>((r) => { resolveStableLocal = r; });
  state._resolveStable = resolveStableLocal;
  await state._waitForStable;
  if (!state.pendingSlot) state._activeExecuteP = undefined
```

- [ ] **Step 2: 跑 fireTimeout 测试**

Run: `pnpm test tests/integration/new-engine-fire-timeout.test.ts 2>&1 | tail -5`
Expected: 全部通过。

- [ ] **Step 3: 提交**

```bash
git add src/engine/create-engine.ts
git commit -m "refactor(engine): fireTimeout 删除 setInterval(0),改用 _waitForStable"
```

---

## Task 5: 删除模块级 `currentDispatchReady` 块

**Files:**
- Modify: `src/engine/create-engine.ts:335-349` (模块级 helpers 末尾的 dispatch ready 通知器)

- [ ] **Step 1: 整块删除**

定位:

```ts
// ─── 模块级 dispatch ready 通知器 ──────────────────────────────

let currentDispatchReady: () => void = () => {};

export function setDispatchReady(fn: () => void): void {
  currentDispatchReady = fn;
}

export function clearDispatchReady(): void {
  currentDispatchReady = () => {};
}

function notifyDispatchReady(): void {
  currentDispatchReady();
}
```

整块删除(连同 `// ─── ... ───` 横线注释)。

- [ ] **Step 2: typecheck 确认无外部引用**

Run: `pnpm typecheck 2>&1 | rg "setDispatchReady|clearDispatchReady|notifyDispatchReady" || echo "(无引用,正常)"`
Expected: "(无引用,正常)"

如果有引用,Run: `rg "setDispatchReady|clearDispatchReady|notifyDispatchReady" src/` 找出调用方,先清理它们的 import 再删。

- [ ] **Step 3: 跑全量相关测试**

Run: `pnpm test tests/integration/create-game.test.ts tests/integration/restore-from-log.test.ts tests/integration/new-engine-hujia.test.ts tests/integration/new-engine-kill.test.ts tests/integration/new-engine-rende.test.ts tests/integration/new-engine-fire-timeout.test.ts 2>&1 | tail -5`
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add src/engine/create-engine.ts
git commit -m "refactor(engine): 删除模块级 currentDispatchReady 通知器(被 per-state 替代)"
```

---

## Task 6: grep 守卫 + 全量回归

**Files:** none

- [ ] **Step 1: 确认没有 setInterval 残留**

Run: `rg "setInterval" src/engine/`
Expected: 空输出。

- [ ] **Step 2: 确认模块级 dispatch ready 通知器无残留**

Run: `rg "currentDispatchReady|setDispatchReady|clearDispatchReady|notifyDispatchReady" src/`
Expected: 空输出。

- [ ] **Step 3: 跑 typecheck**

Run: `pnpm typecheck 2>&1 | tail -5`
Expected: 0 新错误(预存在的 `tests/weapon-bugs.test.ts` 错误除外)。

- [ ] **Step 4: 跑全量测试**

Run: `pnpm test 2>&1 | rg "Test Files|Tests" | tail -3`
Expected: 失败数与重构前**持平或更少**。如果失败数变多,说明新机制引入了 regression —— 停下来排查。

---

## Task 7: 收尾验证

**Files:** none

- [ ] **Step 1: 检查 git log**

Run: `git log --oneline -8`
Expected: 看到本 plan 的 5 个新 commit(在 spec commit `f3f726f` 之后):
1. `refactor(engine): 加 _waitForStable 字段 + resolveStable helper,applyAtom 接入`
2. `refactor(engine): 主动 action 路径改用 per-state _waitForStable`
3. `refactor(engine): 回应路径删除 setInterval(0),改用 _waitForStable`
4. `refactor(engine): fireTimeout 删除 setInterval(0),改用 _waitForStable`
5. `refactor(engine): 删除模块级 currentDispatchReady 通知器(被 per-state 替代)`

- [ ] **Step 2: 最终验证**

Run: `pnpm test tests/integration/create-game.test.ts tests/integration/new-engine-fire-timeout.test.ts 2>&1 | tail -5`
Expected: 全部通过。

完工。
