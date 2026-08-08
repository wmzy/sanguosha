# 引擎目录重组与深度重构设计

> 日期：2026-08-08
> 范围：`src/engine/` 目录结构与模块边界
> 方案：B（分层 + 彻底具名导入，打破循环依赖）

## 1. 背景与动机

`src/engine/` 顶层有 40+ 条目（目录 + 散文件）平铺，存在 5 个结构性问题：

1. **单复数歧义**（最严重）：`card-effect/`（单数＝效果框架）vs `card-effects/`（复数＝效果实现）；`atom.ts`（注册表）vs `atoms/`（定义）；`skill.ts`（注册表）vs `skills/`（内容）。肉眼难辨，工具也会误读。
2. **顶层散文件未分层**：7 个 `*-flow.ts`（流程编排）+ ~15 个规则模块（distance/slash-quota/hand-limit…）+ 工具（rng/log/invariants）全平铺在根，与核心 `index.ts` 混在一起。
3. **`index.ts` 职责过载**：44.5KB / 990 行，同时扛门面 API、atom apply 管线、帧管理、hook 排序、pending slot、restore 重放。
4. **`cards/` 命名误导**：实际是静态数据（characters/ + card-defs/），但名字像"卡牌"，真正的卡牌效果在 `card-effects/`。
5. **`无懈可击.ts` 同名歧义**：顶层那个是抵消机制 helper（被多张牌/技能复用），`card-effects/无懈可击.ts` 是具体那张牌。

## 2. 目标结构

```
src/engine/
├── types/            # 类型定义（不变）
├── view/             # 视图构建（不变）
│
├── core/             # 【机制内核】注册表、管线、框架 —— 消除单复数歧义
│   ├── index.ts      #   门面 API（create/bootstrap/dispatch/buildView/restore/fireTimeout）
│   │                 #   + 副作用注册触发（import './atoms'）
│   ├── apply.ts      #   ← applyAtom 完整管线 + runJudgeModifiers（从旧 index 拆出）
│   ├── frame.ts      #   ← pushFrame/popFrame/topFrame/frameCards
│   ├── pending.ts    #   ← createAndAwaitSlot + pending slot 管理
│   ├── notify.ts     #   ← pushNotify
│   ├── timeout.ts    #   ← resolveTimeoutMs
│   ├── atom.ts       #   ← 原 atom.ts（注册表 + 同步基础 apply）
│   ├── skill.ts      #   ← 原 skill.ts（action/hook 注册表）
│   ├── deck.ts       #   ← 原 deck.ts（标准牌堆生成，create 依赖）
│   ├── card-effect/  #   ← 原 card-effect/（卡牌效果框架：registry/use-card/validate…）
│   ├── skill-view-meta.ts   # ← 原 skill-view-meta.ts（技能视图元数据注册表）
│   ├── skill-loader.ts      # ← 原 skill-loader.ts（技能实例管理）
│   └── card-response-availability.ts  # ← 原 card-response-availability.ts
│
├── rules/            # 【游戏规则约束】纯谓词 / 约束计算
│   ├── distance.ts
│   ├── viewDistance.ts
│   ├── hand-limit.ts
│   ├── slash-quota.ts
│   ├── slash-target.ts
│   ├── trick-quota.ts
│   ├── once-per-turn.ts
│   ├── skip-phase.ts
│   └── action-active.ts
│
├── flows/            # 【流程编排】调用 applyAtom 的编排函数
│   ├── damage.ts     #   ← damage-flow.ts（去 -flow 后缀）
│   ├── judge.ts      #   ← judge-flow.ts
│   ├── life.ts       #   ← life-flow.ts
│   ├── death.ts      #   ← death-flow.ts
│   ├── move.ts       #   ← move-flow.ts
│   ├── rank.ts       #   ← rank-flow.ts
│   ├── turn.ts       #   ← turn-flow.ts
│   ├── recast.ts     #   ← recast.ts
│   ├── pick-card-panel.ts  # ← pick-card-panel.ts
│   └── cancel.ts     #   ← 无懈可击.ts（抵消机制 helper，消除与具体牌同名歧义）
│
├── util/             # 【工具函数】无领域依赖
│   ├── rng.ts
│   ├── log.ts
│   ├── invariants.ts
│   └── typeGuards.ts
│
├── data/             # 【静态数据 + 元数据查询】
│   ├── characters/   #   ← cards/characters/（武将数据）
│   ├── card-defs/    #   ← cards/card-defs/（卡牌定义）
│   ├── card-meta.ts  #   ← card-meta.ts（卡牌元数据查询）
│   ├── character-meta.ts  # ← character-meta.ts
│   └── characters.ts #   ← characters.ts（角色 re-export）
│
├── atoms/            # 具体 atom 定义（内容，中文文件名，不变）
├── skills/           # 具体技能（内容，不变）
├── card-effects/     # 具体牌效果（内容，不变）
└── index.ts          # 引擎对外唯一入口 —— re-export core/ 门面 API
                      # （session 层 import { create } from './engine' 零改动）
```

### 顶层条目数变化

40+ → **12 条**（types/view/core/rules/flows/util/data/atoms/skills/card-effects/index.ts + 无）。

## 3. 关键设计决策

### D1 — 顶层 `index.ts` 降级为门面 re-export

顶层 `index.ts` 不再包含实现代码，只 re-export `core/` 的 7 个门面 API：

```ts
// engine/index.ts — 引擎对外唯一入口（门面 re-export）
export {
  create,
  bootstrap,
  dispatch,
  buildView,
  restore,
  fireTimeout,
  checkGameOver,
  resolveTimeoutMs,
} from './core';
export type { GameConfig } from './core';
```

**效果**：session 层 `import { create } from './engine'` 零改动。顶层 index.ts 不是 barrel（只 re-export 门面 API，不暴露内部符号）。

### D2 — `core/index.ts` 承载门面实现 + 副作用注册

门面 API 的实现（create/bootstrap/dispatch…）移到 `core/index.ts`。副作用注册也在此触发：

```ts
// core/index.ts
import './atoms';          // 副作用：注册所有 atom 定义
import * as 系统规则mod from './skills/系统规则';  // 静态导入（循环依赖约束，见原注释）
// ... 门面 API 实现
```

### D3 — applyAtom 管线拆出到 `core/apply.ts`（打破循环枢纽）

旧 `index.ts` 的 `applyAtom`/`runJudgeModifiers` 移到 `core/apply.ts`。这切断了原来的循环枢纽：

```
旧循环：index.ts ─→ atoms ─→ index.ts（runJudgeModifiers）
新 DAG：core/index ─→ atoms ─→ core/apply（不回到 core/index）
```

`atoms/` 里的文件改导入路径：`import { runJudgeModifiers } from '../index'` → `from '../core/apply'`。

### D4 — 消费者全部改为具名导入（方案 B 核心）

所有 skill/card-effect/flow 文件的 `from '../index'` 改为具体模块路径：

| 旧路径 | 新路径 | 符号 |
|--------|--------|------|
| `from '../index'` | `from '../core/apply'` | `applyAtom`, `runJudgeModifiers` |
| `from '../index'` | `from '../core/frame'` | `pushFrame`, `popFrame`, `topFrame`, `frameCards` |
| `from '../index'` | `from '../core/notify'` | `pushNotify` |
| `from '../index'` | `from '../core/timeout'` | `resolveTimeoutMs` |

涉及 ~290 个文件。用 LSP `rename_file` + 文本搜索迁移。

### D5 — 命名约定保持不变

- 框架机制层：英文（core/atom、core/skill、rules/、flows/、util/）
- 领域内容层：中文（atoms/摸牌、skills/仁德、card-effects/杀）

只动结构，不动命名风格。

### D6 — `flows/` 去掉 `-flow` 后缀

`damage-flow.ts` → `flows/damage.ts`。目录名已表达"流程"，后缀冗余。

## 4. 逐文件迁移清单

### 4.1 core/（机制内核）

| 旧路径 | 新路径 | 说明 |
|--------|--------|------|
| `atom.ts` | `core/atom.ts` | 原子操作注册表 |
| `skill.ts` | `core/skill.ts` | 技能 action/hook 注册表 |
| `card-effect/` | `core/card-effect/` | 卡牌效果框架（整目录） |
| `skill-view-meta.ts` | `core/skill-view-meta.ts` | 技能视图元数据注册表 |
| `skill-loader.ts` | `core/skill-loader.ts` | 技能实例管理 |
| `card-response-availability.ts` | `core/card-response-availability.ts` | 卡牌回应可用性预检 |
| `deck.ts` | `core/deck.ts` | 标准牌堆生成（create 依赖，依赖 card-defs + skills） |
| `index.ts`（门面 API 部分） | `core/index.ts` | create/bootstrap/dispatch/buildView/restore/fireTimeout/checkGameOver |
| `index.ts`（applyAtom 管线） | `core/apply.ts` | applyAtom/runJudgeModifiers |
| `index.ts`（帧管理） | `core/frame.ts` | pushFrame/popFrame/topFrame/frameCards |
| `index.ts`（pending slot） | `core/pending.ts` | createAndAwaitSlot |
| `index.ts`（notify） | `core/notify.ts` | pushNotify |
| `index.ts`（resolveTimeoutMs） | `core/timeout.ts` | resolveTimeoutMs |

### 4.2 rules/（游戏规则约束）

| 旧路径 | 新路径 |
|--------|--------|
| `distance.ts` | `rules/distance.ts` |
| `viewDistance.ts` | `rules/viewDistance.ts` |
| `hand-limit.ts` | `rules/hand-limit.ts` |
| `slash-quota.ts` | `rules/slash-quota.ts` |
| `slash-target.ts` | `rules/slash-target.ts` |
| `trick-quota.ts` | `rules/trick-quota.ts` |
| `once-per-turn.ts` | `rules/once-per-turn.ts` |
| `skip-phase.ts` | `rules/skip-phase.ts` |
| `action-active.ts` | `rules/action-active.ts` |

### 4.3 flows/（流程编排）

| 旧路径 | 新路径 | 说明 |
|--------|--------|------|
| `damage-flow.ts` | `flows/damage.ts` | 去 -flow 后缀 |
| `judge-flow.ts` | `flows/judge.ts` | |
| `life-flow.ts` | `flows/life.ts` | |
| `death-flow.ts` | `flows/death.ts` | |
| `move-flow.ts` | `flows/move.ts` | |
| `rank-flow.ts` | `flows/rank.ts` | |
| `turn-flow.ts` | `flows/turn.ts` | |
| `recast.ts` | `flows/recast.ts` | |
| `pick-card-panel.ts` | `flows/pick-card-panel.ts` | |
| `无懈可击.ts` | `flows/cancel.ts` | 抵消机制 helper，消除与具体牌同名歧义 |

### 4.4 util/（工具函数）

| 旧路径 | 新路径 |
|--------|--------|
| `rng.ts` | `util/rng.ts` |
| `log.ts` | `util/log.ts` |
| `invariants.ts` | `util/invariants.ts` |
| `typeGuards.ts` | `util/typeGuards.ts` |

### 4.5 data/（静态数据 + 元数据）

| 旧路径 | 新路径 | 说明 |
|--------|--------|------|
| `cards/characters/` | `data/characters/` | 武将数据 |
| `cards/card-defs/` | `data/card-defs/` | 卡牌定义 |
| `card-meta.ts` | `data/card-meta.ts` | 卡牌元数据查询（注：依赖 skills/skillLoaders） |
| `character-meta.ts` | `data/character-meta.ts` | 武将元数据查询 |
| `characters.ts` | `data/characters.ts` | 角色 re-export |

### 4.6 内容目录（不变，仅路径内的 import 更新）

- `atoms/`：内部 import 路径更新（index→core/apply 等）
- `skills/`：内部 import 路径更新
- `card-effects/`：内部 import 路径更新
- `types/`：不变
- `view/`：不变

## 5. 迁移批次与验证策略

每批次完成后立即运行 `npm test`（~3300 测试）确认绿，再做下一批。目录移动用 `git mv` 保留历史；import 路径用 LSP `rename_file`（symbol-aware，自动迁移 callsite）或文本搜索批量替换。

### 批次顺序（风险从低到高）

| 批次 | 内容 | 风险 | 预估文件数 |
|------|------|------|-----------|
| B1 | `util/`：rng/log/invariants/typeGuards 迁入 | 低（依赖少） | ~4 移动 + 消费者 import |
| B2 | `data/`：cards/ 改名 + meta 迁入 | 低 | ~5 移动 + 消费者 import |
| B3 | `rules/`：9 个规则模块迁入 | 低-中 | ~9 移动 + 消费者 import |
| B4 | `flows/`：7 个 *-flow + recast/pick-card-panel/cancel 迁入 | 中 | ~10 移动 + 消费者 import |
| B5 | `core/` 框架迁移：atom/skill/card-effect/skill-view-meta/skill-loader/card-response-availability/deck 迁入 | 中 | ~7 移动 + 消费者 import |
| B6 | `index.ts` 拆解：门面→core/index、applyAtom→core/apply、帧→core/frame、pending→core/pending、notify→core/notify、timeout→core/timeout | **高** | index 拆 6 文件 |
| B7 | 消费者 import 迁移：所有 `from '../index'` → 具名路径 | **高** | ~290 文件 |

> B5/B6/B7 可合并为一个大步骤执行（三者强耦合），但按子步骤验证。

## 6. 风险点

### R1 — 模块加载顺序变化（最高风险）

打破循环依赖后，ESM live binding 不再掩盖初始化时序问题。若某模块在顶层（非函数体内）使用了尚未初始化的绑定，重构后会暴露为 `undefined`。重点验证：
- `dispatch` / `bootstrap` 路径（门面 → core/index → atoms 副作用注册 → applyAtom 可用）
- `restore` 重放路径
- 系统规则 静态导入（原注释指出循环依赖约束）

### R2 — index.ts 拆解的内部耦合

旧 index.ts 内部的模块级 helper（`notifyStateChange`/`logAction`/`extractPendingTarget`/`sortHooksCounterclockwise`/`emptyFrame` 等）被多个职责域共享。拆解时需确定每个 helper 归属哪个新模块，或提取到共享模块（如 `core/internal.ts`）。

### R3 — card-meta.ts 的跨层依赖

`data/card-meta.ts` import `skills`（skillLoaders），形成 data → skills 依赖。这是既有耦合，重构不改变它，但 data 层出现领域依赖需注意。若后续要解耦，属独立决策。

### R4 — 消费者 import 迁移的遗漏

~290 文件的 import 路径迁移，遗漏会导致运行时 `undefined is not a function`。用 tsc + 全量测试兜底，不用目检。

## 7. 不做的事（YAGNI）

- 不改命名风格（中英文边界保持现状）
- 不重构技能/atom/card-effect 的内部实现
- 不改 types/ 和 view/ 的结构
- 不引入新的抽象层或接口
- 不改 session 层的 import（门面 re-export 保证零改动）
