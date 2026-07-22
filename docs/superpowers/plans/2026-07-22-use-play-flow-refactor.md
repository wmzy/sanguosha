# 使用牌/打出牌核心重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建"使用牌"和"打出牌"两个新技能作为卡牌使用的统一入口，配合 CardEffect 注册表（含牌面元数据：使用时机/使用目标/合法性检测/结算效果）。核心就绪后不影响现有卡牌技能，后续逐步迁移。

**Architecture:** "使用牌"和"打出牌"是注册 action 的技能（skill 层），不是 atom。atom 是结算流程中的事件时机节点。每种牌注册 CardEffect（牌面元数据 + 校验 + 结算效果），使用牌/打出牌技能的 validate/execute 查注册表路由。补全文档要求的 6 个时机 atom，让无双/肉林/雷击等通过 hook 注册。

**Tech Stack:** TypeScript, Vitest, 原子操作引擎（applyAtom + before/after hooks）

**关键原则：** 使用牌/打出牌是新技能，与杀/决斗/无中生有等现有卡牌技能并存。新核心就绪后，现有技能继续工作。后续迁移逐张牌进行，每步可验证。

---

## 文档参照

- 使用流程：`../sanguosha-doc/_gitbook/rules/flow/use.md`
- 打出流程：`../sanguosha-doc/_gitbook/rules/flow/play.md`
- 合法性检测：`../sanguosha-doc/_gitbook/rules/flow/condition.md`
- 基本牌：`../sanguosha-doc/_gitbook/rules/card/basic.md`
- 锦囊牌：`../sanguosha-doc/_gitbook/rules/card/scroll.md`

---

## 设计审查

### 当前架构

```
每个卡牌 = 一个 skill
  杀.ts:     registerAction('杀', 'use', ...)     → validate + execute 手写
  决斗.ts:   registerAction('决斗', 'use', ...)   → validate + execute 手写
  无中生有:   registerAction('无中生有', 'use', ...) → validate + execute 手写
  闪.ts:     registerAction('闪', 'respond', ...)  → execute 手写

前端路由:
  use:       findUseActionForCard → 按 cardFilter 匹配 → send(cardName, 'use', params)
  respond:   atomType='询问闪' → skillId='闪' → send('闪', 'respond', params)

问题:
  1. 杀.ts import 无双/肉林（核心→具体技能 依赖反转）
  2. 杀结算逻辑复制 9+ 份
  3. 锦囊框架复制 10+ 份
  4. 牌面元数据分散：CardDef.targetFilter / onMount.prompt / validate 闭包 各有一份
```

### 目标架构

```
使用牌/打出牌 = 唯一的卡牌使用入口技能
  使用牌.ts:  registerAction('使用牌', 'use', ...)
              → validate: 查 CardEffect[cardName].canUse
              → execute:  runUseFlow → CardEffect[cardName].resolve

  打出牌.ts:  registerAction('打出牌', 'respond', ...)
              → execute:  runPlayFlow

CardEffect 注册表:
  '杀':       { timing, target, canUse, resolve, prompt, ... }
  '无中生有': { timing, target, canUse, resolve, prompt, ... }
  ...

卡牌技能 (杀/决斗等):
  迁移前: 各自注册 use action + execute 手写流程
  迁移后: 仅注册 CardEffect 数据，不再注册 action

前端路由 (迁移后):
  use:       选中牌 → 查 CardEffect[cardName].prompt → send('使用牌', 'use', params)
  respond:   atomType='询问闪' → skillId='打出牌' → send('打出牌', 'respond', params)
```

### CardEffect 数据结构

每张牌的 CardEffect 对齐文档的三层信息：

```typescript
interface CardEffect {
  // ── 第一层：牌面信息（文档"使用时机/使用目标"）──
  /** 使用时机：什么时候能使用此牌 */
  timing: CardTiming;
  /** 使用目标：目标选择规则 + 额定目标数 */
  target: CardTargetSpec;

  // ── 第二层：合法性检测（condition.md 三条件）──
  /** 能否使用此牌的统一校验（禁用/次数/合法目标数） */
  canUse: (state, ownerId, params) => string | null;

  // ── 第三层：使用结算（use.md 生效前响应 + 生效后效果）──
  /** 对单个目标的结算效果（在 runUseFlow 的逐目标循环中调用） */
  resolve: (state, ctx: ResolveCtx) => Promise<void>;

  // ── 前端 UI ──
  prompt: ActionPrompt;
  label: string;
  style: 'danger' | 'primary' | 'default';
  activeWhen?: (ctx: ActionContext) => boolean;
}
```

### 合法性检测体系（condition.md）

```typescript
type CardTiming =
  | '出牌阶段'           // 杀/锦囊/装备/桃Ⅰ/酒Ⅰ
  | '出牌阶段限一次'     // 杀（杀有额外次数体系，由 slash-quota 处理）
  | '濒死时'             // 桃Ⅱ/酒Ⅱ
  | '杀生效前';          // 闪

type CardTargetSpec =
  | { kind: 'none' }                                    // 无目标（无中生有对己）
  | { kind: 'self' }                                    // 自己（酒）
  | { kind: 'inAttackRange'; min: 1; max: number }      // 攻击范围内（杀）
  | { kind: 'distance'; dist: number; min: 1; max: 1 }  // 距离N内（顺手牵羊/兵粮寸断）
  | { kind: 'allOthers' }                               // 所有其他角色（万箭/南蛮/过河拆桥隐含）
  | { kind: 'allPlayers' }                              // 所有角色（桃园/五谷）
  | { kind: 'other'; min: 1; max: number }              // 任意其他角色（决斗）
  | { kind: 'wounded'; min: 0; max: 1 }                 // 已受伤角色（桃）
```

合法性三条件（`canUse` 内统一检查）：
1. **禁用检测**：检查 tags（义绝/鸡肋/巧说等禁用标记）
2. **次数检测**：仅 `timing='出牌阶段限一次'` 的牌（杀），走 slash-quota
3. **合法目标数 > 0**：用 `target` 规范遍历候选目标，检查非空

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/engine/card-effect/registry.ts` | CardEffect 注册表 + 类型定义 |
| `src/engine/card-effect/use-card.ts` | "使用牌"技能（action 注册 + runUseFlow） |
| `src/engine/card-effect/play-card.ts` | "打出牌"技能（action 注册 + runPlayFlow） |
| `src/engine/atoms/选择目标时.ts` | 事件 atom（时机1：转化技） |
| `src/engine/atoms/使用时.ts` | 事件 atom（时机2：集智/强识） |
| `src/engine/atoms/指定目标后.ts` | 事件 atom（时机5：铁骑/无双①） |
| `src/engine/atoms/成为目标后.ts` | 事件 atom（时机6：贞烈/无双②） |
| `src/engine/atoms/声明打出时.ts` | 事件 atom（打出时机1：转化技） |
| `src/engine/atoms/打出牌时.ts` | 事件 atom（打出时机2：雷击/涯角） |

### 不修改的文件（本阶段）

所有现有卡牌技能（杀.ts、决斗.ts、无中生有.ts、闪.ts 等）**保持不变**。它们继续各自注册 action 并正常工作。迁移是后续阶段。

### 后续修改的文件

| 文件 | 改动 | 阶段 |
|------|------|------|
| `src/engine/skills/无双.ts` | 删除 enforce 函数，改 hook 注册 | 迁移杀时 |
| `src/engine/skills/肉林.ts` | 同上 | 迁移杀时 |
| `src/engine/skills/雷击.ts` | after-hook 迁移到 打出牌时 | 迁移闪时 |
| `src/engine/skills/杀.ts` | 删除，注册 CardEffect | 迁移杀 |
| `src/engine/skills/决斗.ts` | 删除，注册 CardEffect | 迁移决斗 |
| ...其余卡牌逐个迁移 | | |

---

## Task 1: 新增 6 个时机 atom

**Files:**
- Create: `src/engine/atoms/选择目标时.ts`
- Create: `src/engine/atoms/使用时.ts`
- Create: `src/engine/atoms/指定目标后.ts`
- Create: `src/engine/atoms/成为目标后.ts`
- Create: `src/engine/atoms/声明打出时.ts`
- Create: `src/engine/atoms/打出牌时.ts`
- Modify: `src/engine/types/atom.ts`
- Modify: `src/engine/atoms/index.ts`

这 6 个 atom 对齐文档 use.md / play.md 的结算时机，全是事件标记型（无状态副作用），只是提供 hook 注册点。

- [ ] **Step 1: 添加 Atom 类型成员**

在 `src/engine/types/atom.ts` 的 `Atom` 联合类型中，在 `成为目标` 之后添加：

```typescript
  // 使用结算前时机（文档 use.md）
  | { type: '选择目标时'; source: number; cardId: string; targets: number[] }
  | { type: '使用时'; source: number; cardId: string }
  | { type: '指定目标后'; source: number; cardId?: string; target: number }
  | { type: '成为目标后'; source: number; cardId?: string; target: number }
  // 打出结算时机（文档 play.md）
  | { type: '声明打出时'; player: number; cardId: string }
  | { type: '打出牌时'; player: number; cardId: string }
```

- [ ] **Step 2: 创建 指定目标后 atom**

Create `src/engine/atoms/指定目标后.ts`:

```typescript
// 指定目标后:使用结算前时机5（文档 use.md）。
// 目标确定不再改变。铁骑/烈弓/无双①/肉林① 等技能在此 after-hook 触发。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 指定目标后: AtomDefinition<{ source: number; cardId?: string; target: number }> = {
  type: '指定目标后',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply(_state) {},
  effect: { sound: 'target', animation: 'highlight', duration: 300 },
  toViewEvents(state, atom): ViewEventSplit {
    const cardName = atom.cardId ? (state.cardMap[atom.cardId]?.name ?? atom.cardId) : undefined;
    const view: ViewEvent = {
      type: '指定目标后',
      source: atom.source,
      target: atom.target,
      ...(atom.cardId !== undefined ? { cardId: atom.cardId } : {}),
      ...(cardName !== undefined ? { cardName } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(_view, _event) {},
};

registerAtom(指定目标后);
```

- [ ] **Step 3: 创建 成为目标后 atom**

Create `src/engine/atoms/成为目标后.ts`:

```typescript
// 成为目标后:使用结算前时机6（文档 use.md）。
// 贞烈/啖酪/慷忾/无双②/肉林② 等技能在此 after-hook 触发。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 成为目标后: AtomDefinition<{ source: number; cardId?: string; target: number }> = {
  type: '成为目标后',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply(_state) {},
  effect: { sound: 'target', animation: 'highlight', duration: 300 },
  toViewEvents(state, atom): ViewEventSplit {
    const cardName = atom.cardId ? (state.cardMap[atom.cardId]?.name ?? atom.cardId) : undefined;
    const view: ViewEvent = {
      type: '成为目标后',
      source: atom.source,
      target: atom.target,
      ...(atom.cardId !== undefined ? { cardId: atom.cardId } : {}),
      ...(cardName !== undefined ? { cardName } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(_view, _event) {},
};

registerAtom(成为目标后);
```

- [ ] **Step 4: 创建 打出牌时 atom**

Create `src/engine/atoms/打出牌时.ts`:

```typescript
// 打出牌时:打出结算中时机2（文档 play.md）。
// 实体牌已置入处理区后触发。雷击/涯角/银月枪 等技能在此 after-hook 触发。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 打出牌时: AtomDefinition<{ player: number; cardId: string }> = {
  type: '打出牌时',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply(_state) {},
  effect: { sound: 'play_card', animation: 'flip', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    const card = state.cardMap[atom.cardId];
    const cardInfo = card
      ? { name: card.name, suit: card.suit, rank: card.rank, color: card.color }
      : undefined;
    const view: ViewEvent = {
      type: '打出牌时',
      player: atom.player,
      cardId: atom.cardId,
      ...(cardInfo !== undefined ? { card: cardInfo } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(_view, _event) {},
};

registerAtom(打出牌时);
```

- [ ] **Step 5: 创建 选择目标时 atom**

Create `src/engine/atoms/选择目标时.ts`:

```typescript
// 选择目标时:使用结算前时机1（文档 use.md）。
// 声明使用的牌名 + 选择目标 + 展示实体牌。转化技(丈八/武圣/倾国)在此 before-hook 替换。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 选择目标时: AtomDefinition<{ source: number; cardId: string; targets: number[] }> = {
  type: '选择目标时',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply(_state) {},
  effect: { sound: 'play_card', animation: 'flip', duration: 400 },
  toViewEvents(state, atom): ViewEventSplit {
    const card = state.cardMap[atom.cardId];
    const cardInfo = card
      ? { name: card.name, suit: card.suit, rank: card.rank, color: card.color }
      : undefined;
    const view: ViewEvent = {
      type: '选择目标时',
      source: atom.source,
      cardId: atom.cardId,
      targets: atom.targets,
      ...(cardInfo !== undefined ? { card: cardInfo } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(_view, _event) {},
};

registerAtom(选择目标时);
```

- [ ] **Step 6: 创建 使用时 atom**

Create `src/engine/atoms/使用时.ts`:

```typescript
// 使用时:使用结算前时机2（文档 use.md）。
// 实体牌已置入处理区后触发。集智/强识 等技能在此 after-hook 摸牌。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 使用时: AtomDefinition<{ source: number; cardId: string }> = {
  type: '使用时',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply(_state) {},
  effect: { duration: 200 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '使用时',
      source: atom.source,
      cardId: atom.cardId,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(_view, _event) {},
};

registerAtom(使用时);
```

- [ ] **Step 7: 创建 声明打出时 atom**

Create `src/engine/atoms/声明打出时.ts`:

```typescript
// 声明打出时:打出结算中时机1（文档 play.md）。
// 声明打出的牌名 + 展示实体牌。转化技(武圣/倾国/丈八)在此 before-hook 替换。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 声明打出时: AtomDefinition<{ player: number; cardId: string }> = {
  type: '声明打出时',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply(_state) {},
  effect: { sound: 'play_card', animation: 'flip', duration: 400 },
  toViewEvents(state, atom): ViewEventSplit {
    const card = state.cardMap[atom.cardId];
    const cardInfo = card
      ? { name: card.name, suit: card.suit, rank: card.rank, color: card.color }
      : undefined;
    const view: ViewEvent = {
      type: '声明打出时',
      player: atom.player,
      cardId: atom.cardId,
      ...(cardInfo !== undefined ? { card: cardInfo } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(_view, _event) {},
};

registerAtom(声明打出时);
```

- [ ] **Step 8: 注册到 atoms/index.ts**

在 `src/engine/atoms/index.ts` 的 `import './成为目标';` 之后添加：

```typescript
import './选择目标时';
import './使用时';
import './指定目标后';
import './成为目标后';
import './声明打出时';
import './打出牌时';
```

- [ ] **Step 9: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 10: Commit**

```bash
git add src/engine/types/atom.ts src/engine/atoms/选择目标时.ts src/engine/atoms/使用时.ts src/engine/atoms/指定目标后.ts src/engine/atoms/成为目标后.ts src/engine/atoms/声明打出时.ts src/engine/atoms/打出牌时.ts src/engine/atoms/index.ts
git commit -m "feat: 新增 6 个使用/打出结算时机 atom"
```

---

## Task 2: CardEffect 注册表与类型定义

**Files:**
- Create: `src/engine/card-effect/registry.ts`

定义 CardEffect 接口和注册表。注册表是模块级 Map（非 state-bound），因为卡牌效果是静态数据，不随游戏状态变化。

- [ ] **Step 1: 创建注册表**

Create `src/engine/card-effect/registry.ts`:

```typescript
// CardEffect 注册表：每种牌的使用结算数据。
//
// 对齐文档三层信息：
//   1. 牌面信息（使用时机/使用目标）—— 来自 basic.md / scroll.md
//   2. 合法性检测（能否使用）—— 来自 condition.md
//   3. 使用结算（生效前响应 + 生效后效果）—— 来自 use.md
//
// 使用牌/打出牌技能通过此注册表路由到具体牌的效果。
// 牌面元数据（timing/target）结构化存储，供 canUse 统一检查合法性。

import type { ActionContext, ActionPrompt, Card, GameState, Json } from '../types';

// ── 第一层：牌面信息 ──

/** 使用时机：什么时候能使用此牌（对齐文档"使用时机"） */
export type CardTiming =
  | '出牌阶段'           // 杀(受次数限制)/锦囊/装备/桃Ⅰ/酒Ⅰ
  | '濒死时'             // 桃Ⅱ/酒Ⅱ
  | '杀生效前';          // 闪（以你为目标的杀生效前）

/** 使用目标规范（对齐文档"使用目标"）。
 *  提供合法性检测标准（之一）和额定目标数。 */
export type CardTargetSpec =
  | { kind: 'none' }                                      // 无目标（无中生有对己）
  | { kind: 'self' }                                      // 自己（酒Ⅰ）
  | { kind: 'inAttackRange'; min: 1; max: number }        // 攻击范围内（杀：1~1，方天画戟：1~3）
  | { kind: 'distance'; dist: number; min: 1; max: 1 }    // 距离N内（顺手牵羊=1，兵粮寸断=1）
  | { kind: 'allOthers' }                                 // 所有其他角色（万箭/南蛮）
  | { kind: 'allPlayers' }                                // 所有角色（桃园/五谷）
  | { kind: 'other'; min: 1; max: number }                // 任意其他角色（决斗=1，过河拆桥=1）
  | { kind: 'wounded'; min: 0; max: 1 };                  // 包括你在内已受伤角色（桃）

// ── 第二层：合法性检测 ──

/** 使用结算上下文（传给 resolve） */
export interface ResolveCtx {
  state: GameState;
  source: number;
  target: number;
  cardId: string;
  /** 多目标结算中的目标序号（从0开始） */
  targetIndex: number;
}

// ── CardEffect 接口 ──

export interface CardEffect {
  /** 使用时机 */
  timing: CardTiming;
  /** 使用目标规范 */
  target: CardTargetSpec;

  /** 合法性检测（condition.md 三条件统一检查）。
   *  返回 null=通过，字符串=拒绝理由。
   *  通用检测（禁用/次数/合法目标数）由 use-card.ts 的 validate 统一调用 helper 完成，
   *  此函数可追加牌特有的校验（如桃的"目标已受伤"）。 */
  canUse?: (state: GameState, ownerId: number, params: Record<string, Json>) => string | null;

  /** 对单个目标的结算效果。
   *  在 runUseFlow 的逐目标循环中调用（使用结算中：生效前响应 + 生效后效果）。
   *  杀：询问闪 → 检查处理区 → 伤害/抵消
   *  无中生有：无懈 → 摸牌
   *  桃：回复体力 */
  resolve: (ctx: ResolveCtx) => Promise<void>;

  // ── 前端 UI ──
  prompt: ActionPrompt;
  label: string;
  style: 'danger' | 'primary' | 'default';
  activeWhen?: (ctx: ActionContext) => boolean;
}

// ── 注册表 ──

const registry = new Map<string, CardEffect>();

/** 注册一张牌的使用效果 */
export function registerCardEffect(cardName: string, effect: CardEffect): void {
  registry.set(cardName, effect);
}

/** 查询一张牌的使用效果。未注册返回 undefined。 */
export function getCardEffect(cardName: string): CardEffect | undefined {
  return registry.get(cardName);
}

/** 查询一张牌的使用效果。未注册抛错。 */
export function requireCardEffect(cardName: string): CardEffect {
  const effect = registry.get(cardName);
  if (!effect) throw new Error(`CardEffect 未注册: ${cardName}`);
  return effect;
}

/** 检查一张牌是否已注册 CardEffect */
export function hasCardEffect(cardName: string): boolean {
  return registry.has(cardName);
}
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/engine/card-effect/registry.ts
git commit -m "feat: 新增 CardEffect 注册表与类型定义"
```

---

## Task 3: 合法性检测 helper

**Files:**
- Create: `src/engine/card-effect/validate.ts`

从 condition.md 提取统一的合法性检测逻辑，供使用牌技能的 validate 调用。

- [ ] **Step 1: 创建合法性检测模块**

Create `src/engine/card-effect/validate.ts`:

```typescript
// 合法性检测 helper（对齐文档 condition.md 三条件）。
//
// 一张牌能被使用的条件：
//   1. 不受技能效果影响不能使用此牌（禁用 tag）
//   2. 使用次数未达上限（仅杀，走 slash-quota）
//   3. 额定目标数 > 0（全场有至少一个合法额定目标）
//
// 检测合法性 = 距离合法性 + 选择目标合法性。

import type { GameState, Json } from '../types';
import { effectiveDistance, inAttackRange } from '../distance';
import { canSlash } from '../slash-quota';
import { validateUseCard } from '../skill';
import type { CardTargetSpec } from './registry';
import { getCardEffect } from './registry';

/** 检查 ownerId 是否被禁止使用此牌（condition.md 条件1）。
 *  当前通过 player.tags 检查通用禁用标记。
 *  义绝的 '义绝/禁出牌' 标记已覆盖此路径。 */
function isCardBanned(state: GameState, ownerId: number, cardName: string): boolean {
  const player = state.players[ownerId];
  if (!player) return false;
  // 义绝：禁出牌标记阻止使用/打出任何需要出牌的 prompt
  if (player.tags.includes('义绝/禁出牌')) return true;
  return false;
}

/** 检查使用次数（condition.md 条件2，仅杀）。 */
function checkUsageLimit(state: GameState, ownerId: number, cardName: string): string | null {
  if (cardName === '杀') {
    const cardId = state.players[ownerId]?.hand[
      // cardId 从 params 传入更准确，这里用简化版
    ];
    if (!canSlash(state, ownerId)) return '出杀次数已达上限';
  }
  return null;
}

/** 判断 target 是否为 ownerId 使用 cardName 的合法目标（condition.md 合法性检测）。
 *  检测距离合法性 + 选择目标合法性。 */
export function isLegalTarget(
  state: GameState,
  ownerId: number,
  cardName: string,
  target: number,
): boolean {
  if (target === ownerId) {
    // 自己作为目标：只有 target.kind='self' 或 'wounded' 或 'allPlayers' 时合法
    const effect = getCardEffect(cardName);
    if (!effect) return false;
    const t = effect.target;
    if (t.kind === 'self' || t.kind === 'allPlayers') return true;
    if (t.kind === 'wounded') {
      const p = state.players[ownerId];
      return !!p && p.health < p.maxHealth;
    }
    return false;
  }

  const targetPlayer = state.players[target];
  if (!targetPlayer?.alive) return false;

  const effect = getCardEffect(cardName);
  if (!effect) return false;
  const spec = effect.target;

  switch (spec.kind) {
    case 'none':
    case 'self':
      return false;
    case 'inAttackRange':
      return inAttackRange(state, ownerId, target);
    case 'distance':
      return effectiveDistance(state, ownerId, target) <= spec.dist;
    case 'allOthers':
      return true;
    case 'allPlayers':
      return true;
    case 'other':
      return true;
    case 'wounded':
      return targetPlayer.health < targetPlayer.maxHealth;
    default:
      return false;
  }
}

/** 遍历全场，找到所有合法的额定目标（condition.md 条件3）。
 *  用于检查"额定目标数 > 0"。 */
export function findLegalTargets(
  state: GameState,
  ownerId: number,
  cardName: string,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < state.players.length; i++) {
    if (i === ownerId) {
      // 自己作为目标需检查
      if (isLegalTarget(state, ownerId, cardName, i)) result.push(i);
    } else {
      if (isLegalTarget(state, ownerId, cardName, i)) result.push(i);
    }
  }
  return result;
}

/** 统一合法性检测（condition.md 三条件）。
 *  返回 null=通过，字符串=拒绝理由。 */
export function validateCardUse(
  state: GameState,
  ownerId: number,
  params: Record<string, Json>,
  cardName: string,
): string | null {
  // 通用检查：自己回合、出牌阶段、无阻塞 pending、存活、手牌中有牌
  const base = validateUseCard(state, ownerId, params, { cardName });
  if (base) return base;

  // 条件1：禁用检测
  if (isCardBanned(state, ownerId, cardName)) return '你不能使用此牌';

  // 条件2：次数限制
  const limit = checkUsageLimit(state, ownerId, cardName);
  if (limit) return limit;

  // 条件3：合法目标数 > 0（有目标要求的牌）
  const effect = getCardEffect(cardName);
  if (!effect) return `${cardName} 尚未注册 CardEffect`;
  if (effect.target.kind !== 'none' && effect.target.kind !== 'self') {
    const legalTargets = findLegalTargets(state, ownerId, cardName);
    if (legalTargets.length === 0) return '没有合法目标';
  }

  // 牌特有校验
  if (effect.canUse) {
    const customErr = effect.canUse(state, ownerId, params);
    if (customErr) return customErr;
  }

  return null;
}
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/engine/card-effect/validate.ts
git commit -m "feat: 新增合法性检测 helper（condition.md 三条件）"
```

---

## Task 4: 使用牌技能 + runUseFlow

**Files:**
- Create: `src/engine/card-effect/use-card.ts`

"使用牌"是一个真正的 skill，注册 use action，通过 CardEffect 注册表路由。runUseFlow 编排文档 use.md 的完整使用结算流程。

- [ ] **Step 1: 创建使用牌技能**

Create `src/engine/card-effect/use-card.ts`:

```typescript
// 使用牌：统一的卡牌使用入口技能。
//
// 对齐文档 use.md 使用事件的结算流程：
//   使用结算前（对所有目标逐时机处理）：
//     选择目标时 → 置入处理区 → 使用时
//     → 逐目标：指定目标 → 成为目标 → 指定目标后 → 成为目标后
//   使用结算中（对单目标完整结算）：
//     → 检测有效性 → [cardEffect.resolve: 生效前响应 + 生效后效果]
//   使用结算后：
//     → 移出处理区
//
// 本技能注册 use action，validate 查 CardEffect 注册表做合法性检测，
// execute 调 runUseFlow 编排完整流程。
//
// 与现有卡牌技能并存：现有杀/决斗等仍各自注册 action。
// 迁移后，卡牌只需 registerCardEffect，不再注册 action。

import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction } from '../skill';
import type { SkillModule } from '../skill';
import { validateCardUse } from './validate';
import { getCardEffect, requireCardEffect } from './registry';
import type { ResolveCtx } from './registry';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '使用牌',
    description: '统一的卡牌使用入口',
  };
}

/**
 * runUseFlow:编排使用事件的完整结算流程（文档 use.md）。
 *
 * @param state     游戏状态
 * @param source    使用者
 * @param cardId    实体牌 id（须在手牌中）
 * @param targets   目标列表
 * @param cardName  牌名（查 CardEffect 注册表）
 */
export async function runUseFlow(
  state: GameState,
  source: number,
  cardId: string,
  targets: number[],
  cardName: string,
): Promise<void> {
  const effect = requireCardEffect(cardName);

  // ── 使用结算前 ──
  const frame = await pushFrame(state, cardName, source, {
    cardId,
    resolvedTargets: [...targets],
  });

  try {
    // 时机1：选择目标时（转化技 before-hook 可替换牌）
    await applyAtom(state, { type: '选择目标时', source, cardId, targets });

    // 置入处理区（基本牌/非延时锦囊牌 → 处理区）
    await applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: source },
      to: { zone: '处理区' },
    });

    // 时机2：使用时（集智/强识 after-hook 摸牌）
    await applyAtom(state, { type: '使用时', source, cardId });

    // 声明阶段：逐目标 指定目标
    for (const target of targets) {
      await applyAtom(state, { type: '指定目标', source, target, cardId });
    }

    // ── 使用结算中：逐目标完整结算 ──
    for (let i = 0; i < targets.length; i++) {
      // 从帧上读当前目标（流离等技能可能修改帧上的 resolvedTargets）
      const resolved = (frame.params.resolvedTargets as number[]) ?? targets;
      const target = resolved[i];
      if (!state.players[target]?.alive) continue;

      // 时机4：成为目标（空城等可 cancel）
      const becameTarget = await applyAtom(state, {
        type: '成为目标',
        source,
        target,
        cardId,
      });
      if (!becameTarget) continue;

      // 时机5：指定目标后（铁骑/烈弓/无双①/肉林①）
      await applyAtom(state, { type: '指定目标后', source, target, cardId });

      // 时机6：成为目标后（贞烈/啖酪/无双②/肉林②）
      await applyAtom(state, { type: '成为目标后', source, target, cardId });

      // 使用结算开始时：检测有效性（仁王盾/享乐）
      const valid = await applyAtom(state, {
        type: '检测有效性',
        source,
        target,
        cardId,
      });
      if (!valid) continue;

      // 生效前响应 + 生效后效果（cardEffect.resolve）
      const ctx: ResolveCtx = { state, source, target, cardId, targetIndex: i };
      await effect.resolve(ctx);
    }

    // ── 使用结算后：移出处理区 ──
    if (frameCards(state).includes(cardId)) {
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    }
  } finally {
    // 异常安全：保证牌不滞留处理区 + 帧弹出
    if (frameCards(state).includes(cardId)) {
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    }
    await popFrame(state);
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const card = state.cardMap[cardId];
      if (!card) return '牌不存在';
      const cardName = card.name;
      if (!getCardEffect(cardName)) return `${cardName} 尚未支持使用牌入口`;
      return validateCardUse(state, ownerId, params, cardName);
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const card = state.cardMap[cardId];
      const cardName = card.name;
      const targets = (params.targets as number[]) ?? [];
      await runUseFlow(state, ownerId, cardId, targets, cardName);
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): void {
  // 使用牌的 UI 由 CardEffect 注册表的 prompt/label/style/activeWhen 驱动。
  // 前端迁移后通过 cardEffectRegistry 获取这些数据替代 defineAction。
  // 本阶段 onMount 为空——现有卡牌仍各自 defineAction。
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
```

- [ ] **Step 2: 注册到 skills/index.ts**

在 `src/engine/skills/index.ts` 中添加：

```typescript
  使用牌: load(() => import('../card-effect/use-card')),
```

放在文件末尾的技能列表中（在 `}` 之前）。

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/engine/card-effect/use-card.ts src/engine/skills/index.ts
git commit -m "feat: 新增「使用牌」技能 + runUseFlow 编排函数"
```

---

## Task 5: 打出牌技能 + runPlayFlow

**Files:**
- Create: `src/engine/card-effect/play-card.ts`

"打出牌"是对应文档 play.md 的技能，处理"声明一张牌并置入处理区"的流程。它注册 respond action。

- [ ] **Step 1: 创建打出牌技能**

Create `src/engine/card-effect/play-card.ts`:

```typescript
// 打出牌：统一的卡牌打出入口技能。
//
// 对齐文档 play.md 打出事件的结算流程：
//   1. 声明打出的牌名时（转化技 before-hook 可替换）
//   2. 置入处理区
//   3. 打出牌时（雷击/涯角/银月枪 after-hook）
//
// 打出没有目标选择、没有效果结算——仅声明一张牌并置入处理区供调用方检查。
// 闪对万箭齐发是"打出"；杀对南蛮入侵/决斗是"打出"。
//
// 与使用牌的区别：使用有完整结算流程（目标/有效性/伤害），
// 打出仅置入处理区供调用方检查。

import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction } from '../skill';
import type { SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '打出牌',
    description: '统一的卡牌打出入口',
  };
}

/**
 * runPlayFlow:编排打出事件的完整结算流程（文档 play.md）。
 *
 * @param state   游戏状态
 * @param player  打出者
 * @param cardId  实体牌 id（须在手牌中）
 */
export async function runPlayFlow(
  state: GameState,
  player: number,
  cardId: string,
): Promise<void> {
  // 时机1：声明打出时（转化技 before-hook 可替换）
  await applyAtom(state, { type: '声明打出时', player, cardId });

  // 置入处理区
  await applyAtom(state, {
    type: '移动牌',
    cardId,
    from: { zone: '手牌', player },
    to: { zone: '处理区' },
  });

  // 时机2：打出牌时（雷击/涯角/银月枪 after-hook）
  await applyAtom(state, { type: '打出牌时', player, cardId });
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      // 打出牌响应询问闪/询问杀等 pending。
      // 校验：有 pending + 牌在手牌中 + 牌名匹配 pending 要求。
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';

      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';

      const self = state.players[ownerId];
      if (!self?.hand.includes(cardId)) return '牌不在手牌中';

      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      await runPlayFlow(state, ownerId, cardId);
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): void {}

export default { createSkill, onInit, onMount } satisfies SkillModule;
```

- [ ] **Step 2: 注册到 skills/index.ts**

在 `src/engine/skills/index.ts` 中添加：

```typescript
  打出牌: load(() => import('../card-effect/play-card')),
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/engine/card-effect/play-card.ts src/engine/skills/index.ts
git commit -m "feat: 新增「打出牌」技能 + runPlayFlow 编排函数"
```

---

## Task 6: 编写核心测试

**Files:**
- Create: `tests/skill-tests/使用牌.test.ts`

测试使用牌/打出牌技能和 runUseFlow/runPlayFlow 的正确性。使用现有的 SkillTestHarness。

- [ ] **Step 1: 编写使用牌核心测试**

Create `tests/skill-tests/使用牌.test.ts`:

```typescript
// 使用牌/打出牌核心技能测试：
//   1. 使用牌入口能正确路由到 CardEffect
//   2. runUseFlow 编排完整使用结算流程（时机 atom 按文档顺序触发）
//   3. runPlayFlow 编排打出流程（声明打出时→处理区→打出牌时）
//   4. 合法性检测三条件（禁用/次数/合法目标数）
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import { registerCardEffect } from '../../src/engine/card-effect/registry';
import { runUseFlow } from '../../src/engine/card-effect/use-card';
import { runPlayFlow } from '../../src/engine/card-effect/play-card';
import { applyAtom } from '../../src/engine/create-engine';

// 注册一张测试用牌的效果
registerCardEffect('测试杀', {
  timing: '出牌阶段',
  target: { kind: 'inAttackRange', min: 1, max: 1 },
  resolve: async (ctx) => {
    const { state, source, target, cardId } = ctx;
    await applyAtom(state, { type: '询问闪', target, source });
    const { frameCards } = await import('../../src/engine/create-engine');
    const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (dodgeIds.length === 0) {
      await applyAtom(state, {
        type: '造成伤害',
        target,
        amount: 1,
        source,
        cardId,
      });
    }
  },
  prompt: {
    type: 'useCardAndTarget',
    title: '测试杀',
    cardFilter: { filter: (c: Card) => c.name === '测试杀', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  },
  label: '测试杀',
  style: 'danger',
});

function makeCard(id: string, name: string, suit = '♠', rank = 'A'): Card {
  return {
    id,
    name,
    suit: suit as Card['suit'],
    color: suit === '♥' || suit === '♦' ? '红' : '黑',
    rank: rank as Card['rank'],
    type: '基本牌',
  };
}

function buildState(opts?: { p1Hand?: string[]; p2Hand?: string[]; extraCards?: Record<string, Card> }): GameState {
  const slash = makeCard('c1', '测试杀', '♠', 'A');
  return createGameState({
    players: [
      {
        index: 0,
        name: 'P1',
        character: '主公',
        faction: '群',
        role: '主公',
        health: 4,
        maxHealth: 4,
        hand: opts?.p1Hand ?? ['c1'],
        equipment: {},
        pendingTricks: [],
        skills: ['使用牌', '打出牌'],
        alive: true,
        tags: [],
        vars: {},
      },
      {
        index: 1,
        name: 'P2',
        character: '反贼',
        faction: '蜀',
        role: '反贼',
        health: 4,
        maxHealth: 4,
        hand: opts?.p2Hand ?? [],
        equipment: {},
        pendingTricks: [],
        skills: [],
        alive: true,
        tags: [],
        vars: {},
      },
    ],
    cardMap: { c1: slash, ...opts?.extraCards },
    deck: [],
    seed: 42,
  });
}

describe('使用牌/打出牌核心', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('runUseFlow: 使用测试杀 → 目标不出闪 → 受伤', async () => {
    const state = buildState();
    await harness.setup(state);
    await runUseFlow(state, 0, 'c1', [1], '测试杀');
    expect(state.players[1].health).toBe(3);
  });

  it('runPlayFlow: 打出牌触发声明打出时和打出牌时 atom', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state = buildState({ p1Hand: ['d1'], extraCards: { d1: dodge } });
    await harness.setup(state);

    // runPlayFlow 不需要 pending slot——直接调用
    await runPlayFlow(state, 0, 'd1');

    // 验证牌已进入处理区（在当前帧中）
    const { frameCards } = await import('../../src/engine/create-engine');
    // 无帧时 fallback 到 zones.processing
    expect(state.zones.processing).toContain('d1');
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/skill-tests/使用牌.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/skill-tests/使用牌.test.ts
git commit -m "test: 使用牌/打出牌核心技能测试"
```

---

## Task 7: 全量回归验证

**Files:**
- Test: 全部

- [ ] **Step 1: 运行全部测试**

Run: `npx vitest run`
Expected: 全部 PASS（新技能与现有技能并存，零行为变化）

- [ ] **Step 2: 如有失败，修复**

新技能注册了 action 但不影响现有卡牌——因为现有卡牌仍各自注册各自的 use/respond action。前端仍通过 `findUseActionForCard` 匹配现有卡牌的 action（使用牌/打出牌还没有 CardEffect 注册，不会出现在 cardFilter 中）。

可能的失败：
- `使用牌`/`打出牌` 被 DEFAULT_SKILLS 加载为每个玩家的固有技能——检查是否导致多余 UI 按钮。如果是，在前端 `findUseActionForCard` 中跳过 skillId='使用牌'/'打出牌'。

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: 核心回归修复"
```

---

## 后续迁移阶段（不在本计划范围内，记录路线图）

### Phase M1: 迁移杀

1. 注册 `杀` 的 CardEffect（含 timing/target/canUse/resolve/prompt）
2. 杀的 resolve 内部复用现有结算逻辑（询问闪→检查处理区→伤害/抵消）
3. 删除杀.ts 的 use/respond action 注册
4. 无双/肉林改 hook 注册（挂 指定目标后/成为目标后/询问闪 after-hook）
5. 前端路由：findUseActionForCard 改为查 CardEffect 注册表

### Phase M2: 迁移闪

1. 注册 `闪` 的 CardEffect（timing='杀生效前'）
2. 闪走打出牌入口（respond → runPlayFlow）
3. 雷击迁移到 打出牌时 after-hook
4. 八卦阵虚拟闪触发 打出牌时 atom

### Phase M3: 迁移桃/酒

### Phase M4: 迁移普通锦囊（决斗/无中生有/顺手牵羊/过河拆桥/借刀杀人/火攻）

### Phase M5: 迁移全体锦囊（万箭齐发/南蛮入侵/桃园结义/五谷丰登）

### Phase M6: 迁移延时锦囊（乐不思蜀/兵粮寸断/闪电）

### Phase M7: 迁移 9 个 virtualKill 复制

神速/界神速/界仁德/界乱武/乱武/界惴恐/界明策/界求援/界眩惑/界诛害/蛊惑/界蛊惑

### Phase M8: 前端完全切换到 CardEffect 注册表 UI

---

## 验收标准

1. **使用牌技能注册 use action，通过 CardEffect 注册表路由**
2. **打出牌技能注册 respond action，执行 runPlayFlow**
3. **CardEffect 注册表含牌面元数据（timing/target/canUse/resolve）**
4. **合法性检测 helper 覆盖 condition.md 三条件**
5. **6 个新时机 atom 存在且可被 hook**
6. **runUseFlow 编排文档 use.md 完整流程（含全部时机 atom）**
7. **全部现有测试通过（零行为变化）**
8. **使用牌/打出牌与现有卡牌技能并存，互不干扰**
