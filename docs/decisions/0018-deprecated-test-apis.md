# ADR 0018: 废弃全局测试 API，迁移到 createEngine 闭包

## 状态

提议（2026-06-06）

## 背景

引擎重构（ADR 0013）后，`createEngine()` 返回带闭包的 `EngineInstance`：

- `engine.skillsMap`：独立的 `SkillDef` 表
- `engine.hooks`：独立的 `HookRegistry`（v3 atom 钩子）
- `engine.clearForTest()`：重置全局 skill registry + atom hooks 并重新注册 instance 技能

**问题**：测试中仍在使用旧的全局 API：

- `clearSkillRegistry()` —— 清空全局 v2 skill registry
- `clearAtomHooks()` —— 清空全局 v3 atom hooks
- `clearAtomRegistry()` —— 清空全局 atom 定义注册表
- `registerAtomHook()` —— 向全局 defaultRegistry 注册钩子
- `getDefaultHookRegistry()` —— 取全局 defaultRegistry

这些 API 的设计目标（"测试间互相隔离"）已被 `engine.clearForTest()` 更好实现。

## 决策

**废弃上述 5 个 API**，统一迁移到 `createEngine()` 闭包。

### API 变更映射

| 旧 API | 新 API | 备注 |
|---|---|---|
| `clearSkillRegistry()` | `engine.clearForTest()` | 自动重置 + 重新注册本 instance 技能 |
| `clearAtomHooks()` | `engine.clearForTest()` | 同上 |
| `clearAtomRegistry()` | （无需重置） | atom 定义静态不变，不需要清空 |
| `registerAtomHook(def)` | `engine.hooks.register(def)` | 闭包 registry，instance 独立 |
| `getDefaultHookRegistry()` | `engine.hooks` | 同样 instance 独立 |

### 迁移示例

#### 旧写法

```ts
import { createEngine } from '@engine/create-engine';
import { clearSkillRegistry, clearAtomHooks, registerAtomHook } from '@engine/skill';
import { allSkills } from '@engine/skills';
import { registerAllAtoms } from '@engine/atoms';

beforeEach(() => {
  clearSkillRegistry();
  clearAtomHooks();
  registerAllAtoms();
  for (const skill of allSkills) skill.registerHooks?.(getDefaultHookRegistry());
});

it('...', () => {
  // 直接调全局函数
  registerAtomHook(myHook);
  const engine = createEngine({ skills: allSkills });
  // ...
});
```

#### 新写法

```ts
import { createTestEngine } from 'tests/engine-helpers';

beforeEach(() => {
  // createTestEngine() 内部已自动注册 allSkills + allAtoms
});

it('...', () => {
  const engine = createTestEngine();
  // engine.hooks 是闭包 HookRegistry，instance 独立
  engine.hooks.register(myHook);
  // 不需要手动清场——每个 test 自动得到全新 engine
});
```

### 销毁顺序

JS 单线程下，`createEngine` 的 try/finally 保证 dispatch 期间 `currentEngineHooks` 被正确设置，dispatch 结束自动清空（见 ADR 0013 P2-1）。

## 实施

### 阶段 1：标记 deprecated（2026-06-06 完成）

- `skill.ts`：`clearSkillRegistry()` 加 `@deprecated` JSDoc
- `atom.ts`：`clearAtomRegistry()` 加 `@deprecated` JSDoc
- `skill-hook.ts`：`registerAtomHook()`、`clearAtomHooks()`、`getDefaultHookRegistry()` 加 `@deprecated` JSDoc

### 阶段 2：测试迁移（渐进式，~30 个文件）

按顺序迁移：

1. `tests/integration/` 集成测试
2. `tests/atoms/` 原子层测试
3. `tests/unit/` 单元测试
4. `tests/fixtures/` 测试 fixture

每个测试文件迁移步骤：

1. 移除 `import { clearXxx, registerXxx } from '@engine/...';`
2. 添加 `import { createTestEngine } from '../engine-helpers';`
3. 把 `beforeEach(() => clearXxx())` 改为 `beforeEach(() => { engine = createTestEngine(); })`
4. 把全局 `registerAtomHook(def)` 改为 `engine.hooks.register(def)`

### 阶段 3：删除（半年后）

- 删除所有 `@deprecated` 函数
- 同步删除 `tests/engine-helpers.ts` 中的 `@deprecated` re-export

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 阶段 2 大量测试迁移出错 | 分批迁移 + 每次 `pnpm test` 验证；分 4 个 PR |
| `@deprecated` JSDoc 触发 IDE 警告噪声 | ESLint 规则配置 `no-warning-comments` 允许 deprecated |
| 某些测试依赖全局 state 顺序（如 fixture chain） | 在 fixture 层用 `beforeAll` 一次性创建 engine，避免 per-test 清理 |

## 替代方案

### A. 保留全局 API，新增 `engine.clearForTest()`

优点：不破坏现有测试，向后兼容
缺点：API 表面膨胀，新旧并存易混淆，长期维护成本高

### B. 引入依赖注入（`@inject(EngineInstance)`）

优点：彻底解耦
缺点：改动面太大（每个测试都要 DI），与现有 fixture 模式不匹配

**选 C（当前）**：废弃 + 渐进迁移。

## 验证

- `tests/integration/engine-isolation.test.ts` 已验证 `createEngine` 多实例隔离
- 全量测试：1412 passed / 40 skipped（无回归）
- 迁移指南示例代码可复制粘贴运行

## 总结

- **2 个核心文件改动**（`atom.ts` + `create-engine.ts`）实现多实例隔离
- **76 个 handler 调用点零修改**
- **5 个旧 API 标记 deprecated**，等测试渐进迁移
- **新增 4 个隔离测试**（`tests/integration/engine-isolation.test.ts`）
