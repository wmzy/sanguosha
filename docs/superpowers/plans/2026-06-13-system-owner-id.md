# System Owner ID 约定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把开局技能和 bootstrap 中借用的 `'主公'` 字面量替换为保留字 `'系统'`,为后续 system skill 统一命名空间,类型零改动。

**Architecture:** 在 `src/engine/skills/开局.ts` 提一个 `SYSTEM_OWNER = '系统'` 常量,把所有 `'主公'` 替换为该常量;`create-engine.ts` 的 bootstrap dispatch 消息也用同一字面量。客户端不参与(`ownerId` 由 WS handler 注入绑定玩家名,不会等于 `'系统'`)。不改任何类型签名,不改 `dispatch` 行为。

**Tech Stack:** TypeScript、Vitest、pnpm

---

## File Structure

**Modify:**
- `src/engine/skills/开局.ts` —— 顶部加 `SYSTEM_OWNER` 常量,替换 3 处字面量
- `src/engine/create-engine.ts` —— bootstrap 内的 dispatch message 替换 1 处字面量

**Create:**
- `tests/integration/system-owner-id.test.ts` —— TDD 测试,断言 entry 注册到 `ownerId: '系统'` 而非 `'主公'`

**No-op(显式声明)**:
- `src/engine/skill.ts` —— 不动(注册表按 `string` 处理,`'系统'` 是普通 string)
- `src/engine/types.ts` —— 不动(签名不变)
- 任何玩家 skill 文件 —— 不动

---

## Task 1: 写失败测试 — 开局 entry 注册到 `'系统'`

**Files:**
- Create: `tests/integration/system-owner-id.test.ts`

- [ ] **Step 1: 写测试文件**

参考 `tests/integration/create-game.test.ts` 的 import / 模式(用 vitest 的 `describe`/`it`/`expect`、手动 `resetForTest`、GameConfig 内联)。

```ts
// tests/integration/system-owner-id.test.ts
// 验证开局 skill 注册到保留字 ownerId '系统',而非旧占位 '主公'
import { describe, it, expect } from 'vitest';
import { create, bootstrap, resetForTest } from '../../src/engine/create-engine';
import type { GameConfig } from '../../src/engine/create-engine';
import { findActionEntry } from '../../src/engine/skill';

describe('system ownerId 约定', () => {
  it('开局 skill 应注册到 ownerId "系统"', async () => {
    resetForTest();
    const config: GameConfig = {
      characters: [
        { name: '刘备', skills: ['仁德'] },
        { name: '曹操', skills: ['护甲'] },
        { name: '孙权', skills: ['制衡'] },
      ],
      playerCount: 3,
      seed: 42,
      gameId: 'test-system-owner',
    };
    const state = create(config);
    await bootstrap(state);
    const entry = findActionEntry('开局', '系统', 'start');
    expect(entry).toBeDefined();
  });

  it('旧占位 ownerId "主公" 不应再被使用', async () => {
    resetForTest();
    const config: GameConfig = {
      characters: [
        { name: '刘备', skills: ['仁德'] },
        { name: '曹操', skills: ['护甲'] },
        { name: '孙权', skills: ['制衡'] },
      ],
      playerCount: 3,
      seed: 42,
      gameId: 'test-system-owner-old',
    };
    const state = create(config);
    await bootstrap(state);
    const oldEntry = findActionEntry('开局', '主公', 'start');
    expect(oldEntry).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认两个都失败(RED)**

Run: `pnpm test -- tests/integration/system-owner-id.test.ts`
Expected:
- Test 1 FAIL: `expected undefined to be defined`(因为还没改,entry 注册在 `'主公'`)
- Test 2 FAIL: `expected { skillId: '开局', ownerId: '主公', ... } to be undefined`(旧 entry 还在)

如果两个测试都 FAIL,说明测试有效。**如果测试 PASS,停下来检查——很可能实现已经对了。**

- [ ] **Step 3: 提交失败测试**

```bash
git add tests/integration/system-owner-id.test.ts
git commit -m "test(engine): system ownerId 约定失败测试 (TDD red)"
```

---

## Task 2: 改 `src/engine/skills/开局.ts` — 替换 3 处字面量为 `SYSTEM_OWNER`

**Files:**
- Modify: `src/engine/skills/开局.ts`

- [ ] **Step 1: 文件顶部加 `SYSTEM_OWNER` 常量**

在 `import` 块之后、`createSkill` 函数之前加:

```ts
/**
 * system 命名空间占位 ownerId。
 * 客户端永远不发这个值(WS handler 注入的 ownerId 是绑定玩家名),
 * engine 内部 dispatch 只在 bootstrap 路径用到它。
 */
const SYSTEM_OWNER = '系统';
```

- [ ] **Step 2: 替换 `'主公'` 字面量为 `SYSTEM_OWNER`**

`src/engine/skills/开局.ts` 内有 2 处 `'主公'`(均在 `onInit` 内部):

| 上下文(行号以当前文件为准) | 旧 | 新 |
|---|---|---|
| `const entry: ActionEntry = { ..., ownerId: '主公', ... };` | `'主公'` | `SYSTEM_OWNER` |
| `return () => unregisterActionEntry('开局', '主公', 'start');` | `'主公'` | `SYSTEM_OWNER` |

把这两处全部替换为 `SYSTEM_OWNER` 常量引用。

`src/engine/create-engine.ts` 的 2 处 `'主公'`(在 `bootstrap()` 里)留到 Task 3 处理。

- [ ] **Step 3: 跑 system-owner-id 测试 —— 仍应两个都 FAIL**

Run: `pnpm test -- tests/integration/system-owner-id.test.ts`
Expected:
- Test 1 仍 FAIL — bootstrap 还在用 `'主公'`,新 entry 没注册到 `'系统'`
- Test 2 仍 FAIL — 旧 `'主公'` entry 仍存在

这步只验证 Task 2 的改动是局部的(没误改 bootstrap);两个测试都变绿要等 Task 3。

- [ ] **Step 4: 提交开局技能字面量替换**

```bash
git add src/engine/skills/开局.ts
git commit -m "refactor(engine): 开局 skill 用 SYSTEM_OWNER 常量替代 '主公' 字面量"
```

---

## Task 3: 改 `src/engine/create-engine.ts` — bootstrap dispatch 改用 `'系统'`

**Files:**
- Modify: `src/engine/create-engine.ts:165, 174`(具体行号以当前文件为准)

- [ ] **Step 1: 定位两处 `'主公'`**

在 `bootstrap()` 函数体内找两处 `'主公'`:
- `const syntheticSkill = 开局mod.default.createSkill('开局', '主公');`
- `ownerId: '主公',`(在 dispatch message 字面量内)

- [ ] **Step 2: 替换两处为 `'系统'`**

| 位置 | 旧 | 新 |
|---|---|---|
| `createSkill('开局', '主公')` 第二参 | `'主公'` | `'系统'` |
| `ownerId: '主公',` | `'主公'` | `'系统'` |

**注意**:这里直接用字面量 `'系统'`,**不**抽常量(此文件非 system skill 本体,只需要 bootstrap 一处用)。如要统一,可加模块顶部 `const SYSTEM_OWNER = '系统';` —— **建议**用模块顶部常量(与开局.ts 风格一致)。决定:**用模块顶部常量**,便于未来加 system skill 时复用:

在 `bootstrap()` 函数前(模块顶部 helpers 区域)加:

```ts
/**
 * system 命名空间占位 ownerId。客户端不会用此值(WS handler 注入真实玩家名),
 * engine 内部 dispatch 只在 system skill 触发路径(如 bootstrap)用到。
 */
const SYSTEM_OWNER = '系统';
```

然后两处替换为 `SYSTEM_OWNER`。

- [ ] **Step 3: 跑 system-owner-id 测试看两个都变绿**

Run: `pnpm test -- tests/integration/system-owner-id.test.ts`
Expected:
- Test 1 **PASS**(`findActionEntry('开局', '系统', 'start')` 找到 entry)
- Test 2 **PASS**(旧 `'主公'` entry 已被 `unregisterActionEntry('开局', SYSTEM_OWNER, 'start')` 清理?—— 不,Task 2 的 onInit 清理函数是按 `SYSTEM_OWNER` 走的,bootstrap 后 onInit 已 register,那清理函数在 game over / reset 时按 `SYSTEM_OWNER` 走)

实际逻辑:bootstrap **不**触发 onInit 的 unregister(那是 game over 时调)。bootstrap 触发的是 onInit **注册**新 entry,旧 entry 是被替换式注册(同 key 覆盖)。

确认两测试 PASS,进入 Task 4。

- [ ] **Step 4: 提交 create-engine 改动**

```bash
git add src/engine/create-engine.ts
git commit -m "refactor(engine): bootstrap dispatch 改用 SYSTEM_OWNER 替代 '主公'"
```

---

## Task 4: 跑全部测试做回归验证

**Files:** none

- [ ] **Step 1: 跑全量测试**

Run: `pnpm test`
Expected: 全部通过(包括 `create-game.test.ts` / `restore-from-log.test.ts` / `engine.test.ts` / `persistence.test.ts` / `state.test.ts` / `e2e-regression.test.ts` / `tests/skill-tests/*` / `tests/integration/*`)

如果有任何测试 FAIL,停下检查——可能是:
- 旧测试硬编码了 `ownerId: '主公'`(应该没有,但要排查)
- 旧测试依赖 `findActionEntry('开局', '主公', 'start')`(grep 确认)

- [ ] **Step 2: 跑 typecheck**

Run: `pnpm typecheck`
Expected: 0 错误

- [ ] **Step 3: 跑 lint**

Run: `pnpm lint`
Expected: 0 错误(如果项目有 lint 配置)

---

## Task 5: 跑 grep 守卫验证设计合规

**Files:** none

- [ ] **Step 1: 验证 `'系统'` 字面量只在预期位置出现**

Run:
```bash
rg -n "ownerId: ['\"]系统['\"]" src/ --type ts
```

Expected output: 仅 1-2 行,全部在 `src/engine/create-engine.ts` 的 bootstrap 函数内。
- 如果 `src/engine/skills/开局.ts` 也出现(因为 `entry.ownerId = SYSTEM_OWNER` 是常量引用,grep 不会命中 `ownerId: '系统'` 字面量)—— 这是预期。
- **如果出现其他文件** —— 停下,有人误用 system ownerId,审查并修正。

- [ ] **Step 2: 验证 engine 区域不再有 `'主公'` 作为 ownerId**

Run:
```bash
rg -n "['\"]主公['\"]" src/engine/ --type ts | rg -v '_legacy' | rg -v '主公技'
```

Expected: 空输出(`'主公'` 在 engine 区域不应再出现;`_legacy/` 和描述中的"主公技"是预期残留)

- [ ] **Step 3: 验证开局技能文件本身的 `SYSTEM_OWNER` 引用正确**

Run:
```bash
rg -n "SYSTEM_OWNER" src/engine/skills/开局.ts
```

Expected: 4 行(1 处声明 + 3 处使用)

---

## Task 6: 最终提交并合并(无新文件改动)

**Files:** none

- [ ] **Step 1: 检查 git log 顺序**

```bash
git log --oneline -5
```

Expected: 应看到 3 个新提交:
1. `test(engine): system ownerId 约定失败测试 (TDD red)`
2. `refactor(engine): 开局 skill 用 SYSTEM_OWNER 常量替代 '主公' 字面量`
3. `refactor(engine): bootstrap dispatch 改用 SYSTEM_OWNER 替代 '主公'`

如有需要 squash,自行调整(本计划不强求)。

- [ ] **Step 2: 跑最后一次全量验证**

Run: `pnpm test && pnpm typecheck`
Expected: 全部通过

完工。
