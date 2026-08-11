# 引擎目录重组与深度重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `src/engine/` 从 40+ 平铺条目重组为 12 个职责清晰的目录，拆解 990 行的 `index.ts` 巨型文件，并消除全部单复数歧义。

**Architecture:** 按机制内核 (core/)、游戏规则 (rules/)、流程编排 (flows/)、工具 (util/)、静态数据 (data/) 五层重组。拆解 `index.ts` 为 `core/apply.ts`(atom 管线)、`core/frame.ts`(帧管理)、`core/notify.ts`(通知)、`core/timeout.ts`(超时计算)、`core/index.ts`(门面 API)。所有消费者从 `'../index'` 改为具名导入 (`'../core/apply'` 等)，彻底打破循环依赖枢纽。

**Tech Stack:** TypeScript, Vitest (~3300 测试), ESLint, Vite

**Spec:** `docs/superpowers/specs/2026-08-08-engine-restructure-design.md`

---

## 关键约定

### 文件迁移工具

- **单文件迁移**：优先用 `lsp rename_file`（symbol-aware，自动迁移全项目 import）。写 JSON 到 `xd://lsp`：
  ```json
  { "action": "rename_file", "file": "src/engine/rng.ts", "new_name": "src/engine/util/rng.ts", "apply": true }
  ```
- **目录迁移**（cards/ → data/，card-effect/ → core/card-effect/）：先 `git mv` 移动目录，再用 `sd` 批量替换 import 路径。
- **`sd` 模式**：`sd 'old_pattern' 'new_pattern' <files>`。捕获组用 `$1`。glob 用 `src/engine/**/*.ts src/client/**/*.ts src/server/**/*.ts src/ai-mcp/**/*.ts`（覆盖所有消费者）。

### 测试验证

每个 Task 结束前运行全量测试：
```bash
npm test
```
预期：~3300 测试全部通过。如出现失败，说明有遗漏的 import 路径。

### 预检命令（每个 Task 开始前运行）

确认目标目录不存在：
```bash
ls src/engine/<目标目录>/ 2>/dev/null && echo "EXISTS" || echo "OK to create"
```

### 提交规范

每个 Task 一个提交，message 格式：`refactor(engine): <描述>`

---

## Task 1: 创建 util/ 并迁入 4 个工具文件

**Files:**
- Move: `src/engine/rng.ts` → `src/engine/util/rng.ts`
- Move: `src/engine/log.ts` → `src/engine/util/log.ts`
- Move: `src/engine/invariants.ts` → `src/engine/util/invariants.ts`
- Move: `src/engine/typeGuards.ts` → `src/engine/util/typeGuards.ts`
- Modify: 所有 import 了上述文件的位置（`lsp rename_file` 自动处理）

### 职责说明

这 4 个文件是无领域依赖的纯工具函数：
- `rng.ts`：确定性随机数生成器
- `log.ts`：actionLog 格式化
- `invariants.ts`：卡牌不变量断言（被 `index.ts` 的 `applyAtom` 调用）
- `typeGuards.ts`：JSON/Record 类型守卫

### Steps

- [ ] **Step 1: 创建 util/ 目录**

```bash
mkdir -p src/engine/util
```

- [ ] **Step 2: 用 lsp rename_file 逐个迁移（自动更新所有 import）**

对每个文件执行 rename_file。写 JSON 到 `xd://lsp`：

```json
{ "action": "rename_file", "file": "src/engine/rng.ts", "new_name": "src/engine/util/rng.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/log.ts", "new_name": "src/engine/util/log.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/invariants.ts", "new_name": "src/engine/util/invariants.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/typeGuards.ts", "new_name": "src/engine/util/typeGuards.ts", "apply": true }
```

每个 rename_file 自动更新全项目所有 import 路径（`./rng` → `./util/rng`、`../rng` → `../util/rng` 等）。

- [ ] **Step 3: 验证类型检查**

```bash
npm run typecheck
```
预期：无错误。

- [ ] **Step 4: 运行全量测试**

```bash
npm test
```
预期：~3300 测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "refactor(engine): 迁入 util/ (rng/log/invariants/typeGuards)"
```

---

## Task 2: 创建 data/ 并迁入静态数据 + 元数据文件

**Files:**
- Move: `src/engine/cards/` → `src/engine/data/`（整目录改名：characters/ + card-defs/）
- Move: `src/engine/card-meta.ts` → `src/engine/data/card-meta.ts`
- Move: `src/engine/character-meta.ts` → `src/engine/data/character-meta.ts`
- Move: `src/engine/characters.ts` → `src/engine/data/characters.ts`
- Modify: 所有 import 了上述路径的文件（~20 个文件，含 src/client/ 外部消费者）

### 职责说明

- `cards/`（改名 `data/`）：静态数据 —— `characters/`（武将定义，~145 个文件）+ `card-defs/`（卡牌定义：basic/equipment/tricks/description）
- `card-meta.ts`：卡牌元数据查询（isEquipment/isDelayedTrick 等），依赖 `data/card-defs` + `skills`
- `character-meta.ts`：武将元数据查询（getCharacterMeta/LORD_CANDIDATES），依赖 `data/characters`
- `characters.ts`：角色 re-export（从 `data/characters/index` 转出）

### Steps

- [ ] **Step 1: 目录改名**

```bash
git mv src/engine/cards src/engine/data
```

- [ ] **Step 2: 用 lsp rename_file 迁入 3 个 meta 文件**

```json
{ "action": "rename_file", "file": "src/engine/card-meta.ts", "new_name": "src/engine/data/card-meta.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/character-meta.ts", "new_name": "src/engine/data/character-meta.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/characters.ts", "new_name": "src/engine/data/characters.ts", "apply": true }
```

- [ ] **Step 3: 检查目录改名后的残留 import**

`git mv cards → data` 不自动更新 import。检查所有引用旧 `cards/` 路径的文件：

```bash
# 用 grep 搜索（注意：系统禁止用 shell grep，用内置 grep 工具）
# 搜索模式：from '...cards/'
```

用内置 `grep` 工具搜索 `from ['"].*engine/cards/` 在 `src/` 下。预期命中：
- `src/engine/character-meta.ts`（已移走，但可能有缓存）
- `src/client/assets/imageAssets.ts`
- `src/engine/atoms/当作.ts`
- `src/engine/card-meta.ts`（已移走）
- `src/engine/data/characters.ts`（已移走的 characters.ts，内部 import 路径）
- `src/engine/data/character-meta.ts`（已移走）
- 其他可能引用

- [ ] **Step 4: 批量修复 cards/ → data/ 的 import 路径**

对每个命中的文件，把 `cards/` 替换为 `data/`。用 `sd`：

```bash
sd "cards/characters" "data/characters" src/engine/**/*.ts src/client/**/*.ts src/ai-mcp/**/*.ts
sd "cards/card-defs" "data/card-defs" src/engine/**/*.ts src/client/**/*.ts src/ai-mcp/**/*.ts
```

同时修复已迁移文件内部的 `./cards/` 相对路径（如 `data/character-meta.ts` 原来写 `./cards/characters`，现在应改为 `./characters`）：

```bash
sd "from '\\./cards/" "from './" src/engine/data/*.ts
```

- [ ] **Step 5: 验证类型检查**

```bash
npm run typecheck
```
预期：无错误。如有错误，根据报错信息修复遗漏的 import。

- [ ] **Step 6: 运行全量测试**

```bash
npm test
```
预期：全部通过。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "refactor(engine): cards/→data/ 改名 + 迁入 meta 文件"
```

---

## Task 3: 创建 rules/ 并迁入 9 个规则模块

**Files:**
- Move: `src/engine/distance.ts` → `src/engine/rules/distance.ts`
- Move: `src/engine/viewDistance.ts` → `src/engine/rules/viewDistance.ts`
- Move: `src/engine/hand-limit.ts` → `src/engine/rules/hand-limit.ts`
- Move: `src/engine/slash-quota.ts` → `src/engine/rules/slash-quota.ts`
- Move: `src/engine/slash-target.ts` → `src/engine/rules/slash-target.ts`
- Move: `src/engine/trick-quota.ts` → `src/engine/rules/trick-quota.ts`
- Move: `src/engine/once-per-turn.ts` → `src/engine/rules/once-per-turn.ts`
- Move: `src/engine/skip-phase.ts` → `src/engine/rules/skip-phase.ts`
- Move: `src/engine/action-active.ts` → `src/engine/rules/action-active.ts`
- Modify: 所有 import 了上述文件的消费者

### 职责说明

纯谓词/约束计算模块，不含 atom 编排：
- `distance.ts` / `viewDistance.ts`：攻击距离/可见距离计算
- `hand-limit.ts`：手牌上限
- `slash-quota.ts`：出杀次数配额（三层模型：额定+额外+无限）
- `slash-target.ts`：杀目标数量上限
- `trick-quota.ts`：锦囊封锁（被抵消追踪）
- `once-per-turn.ts`：每回合一次标记
- `skip-phase.ts`：跳过阶段 tag 管理
- `action-active.ts`：action 激活条件谓词（view 级，供技能 onMount 复用）

### Steps

- [ ] **Step 1: 创建 rules/ 目录**

```bash
mkdir -p src/engine/rules
```

- [ ] **Step 2: 用 lsp rename_file 逐个迁移**

对 9 个文件各执行一次：

```json
{ "action": "rename_file", "file": "src/engine/distance.ts", "new_name": "src/engine/rules/distance.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/viewDistance.ts", "new_name": "src/engine/rules/viewDistance.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/hand-limit.ts", "new_name": "src/engine/rules/hand-limit.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/slash-quota.ts", "new_name": "src/engine/rules/slash-quota.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/slash-target.ts", "new_name": "src/engine/rules/slash-target.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/trick-quota.ts", "new_name": "src/engine/rules/trick-quota.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/once-per-turn.ts", "new_name": "src/engine/rules/once-per-turn.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/skip-phase.ts", "new_name": "src/engine/rules/skip-phase.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/action-active.ts", "new_name": "src/engine/rules/action-active.ts", "apply": true }
```

- [ ] **Step 3: 验证类型检查**

```bash
npm run typecheck
```
预期：无错误。

- [ ] **Step 4: 运行全量测试**

```bash
npm test
```
预期：全部通过。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "refactor(engine): 迁入 rules/ (distance/slash-quota/hand-limit 等 9 个规则模块)"
```

---

## Task 4: 创建 flows/ 并迁入 11 个流程编排模块

**Files:**
- Move: `src/engine/damage-flow.ts` → `src/engine/flows/damage.ts`
- Move: `src/engine/judge-flow.ts` → `src/engine/flows/judge.ts`
- Move: `src/engine/life-flow.ts` → `src/engine/flows/life.ts`
- Move: `src/engine/death-flow.ts` → `src/engine/flows/death.ts`
- Move: `src/engine/move-flow.ts` → `src/engine/flows/move.ts`
- Move: `src/engine/rank-flow.ts` → `src/engine/flows/rank.ts`
- Move: `src/engine/turn-flow.ts` → `src/engine/flows/turn.ts`
- Move: `src/engine/recast.ts` → `src/engine/flows/recast.ts`
- Move: `src/engine/pick-card-panel.ts` → `src/engine/flows/pick-card-panel.ts`
- Move: `src/engine/face-down.ts` → `src/engine/flows/face-down.ts`
- Move: `src/engine/无懈可击.ts` → `src/engine/flows/cancel.ts`（消除与具体牌同名歧义）
- Modify: 所有 import 了上述文件的消费者

### 职责说明

调用 `applyAtom` 的编排函数 + 注册 hook 的行为模块：
- `*-flow.ts`（去 `-flow` 后缀，目录名已表达"流程"）：伤害/判定/体力/死亡/移动/拼点/回合 7 个流程编排
- `recast.ts`：重铸通用 helper（弃牌+摸牌）
- `pick-card-panel.ts`：选牌面板公共逻辑（过河拆桥/顺手牵羊/反馈共用）
- `face-down.ts`：扣置/翻面/横置/跳过回合编排 + 连环传导全局 hook 注册
- `无懈可击.ts` → `cancel.ts`：通用抵消询问 helper（闪/无懈可击统一机制），**非**具体那张牌

### Steps

- [ ] **Step 1: 创建 flows/ 目录**

```bash
mkdir -p src/engine/flows
```

- [ ] **Step 2: 用 lsp rename_file 迁入（文件名改变的需手动修正导出名）**

`*-flow.ts` 文件去后缀——rename_file 同时改路径和文件名：

```json
{ "action": "rename_file", "file": "src/engine/damage-flow.ts", "new_name": "src/engine/flows/damage.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/judge-flow.ts", "new_name": "src/engine/flows/judge.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/life-flow.ts", "new_name": "src/engine/flows/life.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/death-flow.ts", "new_name": "src/engine/flows/death.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/move-flow.ts", "new_name": "src/engine/flows/move.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/rank-flow.ts", "new_name": "src/engine/flows/rank.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/turn-flow.ts", "new_name": "src/engine/flows/turn.ts", "apply": true }
```

文件名不变的：

```json
{ "action": "rename_file", "file": "src/engine/recast.ts", "new_name": "src/engine/flows/recast.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/pick-card-panel.ts", "new_name": "src/engine/flows/pick-card-panel.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/face-down.ts", "new_name": "src/engine/flows/face-down.ts", "apply": true }
```

特殊：`无懈可击.ts` → `cancel.ts`（rename_file 会更新 import 路径，但不会改导出函数名如 `promptCancel`）：

```json
{ "action": "rename_file", "file": "src/engine/无懈可击.ts", "new_name": "src/engine/flows/cancel.ts", "apply": true }
```

- [ ] **Step 3: 验证类型检查**

```bash
npm run typecheck
```
预期：无错误。

- [ ] **Step 4: 运行全量测试**

```bash
npm test
```
预期：全部通过。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "refactor(engine): 迁入 flows/ (damage/judge/life 等 + cancel 改名)"
```

---

## Task 5: 创建 core/ 并迁入框架文件

**Files:**
- Move: `src/engine/atom.ts` → `src/engine/core/atom.ts`
- Move: `src/engine/skill.ts` → `src/engine/core/skill.ts`
- Move: `src/engine/card-effect/` → `src/engine/core/card-effect/`（整目录）
- Move: `src/engine/skill-view-meta.ts` → `src/engine/core/skill-view-meta.ts`
- Move: `src/engine/skill-loader.ts` → `src/engine/core/skill-loader.ts`
- Move: `src/engine/card-response-availability.ts` → `src/engine/core/card-response-availability.ts`
- Move: `src/engine/deck.ts` → `src/engine/core/deck.ts`
- Move: `src/engine/skill-suppression.ts` → `src/engine/core/skill-suppression.ts`
- Modify: `src/engine/index.ts`（更新内部 import 路径）
- Modify: 所有 import 了上述文件的消费者（~280 个文件，含 src/client/ 外部消费者）

### 职责说明

机制内核 —— 注册表、管线框架、扩展点：
- `atom.ts`：atom 注册表 + 同步基础 apply
- `skill.ts`：action/hook 实例注册（state-bound WeakMap）
- `card-effect/`：卡牌效果框架（registry/use-card/validate/play-card/delayed-trick-registry）
- `skill-view-meta.ts`：技能视图元数据静态注册表
- `skill-loader.ts`：技能实例管理
- `card-response-availability.ts`：卡牌回应可用性预检（skip/silent/normal）
- `deck.ts`：标准牌堆生成（依赖 data/card-defs + skills）
- `skill-suppression.ts`：非锁定技失效扩展点（义绝/界铁骑/界完杀 注册 predicate）

### Steps

- [ ] **Step 1: 创建 core/ 目录**

```bash
mkdir -p src/engine/core
```

- [ ] **Step 2: 用 lsp rename_file 迁入单文件**

对 6 个单文件各执行一次 rename_file：

```json
{ "action": "rename_file", "file": "src/engine/atom.ts", "new_name": "src/engine/core/atom.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/skill.ts", "new_name": "src/engine/core/skill.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/skill-view-meta.ts", "new_name": "src/engine/core/skill-view-meta.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/skill-loader.ts", "new_name": "src/engine/core/skill-loader.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/card-response-availability.ts", "new_name": "src/engine/core/card-response-availability.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/deck.ts", "new_name": "src/engine/core/deck.ts", "apply": true }
```

```json
{ "action": "rename_file", "file": "src/engine/skill-suppression.ts", "new_name": "src/engine/core/skill-suppression.ts", "apply": true }
```

- [ ] **Step 3: 整目录迁移 card-effect/ → core/card-effect/**

```bash
git mv src/engine/card-effect src/engine/core/card-effect
```

`git mv` 不更新 import。批量修复所有引用 `card-effect/`（不含 `card-effects/`）的路径：

```bash
sd "from '(\\.\\./+)card-effect/" "from '$1core/card-effect/" src/engine/**/*.ts src/client/**/*.ts src/server/**/*.ts src/ai-mcp/**/*.ts
```

注意：此模式只匹配 `card-effect/`（单数，框架目录），不匹配 `card-effects/`（复数，内容目录），因为 `card-effects/` 的路径中 `card-effects` 后面跟 `/` 但前面有 `s`。`sd` 的正则会精确匹配 `card-effect/`（单数）。

但需验证——用内置 grep 工具搜索 `from ['"].*\bcard-effect/` 确认没有误匹配 `card-effects/`。如果有误匹配，手动修复。

- [ ] **Step 4: 验证类型检查**

```bash
npm run typecheck
```
预期：无错误。如有错误，根据报错修复遗漏的路径。

- [ ] **Step 5: 运行全量测试**

```bash
npm test
```
预期：全部通过。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "refactor(engine): 迁入 core/ 框架文件 (atom/skill/card-effect/deck 等)"
```

---

## Task 6: 拆解 index.ts —— 提取 core/apply.ts、core/frame.ts、core/notify.ts、core/timeout.ts

**Files:**
- Create: `src/engine/core/timeout.ts`
- Create: `src/engine/core/notify.ts`
- Create: `src/engine/core/apply.ts`
- Create: `src/engine/core/frame.ts`
- Create: `src/engine/core/index.ts`（门面 API + 剩余逻辑）
- Modify: `src/engine/index.ts`（降级为门面 re-export）
- Modify: `src/engine/atoms/index.ts`（副作用 import 路径）
- Modify: `src/client/engine-imports.ts`（副作用 import 路径）

### 这是最高风险的 Task。拆解 990 行 index.ts 为 5 个模块。

### 拆解方案（基于 index.ts 内部依赖分析）

```
core/timeout.ts   ← resolveTimeoutMs（无依赖）
core/notify.ts    ← pushNotify + notifyStateChange + notifyPendingResolved + extractPendingTarget + logAction（共享 helper）
core/apply.ts     ← applyAtom + runJudgeModifiers + runAfterHooks + sortHooksCounterclockwise + createAndAwaitSlot + SYSTEM_OWNER（管线核心）
core/frame.ts     ← pushFrame + popFrame + topFrame + frameCards + emptyFrame（帧管理）
core/index.ts     ← create + bootstrap + dispatch + restore + buildView + fireTimeout + checkGameOver + registerSkillsFromState + restore 辅助函数（门面 API）
```

依赖方向（DAG + 一个安全的 ESM live-binding 循环）：
```
timeout.ts (standalone)
    ↑
notify.ts (imports types only)
    ↑
apply.ts ←── atom.ts (getAtomDef/resolveViewEvents)
    ↑          skill.ts (getBeforeHooks/getAfterHooks/getJudgeModifierMap)
    │          skill-suppression.ts (isHookSuppressed)
    │          util/invariants.ts (assertCardInvariants)
    │          notify.ts (pushNotify/notifyStateChange/notifyPendingResolved/extractPendingTarget)
    │          timeout.ts (resolveTimeoutMs)
    │          frame.ts (topFrame/emptyFrame) ← ESM 循环，运行时安全
    ↑
frame.ts ←── apply.ts (applyAtom，仅 pushFrame/popFrame 函数体内使用)
    ↑
core/index.ts ← apply.ts + frame.ts + timeout.ts + notify.ts + core/deck.ts + view/buildView.ts + core/skill.ts + ...
```

apply.ts ↔ frame.ts 循环说明：apply.ts 导入 `topFrame`/`emptyFrame`（纯函数），frame.ts 导入 `applyAtom`（仅 `pushFrame`/`popFrame` 函数体内调用）。ESM live binding 在函数调用时解析，模块加载时无副作用使用，循环安全。

### Steps

- [ ] **Step 1: 创建 core/timeout.ts**

从 `index.ts` 提取 `resolveTimeoutMs` 函数（第 89-103 行）。

```ts
// src/engine/core/timeout.ts
/** 计算应用了房间配置后的 pending 超时毫秒数。
 *  scale=Infinity(无限)时返回 24 小时(有效无限),定时器实际不会触发。
 *  slot 创建(createAndAwaitSlot)与 view deadline(applyView/toViewEvents)共用此函数,
 *  保证后端真实定时器与前端倒计时口径一致。 */
import type { GameState } from '../types';

export function resolveTimeoutMs(state: GameState, baseSeconds: number, isBroadcast = false): number {
  const scale = state.config?.timeoutSec ?? 1;
  const MAX_TIMEOUT_MS = 86_400_000;
  if (!Number.isFinite(scale)) {
    if (isBroadcast) return baseSeconds * 1000;
    return MAX_TIMEOUT_MS;
  }
  const sec = baseSeconds * scale;
  return Math.min(sec * 1000, MAX_TIMEOUT_MS);
}
```

- [ ] **Step 2: 创建 core/notify.ts**

从 `index.ts` 提取通知/状态变更 helper（第 96-153 行附近：`extractPendingTarget`、`notifyStateChange`、`notifyPendingResolved`、`logAction`）+ `pushNotify`（第 663-672 行）。

```ts
// src/engine/core/notify.ts
// 通知/状态变更 helper —— 被 apply.ts(applyAtom 管线) 和 core/index.ts(dispatch) 共用。
import type { ClientMessage, GameState, Json, NotifyEvent, PendingSlot, Atom } from '../types';
import { TARGET_SYSTEM } from '../types';

/** system 命名空间占位座次。 */
const SYSTEM_OWNER = TARGET_SYSTEM;

/** 从 pending atom 中提取等待目标玩家(座次下标)。 */
export function extractPendingTarget(atom: Atom): number {
  if ('target' in atom && typeof atom.target === 'number') return atom.target;
  if ('player' in atom && typeof atom.player === 'number') return atom.player;
  return SYSTEM_OWNER;
}

/** 通知 session:state 已变更(每次 applyAtom 结束后触发)。 */
export function notifyStateChange(state: GameState): void {
  if (state.viewBuffering) return;
  state.onStateChange?.();
}

/** 通知前端:某 pending slot 已 resolve。 */
export function notifyPendingResolved(state: GameState, slot: PendingSlot): void {
  const target = extractPendingTarget(slot.atom);
  state.seq += 1;
  state.atomHistory.push({
    kind: 'notify',
    seq: state.seq,
    timestamp: Date.now() - state.startedAt,
    skillId: '',
    eventType: 'pendingResolved',
    data: { target, atomType: slot.atom.type },
  });
  notifyStateChange(state);
}

/** 推送 notify 事件(不改变 state) */
export function pushNotify(state: GameState, event: NotifyEvent): void {
  state.seq += 1;
  state.atomHistory.push({
    kind: 'notify',
    seq: state.seq,
    timestamp: Date.now() - state.startedAt,
    ...event,
  });
}

/** 记录 actionLog 条目 */
export function logAction(state: GameState, message: ClientMessage): void {
  state.actionLog.push({
    id: String(state.actionLog.length),
    timestamp: Date.now() - state.startedAt,
    message,
    baseSeq: message.baseSeq ?? -1,
  });
}
```

- [ ] **Step 3: 创建 core/frame.ts**

从 `index.ts` 提取帧管理函数（第 624-656 行）+ `emptyFrame`（第 654-656 行）。

```ts
// src/engine/core/frame.ts
// 结算帧管理 —— pushFrame/popFrame 走 applyAtom 管线保证 view 同步。
import type { GameState, Json, SettlementFrame } from '../types';
import { TARGET_SYSTEM } from '../types';

// apply.ts ↔ frame.ts ESM 循环：pushFrame/popFrame 在函数体内调用 applyAtom，
// applyAtom 在函数体内调用 topFrame/emptyFrame。运行时安全。
import { applyAtom } from './apply';

/** 兜底空帧 */
export function emptyFrame(): SettlementFrame {
  return { skillId: '', from: TARGET_SYSTEM, params: Object.freeze({}), cards: [], cancelled: false };
}

/** 创建帧并压入 state.settlementStack,返回帧引用。 */
export async function pushFrame(
  state: GameState,
  skillId: string,
  from: number,
  params?: Record<string, Json>,
): Promise<SettlementFrame> {
  await applyAtom(state, { type: '结算帧入栈', skillId, from, params });
  return state.settlementStack[state.settlementStack.length - 1];
}

/** 弹出栈顶帧。 */
export async function popFrame(state: GameState): Promise<void> {
  await applyAtom(state, { type: '结算帧出栈' });
}

/** 取栈顶帧(只读引用) */
export function topFrame(state: GameState): SettlementFrame | undefined {
  return state.settlementStack[state.settlementStack.length - 1];
}

/** 取栈顶帧的牌区。 */
export function frameCards(state: GameState): string[] {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  return frame ? frame.cards : state.zones.processing;
}
```

- [ ] **Step 4: 创建 core/apply.ts**

从 `index.ts` 提取 atom apply 管线（第 760-990 行：`applyAtom`、`runJudgeModifiers`、`runAfterHooks`、`sortHooksCounterclockwise`、`createAndAwaitSlot`）。这些是 index.ts 中耦合最紧的代码块，必须一起迁移。

**关键：** 不要手写全部代码——从 `index.ts` 原文复制。以下是该文件的 import 和 export 结构：

```ts
// src/engine/core/apply.ts
// atom apply 管线 —— before hooks → validate → apply → emit event → after hooks → pending。
// 这是循环依赖枢纽的替代品：消费者直接 import applyAtom 而非通过 index.ts。
import type {
  Atom,
  AtomAfterContext,
  AtomBeforeContext,
  AtomDefinition,
  GameState,
} from '../types';
import { getAtomDef, resolveViewEvents, applyAtom as applyAtomImpl } from './atom';
import {
  getBeforeHooks,
  getAfterHooks,
  getJudgeModifierMap,
} from './skill';
import { isHookSuppressed } from './skill-suppression';
import { assertCardInvariants } from '../util/invariants';
import { resolveTimeoutMs } from './timeout';
import {
  pushNotify,
  notifyStateChange,
  notifyPendingResolved,
  extractPendingTarget,
} from './notify';
import { topFrame, emptyFrame } from './frame';
import type { PendingSlot } from '../types';
```

然后从 `index.ts` 原样复制以下函数到 `core/apply.ts`（保留原注释）：
- `sortHooksCounterclockwise`（private，不 export）
- `runAfterHooks`（private，不 export）
- `runJudgeModifiers`（**export**）
- `applyAtom`（**export**）
- `createAndAwaitSlot`（private，不 export）

**注意：** 这些函数内部引用的 `topFrame`、`emptyFrame`、`pushNotify`、`notifyStateChange`、`notifyPendingResolved`、`extractPendingTarget` 现在从 `./frame` 和 `./notify` 导入，不再是同文件局部函数。`getAtomDef`/`resolveViewEvents`/`applyAtomImpl` 从 `./atom` 导入。`isHookSuppressed` 从 `./skill-suppression` 导入。`assertCardInvariants` 从 `../util/invariants` 导入。`resolveTimeoutMs` 从 `./timeout` 导入。

- [ ] **Step 5: 创建 core/index.ts（门面 API + 剩余逻辑）**

将 `index.ts` 中**剩余的内容**移入 `core/index.ts`。这包括：

**保留在 core/index.ts 的公开 API：**
- `GameConfig` interface
- `checkGameOver`
- `create`
- `bootstrap`
- `restore`
- `registerSkillsFromState`
- `dispatch`
- `buildView`
- `fireTimeout`

**保留在 core/index.ts 的内部 helper（restore 专用）：**
- `settleSleep`
- `RESPONSIVE_ACTION_TYPES`
- `waitForResponsiveSlot`
- `waitForPendingOrDone`
- `waitForSeqStable`
- `drainUnresolvedBlockingSlots`

**core/index.ts 的 import 列表：**

```ts
// src/engine/core/index.ts
// 引擎门面 API + 副作用注册。
// 消费者（session 层）通过顶层 engine/index.ts re-export 访问门面 API。
// 内部消费者（skills/atoms/card-effects）直接 import core/apply, core/frame 等。
import type {
  ActionEntry,
  ActionLogEntry,
  ClientMessage,
  GameState,
  GameView,
  Json,
} from '../types';
import { createGameState, TARGET_SYSTEM } from '../types';
import { buildView as buildViewImpl } from '../view/buildView';
import {
  findActionEntry,
  findPendingSlot,
  setSkillInstanceUnload,
  unloadSkillInstance,
} from './skill';
import { createStandardDeck } from './deck';
import { applyAtom } from './apply';
import {
  notifyStateChange,
  notifyPendingResolved,
  extractPendingTarget,
  logAction,
} from './notify';
import * as 系统规则mod from '../skills/系统规则';

// 副作用注册：必须 import 来注册所有 atom 定义
import '../atoms';
```

**注意 bootstrap/registerSkillsFromState 中的动态 import 路径更新：**
- `await import('./skills/开局')` → `await import('../skills/开局')`
- `await import('./card-effects/酒')` → `await import('../card-effects/酒')`
- `await import('./card-effect/use-card')` → `await import('./card-effect/use-card')`（card-effect 已在 core/ 下，路径不变）
- `await import('./face-down')` → `await import('../flows/face-down')`
- `await import('./skill')` → `await import('./skill')`（skill.ts 已在 core/ 下，路径不变）

- [ ] **Step 6: 降级顶层 index.ts 为门面 re-export**

替换 `src/engine/index.ts` 全部内容为：

```ts
// src/engine/index.ts
// 引擎对外唯一入口 —— 纯门面 re-export。
// session 层通过此文件访问引擎 API：import { create } from './engine'。
// 内部消费者不应从此文件 import —— 直接使用 core/ 子模块。
export {
  create,
  bootstrap,
  dispatch,
  restore,
  registerSkillsFromState,
  buildView,
  fireTimeout,
  checkGameOver,
} from './core';
export type { GameConfig } from './core';
```

- [ ] **Step 7: 更新 atoms/index.ts 的副作用 import（如果有）**

检查 `src/engine/atoms/index.ts` 是否 import 了 `../index` 中的任何符号。如果 atoms 目录中有文件 import `runJudgeModifiers` from `'../index'`，更新为 `from '../core/apply'`。

用内置 grep 工具搜索：`from ['"]\.\.?/(\.\./)?index['"]` 在 `src/engine/atoms/` 下。

预期命中：`atoms/judge-timing.ts` 中 `import { runJudgeModifiers } from '../index'` → 改为 `from '../core/apply'`。

- [ ] **Step 8: 更新 atoms/ 中所有从 ../index 导入 applyAtom/resolveTimeoutMs 的文件**

用 grep 搜索 `from ['"]\.\.?/index['"]` 在 `src/engine/atoms/` 下。对每个命中的文件：
- `import { applyAtom } from '../index'` → `from '../core/apply'`
- `import { resolveTimeoutMs } from '../index'` → `from '../core/timeout'`
- `import { applyAtom, resolveTimeoutMs } from '../index'` → 拆成两行分别导入

用 `sd` 批量处理：
```bash
sd "from '\\.\\./index'" "from '../core/apply'" src/engine/atoms/**/*.ts
```
然后手动检查是否有 `resolveTimeoutMs` 需要单独改为 `from '../core/timeout'`。

- [ ] **Step 9: 验证类型检查**

```bash
npm run typecheck
```
预期：无错误。此时消费者尚未迁移（它们仍 import from '../index'，但顶层 index.ts 已不再 export applyAtom 等）。

**重要：** 此步骤大概率会有大量类型错误，因为顶层 index.ts 不再导出 `applyAtom`/`pushFrame`/`frameCards`/`pushNotify`/`resolveTimeoutMs`/`runJudgeModifiers`。这些错误会在 Task 7 中修复。如果只有这类错误（"Module '"../index"' has no exported member 'applyAtom'"），则可继续到 Task 7。

- [ ] **Step 10: 暂不提交，继续 Task 7**

此 Task 与 Task 7 强耦合——index.ts 拆解导致消费者 import 断裂，必须与 Task 7 一起完成后才能通过测试。不要在此步骤提交。

---

## Task 7: 迁移所有消费者 import —— from '../index' → 具名 core/ 路径

**Files:**
- Modify: 所有 `from '../index'` 或 `from '../../engine/index'` 或 `from '../../engine'` 导入 applyAtom/pushFrame/frameCards/pushNotify/resolveTimeoutMs/runJudgeModifiers 的文件
- 预计 ~290 个文件（skills/ + card-effects/ + atoms/ + flows/ + card-effect/ + client/）

### 迁移映射表

| 符号 | 新来源 |
|------|--------|
| `applyAtom` | `../core/apply` |
| `runJudgeModifiers` | `../core/apply` |
| `pushNotify` | `../core/notify` |
| `resolveTimeoutMs` | `../core/timeout` |
| `pushFrame` | `../core/frame` |
| `popFrame` | `../core/frame` |
| `topFrame` | `../core/frame` |
| `frameCards` | `../core/frame` |

门面 API（create/bootstrap/dispatch 等）仍从 `'../index'` 或 `'../../engine'` 导入——session 层零改动。

### Steps

- [ ] **Step 1: 搜索所有需要迁移的 import**

用内置 grep 工具搜索 `from ['"]\.\.?/(index|\.\./index|engine/index|engine)['"]` 在整个 `src/` 下。

分类命中结果：
1. **skills/ 下的文件**（`from '../index'`）：导入 applyAtom/pushFrame/popFrame/topFrame/frameCards/pushNotify → 需迁移
2. **card-effects/ 下的文件**（`from '../index'`）：同上
3. **atoms/ 下的文件**（`from '../index'`）：applyAtom/resolveTimeoutMs/runJudgeModifiers → Task 6 已部分处理，此处补全
4. **flows/ 下的文件**（`from '../index'` 或 `from '..'`）：applyAtom → 需迁移
5. **core/card-effect/ 下的文件**（`from '../index'`）：applyAtom/frameCards/pushFrame 等 → 需迁移
6. **server/session.ts**（`from '../engine/index'`）：门面 API → **不迁移**（保持不变）
7. **client/ 下的文件**（`from '../../engine/atom'` 等）：已在 Task 5 中由 rename_file 处理

- [ ] **Step 2: 批量迁移 skills/ 下的 import**

skills/ 下的文件路径相对 engine 根为 `../`，相对 core/ 为 `../core/`。

对每种符号模式用 `sd`：

```bash
# applyAtom → core/apply
sd "from '(\\.\\./+)index'" "from '${1}core/apply'" src/engine/skills/*.ts
```

**注意：** 这会把所有 `from '../index'` 改为 `from '../core/apply'`。但有些文件从 index 导入的不止 applyAtom（还有 pushFrame/popFrame/frameCards），需要拆分导入。sd 做不到 import 拆分——需要手动检查。

**实际操作策略：** 先用 sd 做粗迁移，再逐文件手动修正。或者直接对每个文件用 edit 工具精确修改。

**推荐方式：** 由于 import 组合多样（有的 `import { applyAtom }`，有的 `import { applyAtom, popFrame, pushFrame }`），用 `task` 工具批量处理——每个 subagent 处理一个目录（skills/、card-effects/、atoms/、flows/、core/card-effect/）。

对每个目录，subagent 的任务是：
1. 搜索该目录下所有 `from '../index'` 的 import
2. 按导入的符号拆分为对应的具名导入：
   - `applyAtom` → `from '../core/apply'`
   - `pushFrame`/`popFrame`/`topFrame`/`frameCards` → `from '../core/frame'`
   - `pushNotify` → `from '../core/notify'`
   - `resolveTimeoutMs` → `from '../core/timeout'`
3. 保持门面 API（create/dispatch 等）的 import 不变

- [ ] **Step 3: 迁移 card-effects/ 下的 import**

同 Step 2 的策略，处理 `src/engine/card-effects/*.ts`。

- [ ] **Step 4: 迁移 flows/ 下的 import**

`flows/` 下文件用 `from '../index'` 导入 `applyAtom`。改为 `from '../core/apply'`。

```bash
sd "from '(\\.\\./+)index'" "from '${1}core/apply'" src/engine/flows/*.ts
```

检查 flows/ 下是否有文件导入 pushFrame/frameCards 等 frame 符号（flows/damage.ts 可能用 frameCards）。

- [ ] **Step 5: 迁移 core/card-effect/ 下的 import**

`core/card-effect/` 下的文件（use-card.ts、play-card.ts 等）用 `from '../index'` 导入。它们的相对路径到 core/apply 是 `./apply`（同目录），到 core/frame 是 `./frame`。

```bash
sd "from '\\.\\./index'" "from './apply'" src/engine/core/card-effect/*.ts
```

然后手动修正非 applyAtom 的导入（frameCards/pushFrame/popFrame/topFrame → `./frame`）。

- [ ] **Step 6: 检查 core/index.ts 内部的 import**

`core/index.ts` 应从 `./apply` 导入 applyAtom，从 `./notify` 导入 helper，从 `./frame` 导入帧函数（如果 dispatch 用到）。确认 dispatch 函数中没有遗漏的旧 import。

- [ ] **Step 7: 验证类型检查**

```bash
npm run typecheck
```
预期：无错误。所有 "has no exported member" 错误应消失。

- [ ] **Step 8: 运行全量测试**

```bash
npm test
```
预期：~3300 测试全部通过。这是整个重构最关键的验证点。

- [ ] **Step 9: 提交（Task 6 + Task 7 合并提交）**

```bash
git add -A && git commit -m "refactor(engine): 拆解 index.ts 为 core/apply+frame+notify+timeout，消费者改为具名导入"
```

---

## Task 8: 最终验证与清理

**Files:**
- Verify: `src/engine/index.ts`（确认只有门面 re-export）
- Verify: 全项目无残留的 `from '../index'` 导入内部符号
- Verify: 全项目无残留的旧路径

### Steps

- [ ] **Step 1: 确认顶层 index.ts 已清理**

```bash
cat src/engine/index.ts
```
预期：只有 ~15 行 re-export，无实现代码。

- [ ] **Step 2: 搜索残留的 from '../index' 导入**

用内置 grep 搜索 `from ['"]\.\.?/index['"]` 在 `src/engine/` 下（排除 `src/engine/index.ts` 自身和 `src/engine/core/index.ts`）。

预期命中应为 0。如有残留，修复。

- [ ] **Step 3: 搜索残留的单复数歧义路径**

用内置 grep 搜索：
- `from ['"].*\bcard-effect/` 在 `src/engine/skills/` 和 `src/engine/card-effects/` 下 —— 应为 `from '../core/card-effect/`
- `from ['"].*/atom['"]` 在 `src/engine/` 下 —— 应为 `from '../core/atom'` 或 `from './atom'`（core/ 内部）

- [ ] **Step 4: 检查 engine-imports.ts 副作用导入**

```bash
cat src/client/engine-imports.ts
```

确认 `import '../engine/atoms'` 和 `import '../engine/skills'` 路径仍正确（atoms/ 和 skills/ 目录位置不变，应无问题）。

- [ ] **Step 5: 运行 ESLint**

```bash
npm run lint
```
预期：无错误。如有 import 排序问题，运行 `npm run format` 自动修复。

- [ ] **Step 6: 运行 typecheck**

```bash
npm run typecheck
```
预期：无错误。

- [ ] **Step 7: 运行全量测试**

```bash
npm test
```
预期：~3300 测试全部通过。

- [ ] **Step 8: 运行 build**

```bash
npm run build
```
预期：构建成功（验证 Vite/Rollup 打包无循环依赖 chunk 拆分问题——这是原 index.ts 注释中提到的约束）。

- [ ] **Step 9: 最终提交**

```bash
git add -A && git commit -m "refactor(engine): 最终验证与清理"
```

---

## 风险检查清单（执行后验证）

- [ ] **R1 模块加载顺序**：dispatch/bootstrap 路径正常（门面 → core/index → atoms 副作用注册 → applyAtom 可用）。通过 `npm test` 的开局/选将/发牌测试验证。
- [ ] **R2 系统规则静态导入**：打包后无循环依赖 chunk 拆分。通过 `npm run build` 验证。
- [ ] **R3 restore 重放**：通过 `npm test` 的回放相关测试验证。
- [ ] **R4 无遗漏 import**：通过 `npm run typecheck` 验证。
