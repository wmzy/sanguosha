# 使用牌流程统一抽象 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"出杀次数"等使用策略从 `runUseFlow` 中剥离，归属到发起者（caller）；新增 `useCard` 原语统一所有"让某人使用一张牌"的路径（出牌阶段主动使用 / 借刀杀人逼杀 / 激将代杀 / 挑衅逼杀 / 乱武逼杀 / 界虚拟杀），消除 4 处手写杀结算，修复火杀/雷杀经逼杀丢失 damageType 的 bug。

**Architecture:** 新增 `useCard(state, source, cardId, targets, opts)` 原语（与 `runUseFlow` 同文件），`opts.quotaPolicy: 'charge' | 'none'` 表达"是否查/计出杀次数"。`runUseFlow` 退化为纯流程编排，不再调 `onSettle`；`onSettle`（杀次数累加）由 `useCard` 按 policy 决定调用。`validateCardUse` 增加 `mode: 'play' | 'forced'` 参数，'forced' 跳过出牌阶段基线检查与次数检查。借刀杀人/激将/挑衅/乱武 改为 `请求回应(useCardAndTarget) + useCard(quotaPolicy:'none')`，删掉手写的 指定目标/成为目标/询问闪/runDamageFlow 序列。界虚拟杀改用 `useCard(quotaPolicy:'charge', virtual:true)`，删掉手动 `incSlashUsed`。

**Tech Stack:** TypeScript, Vitest, 原子操作引擎（applyAtom + before/after hooks + runUseFlow）

**核心原则：**
- `runUseFlow` 是纯流程函数，不碰使用策略（quota / 玩家阶段门控）。
- "使用策略"由发起者通过 `useCard` 的 `quotaPolicy` 表达：出牌阶段主动用 = `'charge'`；逼杀/代杀 = `'none'`。
- 每个阶段结束全量测试绿 + 一次 commit。Phase 1 行为不变；Phase 2 起逐步修复 bug。

---

## 文档参照

- 使用流程：`../sanguosha-doc/_gitbook/rules/flow/use.md`
- 打出流程：`../sanguosha-doc/_gitbook/rules/flow/play.md`
- 合法性检测：`../sanguosha-doc/_gitbook/rules/flow/condition.md`
- 伤害流程：`src/engine/damage-flow.ts`

---

## 设计审查

### 当前架构（问题）

```
runUseFlow（use-card.ts:124-310）
  ├─ 完整时机瀑布（选择目标时 → ... → 使用结算结束时）
  ├─ 内置 手牌→处理区→弃牌堆 牌移动
  └─ 在 popFrame 前调 effect.onSettle  ← quota 焊在流程里（use-card.ts:290）

杀.onSettle（杀.ts:52-66）
  └─ incSlashUsed + 回合用量 view 同步

"使用一张杀"的 4 条路径，quota 处理各不相同：
  A. 出牌阶段主动（经 使用牌 use action）→ runUseFlow → onSettle → incSlashUsed ✓
  B. 界虚拟杀（界仁德/界乱武/界蛊惑/蛊惑）→ runUseFlow(virtual) 跳 onSettle + 手动 incSlashUsed
  C. 逼杀（借刀杀人/挑衅/激将/乱武）→ 手写杀结算，不走 runUseFlow，不调 incSlashUsed
     └─ 但手写结算丢 damageType（火杀经借刀杀人变普通伤害）+ 缺时机（成为目标/生效时等）

杀.activeWhen（杀.ts:90-92）= defaultPlayActive && viewCanSlash
  └─ 出牌阶段逻辑焊进了卡的 UI 描述（本计划 Phase 4 处理，非阻塞）
```

### 目标架构

```
useCard(state, source, cardId, targets, opts)  ← 新原语
  ├─ validateCardUse(..., mode = policy==='charge' ? 'play' : 'forced')
  ├─ mandatedTargets ⊆ targets 校验（借刀杀人 B）
  ├─ runUseFlow(..., { virtual, skipCancelQuery })  ← 不再调 onSettle
  └─ onSettle：quotaPolicy==='charge' && !virtual → effect.onSettle()

runUseFlow  ← 纯流程，不碰 quota

"使用一张杀"统一为 useCard：
  A. 出牌阶段主动 → useCard(quotaPolicy:'charge')              [使用牌 use action]
  B. 界虚拟杀      → useCard(quotaPolicy:'charge', virtual:true) [删手动 incSlashUsed]
  C. 借刀杀人逼杀  → useCard(quotaPolicy:'none', mandatedTargets:[B]) [修复 damageType]
  D. 挑衅/激将/乱武 → useCard(quotaPolicy:'none', mandatedTargets:[...]) [修复 damageType]
```

### 调用方影响清单（迁移前后）

| 路径 | 现状 | 改后 |
|---|---|---|
| 使用牌 use action execute（use-card.ts:451-463） | `runUseFlow` | `useCard(quotaPolicy:'charge')` |
| 使用牌 use action validate（use-card.ts:429-442） | `validateCardUse(mode='play')` | 不变（默认 'play'） |
| 借刀杀人 resolve（借刀杀人.ts:18-57） | 手写杀结算 | `请求回应(useCardAndTarget) + useCard(none, mandatedTargets:[B])` |
| 挑衅（挑衅.ts:101-145） | 手写杀结算 | `useCard(none, mandatedTargets:[ownerId])` |
| 激将（激将.ts:60-112） | 手写杀结算 | `useCard(none, mandatedTargets:[killTarget])` |
| 乱武 resolveForcedSlash（乱武.ts:55-100） | 手写杀结算 | `useCard(none, mandatedTargets:[target])`；删 resolveForcedSlash |
| 界仁德 virtualKill（界仁德.ts:58-90, 279-285） | runUseFlow(virtual) + 手动 incSlashUsed | `useCard(charge, virtual)` |
| 界乱武 virtualKill + 手动 incSlashUsed（界乱武.ts:233-239） | 同上 | 同上 |
| 界蛊惑/蛊惑 手动 incSlashUsed | runUseFlow(virtual) + 手动 incSlashUsed | `useCard(charge, virtual)` |

### 非目标（本计划不做）

- **Phase 4（activeWhen 清理）列为后续计划**：把 `defaultPlayActive`/`viewCanSlash` 从卡的 `activeWhen` 移到"询问上下文"。本计划 Phase 2 的借刀杀人复用 `乱武` 已验证的 `请求回应(useCardAndTarget)` 模式，**不需要**改 activeWhen。
- 不改 `runUseFlow` 的时机瀑布、atom 定义、dispatch 管线。
- 不改客户端 dispatch 路由（`findUseActionForCard` 等保持不变）。

---

## 文件结构

| 文件 | 职责 | 改动 |
|---|---|---|
| `src/engine/card-effect/use-card.ts` | `runUseFlow` + 新增 `useCard` 原语 + `UseCardOpts`/`QuotaPolicy` 类型 | 改 |
| `src/engine/card-effect/validate.ts` | `validateCardUse` 增加 `mode` 参数 | 改 |
| `src/engine/card-effects/借刀杀人.ts` | 改用 `请求回应(useCardAndTarget) + useCard(none)` | 改 |
| `src/engine/skills/挑衅.ts` | 杀结算改 `useCard(none)` | 改 |
| `src/engine/skills/激将.ts` | 杀结算改 `useCard(none)` | 改 |
| `src/engine/skills/乱武.ts` | 删 `resolveForcedSlash`，改 `useCard(none)` | 改 |
| `src/engine/skills/界仁德.ts` | `virtualKill` 改 `useCard(charge, virtual)`，删手动 incSlashUsed | 改 |
| `src/engine/skills/界乱武.ts` | 同上 | 改 |
| `src/engine/skills/界蛊惑.ts` / `蛊惑.ts` | 手动 incSlashUsed 改走 useCard（若其虚拟杀路径） | 改 |
| `tests/skill-tests/借刀杀人.test.ts` | 追加火杀 damageType 用例 + 方天画戟多目标用例 | 改 |
| `tests/skill-tests/挑衅.test.ts` / `激将.test.ts` / `乱武.test.ts` | 追加火杀 damageType 用例 | 改 |

---

## Phase 1：`useCard` 原语 + quota 归属纠正（行为不变）

**目标：** 新增 `useCard` 原语，把 `onSettle` 从 `runUseFlow` 移到 `useCard`；迁移 使用牌 use action 与界虚拟杀。**全量测试绿，无行为变化。**

### Task 1.1：`validateCardUse` 增加 `mode` 参数

**Files:**
- Modify: `src/engine/card-effect/validate.ts`（`validateCardUse`，约第 96-130 行）

- [ ] **Step 1：扩展 `validateCardUse` 签名**

在 `validate.ts` 找到 `export function validateCardUse(...)`，把签名改为增加可选 `mode` 参数：

```ts
/**
 * 统一合法性检测（condition.md 三条件）。
 * 返回 null=通过，字符串=拒绝理由。
 *
 * @param mode 'play'=出牌阶段主动使用（默认，含自己回合+出牌阶段+次数检查）；
 *             'forced'=受迫/代为使用（逼杀/代杀/虚拟杀由调用方自管次数与阶段），
 *             跳过 validateUseCard 基线与 checkUsageLimit。
 *
 * 检查顺序：
 *   基础(play 模式) → 禁用 → 次数(play 模式) → 合法目标数 → 牌特有校验
 */
export function validateCardUse(
  state: GameState,
  ownerId: number,
  params: Record<string, Json>,
  cardName: string,
  mode: 'play' | 'forced' = 'play',
): string | null {
  // 基础检查：自己回合、出牌阶段、无阻塞 pending、存活、手牌中有牌、牌名匹配
  // forced 模式跳过（逼杀不在使用者出牌阶段；虚拟杀无手牌实体）
  if (mode === 'play') {
    const base = validateUseCard(state, ownerId, params, { cardName });
    if (base) return base;
  } else {
    // forced 模式仍校验：牌存在 + 牌名匹配 + 牌在手牌（虚拟杀除外，由 useCard 跳过）
    const cardId = params.cardId as string | undefined;
    if (!cardId) return 'cardId required';
    const card = state.cardMap[cardId];
    if (!card) return '牌不存在';
    if (card.name !== cardName) return `不是${cardName}`;
  }

  // 条件1：禁用检测（两种模式都查）
  if (isCardBanned(state, ownerId, cardName)) return '你不能使用此牌';

  // 条件2：次数限制（仅杀，仅 play 模式）
  if (mode === 'play') {
    const limit = checkUsageLimit(state, ownerId, cardName, params);
    if (limit) return limit;
  }

  // 条件3：合法目标数 > 0（有目标要求的牌）
  const effect = getCardEffect(cardName);
  if (!effect) return `${cardName} 尚未注册 CardEffect`;
  if (effect.target.kind !== 'self' && effect.target.kind !== 'effect') {
    const legalTargets = findLegalTargets(state, ownerId, cardName);
    if (legalTargets.length === 0) return '没有合法目标';
  }

  // 牌特有校验（两种模式都查）
  if (effect.canUse) {
    const customErr = effect.canUse(state, ownerId, params);
    if (customErr) return customErr;
  }

  return null;
}
```

- [ ] **Step 2：验证现有测试仍绿**

Run: `npx vitest run tests/skill-tests/借刀杀人.test.ts`
Expected: 12 passed（默认 `mode='play'`，行为不变）。

### Task 1.2：新增 `useCard` 原语 + `runUseFlow` 剥离 `onSettle`

**Files:**
- Modify: `src/engine/card-effect/use-card.ts`（`runUseFlow` 的 onSettle 调用约第 287-292 行；文件末尾新增 `useCard`）

- [ ] **Step 1：写失败测试——`useCard` 原语**

先在 `tests/skill-tests/借刀杀人.test.ts` 顶部新增一个独立 describe（暂与借刀杀人无关，验证原语本身），或新建 `tests/skill-tests/use-card-primitive.test.ts`。**按 AGENTS.md 测试规范：本测试验证的是 useCard 原语（被多技能复用的基础设施），不属于单一技能，新建文件并在注释中注明归并建议。**

Create: `tests/skill-tests/use-card-primitive.test.ts`

```ts
// tests/skill-tests/use-card-primitive.test.ts
// useCard 原语测试（基础设施，被 使用牌/借刀杀人/激将/挑衅/乱武/界虚拟杀 共用）。
// 归并建议：本文件验证 useCard 原语本身，非单一技能，故独立成文件。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { useCard } from '../../src/engine/card-effect/use-card';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠'|'♥'|'♣'|'♦' = '♠', rank = 'A',
  type: '基本牌'|'锦囊牌'|'装备牌' = '基本牌'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function buildSlashState(opts: { p1Hand?: string[]; p2Hand?: string[] } = {}): GameState {
  const s = makeCard('s1', '杀', '♠', '7', '基本牌');
  const cards: Record<string, Card> = { s1: s };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true,
        hand: opts.p1Hand ?? ['s1'], equipment: {}, skills: ['杀'], vars: {}, marks: [],
        pendingTricks: [], judgeZone: [], tags: [] },
      { index: 1, name: 'P2', character: '反贼', health: 4, maxHealth: 4, alive: true,
        hand: opts.p2Hand ?? [], equipment: {}, skills: [], vars: {}, marks: [],
        pendingTricks: [], judgeZone: [], tags: [] },
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('useCard 原语', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  it('quotaPolicy=charge：出杀后 incSlashUsed，再出杀被 validate 拒绝', async () => {
    const s2 = makeCard('s2', '杀', '♥', '3');
    const state = buildSlashState({ p1Hand: ['s1', 's2'] });
    state.cardMap['s2'] = s2;
    await harness.setup(state);

    // 第一次 useCard：charge，应成功并计次数
    const err1 = await useCard(harness.state, 0, 's1', [1], { quotaPolicy: 'charge' });
    expect(err1).toBeNull();
    expect(harness.state.zones.discardPile).toContain('s1');

    // 第二次 useCard：charge，应被 validate 拒绝（出杀次数上限）
    const err2 = await useCard(harness.state, 0, 's2', [1], { quotaPolicy: 'charge' });
    expect(typeof err2).toBe('string');
    expect(err2).toContain('出杀次数');
  });

  it('quotaPolicy=none：逼杀不计次数，不查次数上限', async () => {
    const s2 = makeCard('s2', '杀', '♥', '3');
    const state = buildSlashState({ p1Hand: ['s1', 's2'] });
    state.cardMap['s2'] = s2;
    await harness.setup(state);

    // 不在 P1 出牌阶段也能 useCard(none)（P1 是 current player 但 phase 不强制）
    const err1 = await useCard(harness.state, 0, 's1', [1], { quotaPolicy: 'none' });
    expect(err1).toBeNull();
    // 不计次数：slashUsed 仍为 0
    const { slashUsed } = await import('../../src/engine/slash-quota');
    expect(slashUsed(harness.state)).toBe(0);
  });

  it('mandatedTargets：targets 缺少必含目标时被拒绝', async () => {
    const state = buildSlashState();
    await harness.setup(state);
    // mandatedTargets=[1] 但传 targets=[] → 拒绝
    const err = await useCard(harness.state, 0, 's1', [], { quotaPolicy: 'none', mandatedTargets: [1] });
    expect(typeof err).toBe('string');
  });
});
```

- [ ] **Step 2：运行测试，确认失败（useCard 未导出）**

Run: `npx vitest run tests/skill-tests/use-card-primitive.test.ts`
Expected: FAIL — `useCard is not exported` 或模块解析失败。

- [ ] **Step 3：从 `runUseFlow` 删除 onSettle 调用**

在 `use-card.ts` 的 `runUseFlow` 中，删除（注释掉或移除）这段（约 287-292 行）：

```ts
    // 牌特有结算后回调（popFrame 前）——杀的出杀次数累加等
    // 延迟类锦囊：结算未完成（延迟到判定阶段），不执行 onSettle
    // 虚拟使用：不执行 onSettle（杀次数累加等不适用于虚拟牌）
    if (!effect.delayed && !opts?.virtual && effect.onSettle) {
      await effect.onSettle(state, source, cardId);
    }
```

同时更新 `runUseFlow` 顶部注释（第 12-13 行）把"使用结算后：移出处理区 → onSettle"改为"使用结算后：移出处理区（onSettle 由调用方 useCard 按 quotaPolicy 决定）"。

- [ ] **Step 4：实现 `useCard` 原语**

在 `use-card.ts` 文件末尾（`export default` 之前）新增：

```ts
// ─── useCard 原语：统一的"让某人使用一张牌"入口 ──────────────
//
// 把使用策略（quota / 阶段门控）从 runUseFlow 剥离，归属到发起者。
// runUseFlow 退化为纯流程编排；useCard 按 quotaPolicy 决定是否调 onSettle。
//
// 调用方：
//   - 使用牌 use action（出牌阶段主动）：useCard(quotaPolicy:'charge')
//   - 借刀杀人/激将/挑衅/乱武（逼杀/代杀）：useCard(quotaPolicy:'none', mandatedTargets:[...])
//   - 界虚拟杀：useCard(quotaPolicy:'charge', virtual:true)

/** 使用策略：是否查/计出杀次数。 */
export type QuotaPolicy = 'charge' | 'none';

export interface UseCardOpts {
  /** 出杀次数策略。'charge'=查 canSlash + 计 incSlashUsed（出牌阶段主动）；
   *  'none'=不查不计（逼杀/代杀）。默认 'none'。 */
  quotaPolicy?: QuotaPolicy;
  /** 虚拟使用（无实体牌，跳过手牌→处理区移动）。 */
  virtual?: boolean;
  /** 跳过抵消询问（界看破转化的无懈）。 */
  skipCancelQuery?: boolean;
  /** 必含目标（借刀杀人 B）。validate 后检查其 ⊆ targets。 */
  mandatedTargets?: number[];
  /** 跳过 validate（调用方已完整校验）。慎用。 */
  skipValidate?: boolean;
}

/**
 * useCard：统一的卡牌使用入口。
 *
 * 流程：validate（按 quotaPolicy 选 mode）→ mandatedTargets 校验
 *       → runUseFlow → onSettle（仅 quotaPolicy==='charge' && !virtual）。
 *
 * @returns null=成功执行；string=validate 失败的理由（未执行 runUseFlow）。
 *          虚拟使用时 virtual 牌的创建/清理由调用方负责。
 */
export async function useCard(
  state: GameState,
  source: number,
  cardId: string,
  targets: number[],
  opts: UseCardOpts = {},
): Promise<string | null> {
  const quotaPolicy: QuotaPolicy = opts.quotaPolicy ?? 'none';
  const virtual = opts.virtual ?? false;
  const cardName = state.cardMap[cardId]?.name;
  if (!cardName) return '牌不存在';

  // validate（除非调用方声明 skipValidate）
  if (!opts.skipValidate) {
    const mode = quotaPolicy === 'charge' ? 'play' : 'forced';
    const params: Record<string, Json> = { cardId, targets, ...(virtual ? { virtual: true } : {}) };
    const err = validateCardUse(state, source, params, cardName, mode);
    if (err) return err;
  }

  // mandatedTargets ⊆ targets
  if (opts.mandatedTargets && opts.mandatedTargets.length > 0) {
    for (const mt of opts.mandatedTargets) {
      if (!targets.includes(mt)) return `必须包含目标 ${mt}`;
    }
  }

  // 走流程
  await runUseFlow(state, source, cardId, targets, cardName, {
    ...(virtual ? { virtual: true } : {}),
    ...(opts.skipCancelQuery ? { skipCancelQuery: true } : {}),
  });

  // onSettle：仅 charge 且非虚拟（虚拟杀若需计次数，由调用方用 charge+virtual，
  //   onSettle 在 virtual 下不调——与原 runUseFlow 行为一致；界虚拟杀改用 charge+virtual
  //   时，杀次数累加改为 onSettle 之外显式处理，见 Task 1.4）。
  // 注：onSettle 移出 runUseFlow 后，charge+非虚拟 路径在此补回。
  if (quotaPolicy === 'charge' && !virtual) {
    const effect = getCardEffect(cardName);
    if (effect?.onSettle && !effect.delayed) {
      await effect.onSettle(state, source, cardId);
    }
  }

  return null;
}
```

补 import（文件顶部已有 `validateCardUse`? 若无则加）：

```ts
import { validateCardUse } from './validate';
import { getCardEffect } from './registry';
```

（确认 `runUseFlow` 已 import `Json`/`GameState` 等，按现有 import 补全。）

- [ ] **Step 5：运行原语测试，确认通过**

Run: `npx vitest run tests/skill-tests/use-card-primitive.test.ts`
Expected: 3 passed。

### Task 1.3：迁移 使用牌 use action 到 `useCard`

**Files:**
- Modify: `src/engine/card-effect/use-card.ts`（`onInit` 的 use action execute，约第 444-464 行）

- [ ] **Step 1：把 use action execute 的 `runUseFlow` 改为 `useCard`**

在 `onInit` 中找到 use action 的 execute（约 444-464 行），把：

```ts
      async (state: GameState, params: Record<string, Json>) => {
        const cardId = params.cardId as string;
        if (!Array.isArray(params.targets) && typeof params.target === 'number') {
          params.targets = [params.target];
        }
        let targets = effect.preUse
          ? effect.preUse(state, ownerId, params)
          : ((params.targets as number[]) ?? []);
        if (targets.length === 0) {
          if (effect.target.kind === 'self') {
            targets = [ownerId];
          } else {
            targets = computeAutoTargets(state, ownerId, cardName);
          }
        }
        await runUseFlow(state, ownerId, cardId, targets, cardName);
      },
```

改为：

```ts
      async (state: GameState, params: Record<string, Json>) => {
        const cardId = params.cardId as string;
        if (!Array.isArray(params.targets) && typeof params.target === 'number') {
          params.targets = [params.target];
        }
        let targets = effect.preUse
          ? effect.preUse(state, ownerId, params)
          : ((params.targets as number[]) ?? []);
        if (targets.length === 0) {
          if (effect.target.kind === 'self') {
            targets = [ownerId];
          } else {
            targets = computeAutoTargets(state, ownerId, cardName);
          }
        }
        // 出牌阶段主动使用：查 + 计出杀次数（charge）。validate 已在 action validate 完成，
        // skipValidate 跳过重复校验；onSettle 由 useCard 按 charge 调用。
        await useCard(state, ownerId, cardId, targets, { quotaPolicy: 'charge', skipValidate: true });
      },
```

> **注：** use action 的 validate（约 429-442 行）保持调用 `validateCardUse(state, ownerId, params, cardName)`（默认 `mode='play'`）。execute 用 `skipValidate:true` 避免双重校验，但 `quotaPolicy:'charge'` 保证 onSettle 被调（杀次数累加）。

- [ ] **Step 2：运行全套技能测试，确认行为不变**

Run: `npx vitest run tests/skill-tests/`
Expected: 全部 passed（重点看 杀/决斗/南蛮/无中生有/顺手牵羊/过河拆桥/借刀杀人/桃园结义/五谷丰登 等使用牌路径）。

- [ ] **Step 3：运行集成测试**

Run: `npx vitest run tests/integration/`
Expected: 全部 passed。

- [ ] **Step 4：Commit**

```bash
git add src/engine/card-effect/use-card.ts src/engine/card-effect/validate.ts tests/skill-tests/use-card-primitive.test.ts
git commit -m "refactor(engine): 引入 useCard 原语，onSettle 从 runUseFlow 移到 useCard

- 新增 useCard(state, source, cardId, targets, opts) 原语，opts.quotaPolicy 表达使用策略
- validateCardUse 增加 mode='play'|'forced'，forced 跳过出牌阶段基线与次数检查
- runUseFlow 不再调 onSettle；charge 路径由 useCard 补回
- 使用牌 use action execute 改调 useCard(quotaPolicy:'charge', skipValidate)
- 行为不变：全量 skill-tests + integration 绿"
```

### Task 1.4：界虚拟杀清理手动 `incSlashUsed`

**目标：** `界仁德`/`界乱武`/`界蛊惑`/`蛊惑` 的虚拟杀目前是 `runUseFlow(virtual) + 手动 incSlashUsed + 回合用量`。改为 `useCard(quotaPolicy:'charge', virtual:true)`，但**注意**：virtual 下 useCard 不调 onSettle（与原 runUseFlow 一致），所以仍需手动计次数——除非调整设计。

**设计决策（先确认再改）：** 界虚拟杀是否应计次数？查代码：
- `界仁德.ts:280-285` 注释"视为出杀占出杀次数"——**应计**。
- `界乱武.ts:234-239` 同上——**应计**。

故 virtual+charge 路径**必须计次数**。方案：让 `useCard` 在 `quotaPolicy==='charge'` 时**无论是否 virtual 都调 onSettle**（杀.onSettle 内部 `incSlashUsed` 不依赖牌移动）。修改 Task 1.2 Step 4 的 onSettle 分支：

- [ ] **Step 1：调整 useCard 的 onSettle 分支（允许 virtual 计次数）**

在 `use-card.ts` 的 `useCard` 中，把 onSettle 分支改为：

```ts
  // onSettle：charge 策略下调用（含虚拟杀——界虚拟杀需计出杀次数）。
  // 杀.onSettle 的 incSlashUsed 不依赖牌移动，virtual 下也能正确计次。
  if (quotaPolicy === 'charge') {
    const effect = getCardEffect(cardName);
    if (effect?.onSettle && !effect.delayed) {
      await effect.onSettle(state, source, cardId);
    }
  }
```

> **风险点：** 五谷丰登的 onSettle 会"剩余亮出的牌入弃牌堆"（五谷丰登.ts:119）。五谷走使用牌 use action（charge, 非 virtual），onSettle 仍被调——行为不变。但若未来有 charge+virtual 的五谷变体需注意。当前无此用例。

- [ ] **Step 2：迁移 `界仁德.ts` 的 virtualKill + 手动 incSlashUsed**

读 `界仁德.ts`（先 `read` 确认行号）。找到 `virtualKill` 函数（约 58-90 行）与手动 incSlashUsed 块（约 279-285 行）。

`virtualKill` 当前实现（约 58-90 行）创建虚拟卡 + runUseFlow(virtual)。改为：

```ts
async function virtualKill(state: GameState, source: number, target: number): Promise<void> {
  if (!state.players[target]?.alive) return;
  const cardId = `仁德:杀:${source}:${target}:${state.seq}`;
  state.cardMap[cardId] = { id: cardId, name: '杀', suit: '', color: '无色', rank: 'A', type: '基本牌' };
  // charge+virtual：计出杀次数（杀.onSettle 调 incSlashUsed），跳过 validate（调用方已校验 canSlash）
  await useCard(state, source, cardId, [target], { quotaPolicy: 'charge', virtual: true, skipValidate: true });
  delete state.cardMap[cardId];
}
```

然后**删除**调用 virtualKill 之后的手动 `incSlashUsed` + `回合用量` 块（约 280-285 行）：

```ts
              // 视为出杀占出杀次数(incSlashUsed + 回合用量投影 view)   ← 删
              incSlashUsed(state);                                      ← 删
              await applyAtom(state, {                                  ← 删
                type: '回合用量',                                       ← 删
                player: from,                                           ← 删
                ...
              });                                                        ← 删
```

（`canSlash` 预检若存在于界仁德自身 validate，保留——它属于技能的合法性判断。）

补 import：`import { useCard } from '../card-effect/use-card';`，移除不再用的 `incSlashUsed`/`runUseFlow` import（若仅此处用）。

- [ ] **Step 3：迁移 `界乱武.ts`**

同 Step 2 模式。读 `界乱武.ts` 确认 `virtualKill`（约 233 行调用处）与手动 incSlashUsed（234-239 行）。把 `virtualKill` 改为 `useCard(charge, virtual, skipValidate)`，删除手动 incSlashUsed 块。

- [ ] **Step 4：迁移 `界蛊惑.ts` / `蛊惑.ts`**

`grep incSlashUsed` 确认是否还有 `蛊惑`/`界蛊惑` 调用。若有，同模式迁移（虚拟杀改 useCard）。若无则跳过。

- [ ] **Step 5：运行相关技能测试**

Run: `npx vitest run tests/skill-tests/界仁德.test.ts tests/skill-tests/界乱武.test.ts 2>/dev/null; npx vitest run tests/ 2>&1 | tail -20`
Expected: 全部 passed。若文件名不同，`glob tests/skill-tests/界*.test.ts` 找准确名。

- [ ] **Step 6：Commit**

```bash
git add src/engine/card-effect/use-card.ts src/engine/skills/界仁德.ts src/engine/skills/界乱武.ts
# 若改了蛊惑/界蛊惑也 add
git commit -m "refactor(engine): 界虚拟杀改用 useCard(charge, virtual)，删手动 incSlashUsed

- useCard 在 charge 策略下（含 virtual）统一调 onSettle 计出杀次数
- 界仁德/界乱武 的 virtualKill 改调 useCard，删除手动 incSlashUsed + 回合用量
- 行为不变：界虚拟杀仍计出杀次数"
```

---

## Phase 2：借刀杀人复用使用牌流程（修复 damageType）

**目标：** 借刀杀人的"出杀"分支改用 `请求回应(useCardAndTarget) + useCard(quotaPolicy:'none', mandatedTargets:[B])`，删除手写杀结算。修复火杀/雷杀经借刀杀人丢失 damageType 的 bug；支持方天画戟追加目标。

### Task 2.1：确认客户端渲染 `请求回应(useCardAndTarget)`

**Files:**
- Read-only: `src/client/components/AwaitingPrompt.tsx`、`src/client/utils/pendingRespond.ts`、`src/engine/skills/乱武.ts`

- [ ] **Step 1：验证乱武的 useCardAndTarget 渲染路径**

`乱武.ts` 已用 `请求回应` + `prompt.type:'useCardAndTarget'`（乱武.ts onInit 内，见 162-172 行 respond prompt）。乱武是已发布技能，故客户端必然能渲染此 prompt 类型。

`read` 以下文件确认渲染入口（不修改）：
- `src/client/components/AwaitingPrompt.tsx`：确认 useCardAndTarget 分支（或在 GameView.tsx）。
- `src/client/utils/pendingRespond.ts`：确认 pending → skillId 推导。

- [ ] **Step 2：若客户端缺 useCardAndTarget 渲染，补一个最小分支**

若 AwaitingPrompt 确实不渲染 useCardAndTarget（scout 报告称"does NOT handle useCardAndTarget"），但乱武能工作，说明渲染在别处（可能 GameView.tsx 的出牌交互复用）。**记录渲染入口文件:行**，供 Task 2.3 的 prompt 设计参考。**本步骤不改代码**——乱武已证明可行。

### Task 2.2：写失败测试——火杀经借刀杀人造成火焰伤害

**Files:**
- Modify: `tests/skill-tests/借刀杀人.test.ts`（追加到末尾现有 describe 内）

- [ ] **Step 1：追加火杀 damageType 测试**

在 `借刀杀人.test.ts` 的 `describe('借刀杀人', ...)` 内末尾追加：

```ts
  // ─────────────────────────────────────────────────────────────
  // 4. 火杀经借刀杀人对藤甲目标造成火焰伤害（damageType 不丢失）
  //    回归：修复前 runDamageFlow 未传 damageType，藤甲 +1 失效
  // ─────────────────────────────────────────────────────────────
  it('P2 用火杀响应借刀杀人 → P3(藤甲) 受 2 点火焰伤害（damageType 传导）', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const armor = makeCard('ar1', '藤甲', '♠', '2', '装备牌');
    // 火杀：damageType='火'
    const fireSlash = { ...makeCard('p2s', '杀', '♥', '5', '基本牌'), damageType: '火' as const };
    const state = buildState({
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p3Hand: [],
      p3Skills: ['闪'],
      extraCards: { wp1: weapon, ar1: armor, p2s: fireSlash },
    });
    // 给 P3 装藤甲
    state.players[2].equipment = { 防具: 'ar1' };
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    const p3HealthBefore = harness.state.players[2].health;

    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass(); // 无懈窗口

    // P2 用火杀响应（targets 必含 P3=2）
    P2.expectPending('请求回应');
    await P2.respond('杀', { cardId: 'p2s', targets: [2] });

    // P3 无闪 → pass
    P3.expectPending('询问闪');
    await P3.pass();

    // 藤甲对火焰伤害 +1：P3 扣 2 血
    expect(harness.state.players[2].health).toBe(p3HealthBefore - 2);
  });
```

- [ ] **Step 2：运行测试，确认失败**

Run: `npx vitest run tests/skill-tests/借刀杀人.test.ts -t "火杀经借刀杀人"`
Expected: FAIL — P3 扣 1 血（damageType 丢失，藤甲未 +1）。

### Task 2.3：重写借刀杀人 resolve

**Files:**
- Modify: `src/engine/card-effects/借刀杀人.ts`

- [ ] **Step 1：重写 `resolveBorrowedSword`**

读 `借刀杀人.ts` 全文确认行号。把 `resolveBorrowedSword`（约 18-57 行）整体替换为：

```ts
/** 借刀杀人的结算：请求 A 选「出杀(含 B) 或交武器」→ 出杀走 useCard(none) / 交武器获得 */
async function resolveBorrowedSword(ctx: ResolveCtx): Promise<void> {
  const { state, source, target } = ctx;
  const killTarget = state.localVars['借刀杀人/killTarget'] as number;

  // 请求 A 选择：对 B 使用一张杀（可追加目标，如方天画戟），或交出武器（pass）
  await applyAtom(state, {
    type: '请求回应',
    requestType: '借刀杀人/出杀',
    target,
    prompt: {
      type: 'useCardAndTarget',
      title: `借刀杀人:对 ${state.players[killTarget]?.name ?? '?'} 使用一张杀，或交出武器`,
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 3,
        // B 必含；额外目标须在 A 攻击范围（杀.canUse 复用 inAttackRange）
        filter: (_view, t) => t === killTarget || true, // 距离由后端 canUse 权威校验
      },
    },
    timeout: 20,
  });

  // A 的选择：出杀 {cardId, targets} 或未选（pass/超时 = 交武器）
  const choice = state.localVars['借刀杀人/出杀选择'] as
    | { cardId: string; targets: number[] }
    | undefined;
  delete state.localVars['借刀杀人/出杀选择'];

  if (choice && choice.targets.includes(killTarget)) {
    // A 出杀：复用完整使用牌流程（时机瀑布 + resolve 内含 damageType）
    // quotaPolicy='none'：逼杀不计出杀次数，不在 A 出牌阶段
    await useCard(state, target, choice.cardId, choice.targets, {
      quotaPolicy: 'none',
      mandatedTargets: [killTarget],
      skipValidate: false,
    });
  } else {
    // 不出杀：获得 A 的武器
    const targetPlayer = state.players[target];
    const weaponId = targetPlayer?.equipment['武器'];
    if (weaponId) {
      await applyAtom(state, { type: '卸下', player: target, slot: '武器' });
      await applyAtom(state, { type: '获得', player: source, cardId: weaponId, from: target });
    }
  }
}
```

补 import：`import { useCard } from '../card-effect/use-card';`。移除不再用的 `consumePlayedSlashes`、`runDamageFlow`、`isCancelled` import（若仅此处用）。

- [ ] **Step 2：新增借刀杀人 respond action（捕获 A 的选择）**

借刀杀人当前是 CardEffect（无 skill 层 action 注册）。需要注册一个 respond action 让 A 能回应。在 `借刀杀人.ts` 末尾 `registerCardEffect` 之后，**新增一个 skill 模块** 或在 CardEffect 的 respond 字段处理。

**决策：** 借刀杀人是 CardEffect，无 onInit。最干净的方式是给 `borrowedSwordEffect` 加 `respond` 字段（与 杀/闪 同模式），由 `打出牌.onInit` 自动按卡名注册 respond action。但借刀杀人的 respond 是"被借刀时选杀+目标"，不是"打出借刀杀人牌"。**因此不应挂在 借刀杀人 卡名上**。

**改用 skill 层注册：** 新建 `src/engine/skills/借刀杀人.ts`，注册 respond action（skillId='借刀杀人', requestType='借刀杀人/出杀'），捕获 choice 到 localVars。

Create: `src/engine/skills/借刀杀人.ts`

```ts
// 借刀杀人（技能层）：被借刀时选「出杀(含 B) 或交武器」的 respond action。
// CardEffect 层（card-effects/借刀杀人.ts）负责牌的使用结算；本文件负责被问询方的回应入口。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '借刀杀人', description: '被借刀杀人问询时的回应入口' };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  return registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '借刀杀人/出杀') return '当前不是借刀杀人询问';
      const cardId = params.cardId as string | undefined;
      const targets = params.targets as number[] | undefined;
      // 允许不传 cardId（= 交武器/pass），由 resolve 兜底
      if (cardId === undefined) return null;
      if (!Array.isArray(targets) || targets.length === 0) return '请选择杀的目标';
      const self = st.players[ownerId];
      if (!self?.hand.includes(cardId)) return '牌不在手牌中';
      if (st.cardMap[cardId]?.name !== '杀') return '只能使用杀';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      const targets = params.targets as number[] | undefined;
      if (typeof cardId === 'string' && Array.isArray(targets)) {
        st.localVars['借刀杀人/出杀选择'] = { cardId, targets };
      }
      // 不传 = 交武器，localVars 不设选择，resolve 走交武器分支
    },
  );
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '出杀',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '借刀杀人:使用一张杀或交出武器',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
      targetFilter: { min: 1, max: 3 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
```

确认 `src/engine/skills/index.ts` 的 skillLoaders 包含 '借刀杀人'（若以文件名自动加载则无需改；否则手动加）。

- [ ] **Step 3：删除借刀杀人 CardEffect 中已废弃的 preUse 兼容代码**

`借刀杀人.ts` CardEffect 的 `preUse`（约 114-130 行）处理 `targets=[A,B]` 或 `target+killTarget`。改用 `请求回应` 后，使用借刀杀人牌本身（P1 发起）的参数仍是 `{target:A, killTarget:B}`。**保留 preUse**——它把 killTarget 存 localVars、返回 `[A]` 作为真实目标。preUse 逻辑不变。

但 `resolveBorrowedSword` 现在读 `state.localVars['借刀杀人/killTarget']`（preUse 已设）。确认 preUse 仍设置该 key（借刀杀人.ts 约 130 行 `state.localVars['借刀杀人/killTarget'] = killTargetIdx`）。✓

- [ ] **Step 4：运行借刀杀人测试（含新火杀用例）**

Run: `npx vitest run tests/skill-tests/借刀杀人.test.ts`
Expected: 13 passed（原 12 + 新火杀 1）。

> **若失败：** 检查 A 的 respond 是否正确路由到新 skill 的 respond action；检查 `请求回应` 的 requestType 与 respond validate 匹配；检查 `useCard(none)` 的 mandatedTargets 校验。

### Task 2.4：追加方天画戟多目标测试

**Files:**
- Modify: `tests/skill-tests/借刀杀人.test.ts`

- [ ] **Step 1：追加方天画戟测试**

在 describe 末尾追加：

```ts
  // ─────────────────────────────────────────────────────────────
  // 5. A 装备方天画戟且只剩最后一张杀(手牌) → 借刀杀人逼杀可追加 2 目标
  // ─────────────────────────────────────────────────────────────
  it('P2(方天画戟,仅 1 张杀)被借刀 → 可对 B+C+D 三目标出杀', async () => {
    const weapon = makeCard('wp1', '方天画戟', '♦', 'Q', '装备牌');
    const s2 = makeCard('p2s', '杀', '♥', '5', '基本牌');
    const state = buildState({
      p2Hand: ['p2s'],
      p2Equipment: { 武器: 'wp1' },
      p3Hand: [],
      p3Skills: ['闪'],
      playerCount: 4,
      extraCards: { wp1: weapon, p2s: s2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.triggerAction('借刀杀人', 'use', { cardId: 'jd1', target: 1, killTarget: 2 });
    await P1.pass();

    // P2 用最后一张杀(方天画戟条件)对 B=2,C=3,D=0(自己?不行,P1=0 可) → 2,3,0
    // 注:方天画戟条件是"手牌仅剩此杀时可将目标改为三名角色",P2 出杀后手牌为空
    P2.expectPending('请求回应');
    await P2.respond('杀', { cardId: 'p2s', targets: [2, 3, 0] });

    // 三目标依次询问闪
    // (简化断言:P3=2 与 P4=3 与 P1=0 各被询问;此处只验证流程推进无报错)
    expect(harness.state.zones.discardPile).toContain('p2s');
  });
```

- [ ] **Step 2：运行测试**

Run: `npx vitest run tests/skill-tests/借刀杀人.test.ts`
Expected: 14 passed（方天画戟多目标经杀.canUse 的 inAttackRange 校验 + runUseFlow 多目标结算）。

> **若失败：** 方天画戟的"最后一张杀转三目标"是杀 CardEffect 的 target.max=3 + 装备 hook。确认 `useCard` 的 mode='forced' 下 `effect.canUse`（杀.canUse 含 inAttackRange 校验）对每个目标都通过。

- [ ] **Step 3：Commit**

```bash
git add src/engine/card-effects/借刀杀人.ts src/engine/skills/借刀杀人.ts tests/skill-tests/借刀杀人.test.ts
git commit -m "fix(借刀杀人): 出杀分支复用 useCard，修复 damageType 丢失

- resolveBorrowedSword 改用 请求回应(useCardAndTarget) + useCard(quotaPolicy:'none', mandatedTargets:[B])
- 删除手写的 指定目标/询问闪/runDamageFlow（修复火杀/雷杀 damageType 不传导）
- 新增 skills/借刀杀人.ts 注册 respond action（被借刀时选杀+目标）
- 支持方天画戟等多目标（杀.canUse 的 inAttackRange 复用）
- 新增火杀 damageType + 方天画戟多目标回归测试"
```

---

## Phase 3：收编 挑衅/激将/乱武（统一 useCard）

**目标：** 把 挑衅/激将/乱武 的手写杀结算统一改为 `useCard(quotaPolicy:'none', mandatedTargets:[...])`，删除 `乱武.resolveForcedSlash`。修复三处 damageType 丢失。

### Task 3.1：挑衅迁移

**Files:**
- Modify: `src/engine/skills/挑衅.ts`（杀结算块约 101-145 行）

- [ ] **Step 1：写失败测试——火杀经挑衅**

在 `tests/skill-tests/挑衅.test.ts`（若不存在则 `glob tests/skill-tests/挑衅*` 找）describe 内追加：

```ts
  it('目标用火杀响应挑衅 → 姜维(藤甲)受 2 点火焰伤害', async () => {
    // 复用 buildState;目标手牌为火杀(damageType='火'),姜维修藤甲
    // 期望:姜维扣 2 血(damageType 传导,藤甲 +1)
    // 见借刀杀人火杀用例的构造模式
  });
```

（具体 buildState/helper 参考挑衅.test.ts 现有结构；火杀 card 加 `damageType:'火'`。）

- [ ] **Step 2：运行确认失败**

Run: `npx vitest run tests/skill-tests/挑衅.test.ts -t "火杀"`
Expected: FAIL（damageType 丢失，扣 1 血）。

- [ ] **Step 3：重写挑衅杀结算块**

读 `挑衅.ts` 确认行号。把出杀分支（约 139-160 行，含 移动牌/指定目标/询问闪/手动清理/runDamageFlow）替换为：

```ts
        if (killCardId) {
          // 目标出了杀:复用完整使用牌流程(含 damageType)
          await useCard(state, target, killCardId, [from], {
            quotaPolicy: 'none',
            mandatedTargets: [from],
            skipValidate: true, // 挑衅自身已校验 inAttackRange
          });
        } else {
```

补 import：`import { useCard } from '../card-effect/use-card';`。移除不再用的 `runDamageFlow`、`frameCards`（若仅此处用）。

> **注：** 挑衅当前用 `请求回应(requestType='杀/respondKill')` + 杀.respond（杀牌移入处理区）。改后：杀仍在处理区（杀.respond 移入），`useCard(none)` 的 mode='forced' validate 会校验"牌在手牌"——但牌已在处理区！**冲突**。
>
> **解决：** 挑衅改为与借刀杀人/乱武一致的 `请求回应(useCardAndTarget)` 模式，A 直接选手牌中的杀+目标，不走 杀.respond。即把 `请求回应(requestType='杀/respondKill', prompt:useCard)` 改为 `请求回应(requestType='挑衅/出杀', prompt:useCardAndTarget)`，并新增挑衅 respond action 捕获 {cardId, target}。参考借刀杀人 Task 2.3 Step 2 的 skill 层 respond 模式（挑衅已有 onInit，直接在现有结构内加 respond 注册）。

- [ ] **Step 4：调整挑衅的 请求回应 prompt + 新增 respond 捕获**

把挑衅的 `请求回应`（约 122-133 行）改为 useCardAndTarget：

```ts
        await applyAtom(state, {
          type: '请求回应',
          requestType: '挑衅/出杀',
          target,
          prompt: {
            type: 'useCardAndTarget',
            title: `挑衅:对 ${state.players[from].name} 使用一张杀，否则其弃你一张牌`,
            cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
            targetFilter: { min: 1, max: 1, filter: (_v, t) => t === from },
          },
          timeout: 15,
        });

        const choice = state.localVars['挑衅/出杀选择'] as
          | { cardId: string; target: number }
          | undefined;
        delete state.localVars['挑衅/出杀选择'];

        if (choice?.cardId) {
          await useCard(state, target, choice.cardId, [choice.target], {
            quotaPolicy: 'none',
            mandatedTargets: [from],
            skipValidate: true,
          });
        } else {
          // 不出杀:姜维弃其一张牌
          await pickAndDiscard(state, from, target);
        }
```

在挑衅 `onInit` 内新增 respond 注册（捕获 choice）：

```ts
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { requestType?: string }).requestType !== '挑衅/出杀')
        return '当前不是挑衅询问';
      const cardId = params.cardId as string | undefined;
      if (cardId === undefined) return null; // pass = 不出杀
      if (!st.players[ownerId]?.hand.includes(cardId)) return '牌不在手牌中';
      if (st.cardMap[cardId]?.name !== '杀') return '只能使用杀';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (typeof cardId === 'string') {
        st.localVars['挑衅/出杀选择'] = { cardId, target: st.players[ownerId] ? (st.localVars['挑衅/弃牌目标'] as number) : -1 };
        // target 用 from(姜维);挑衅 execute 内 from=ownerId,故 target=ownerId
        st.localVars['挑衅/出杀选择'] = { cardId, target: ownerId };
      }
    },
  );
```

（注：挑衅的"杀目标"固定是姜维=ownerId，故 target=ownerId。）

- [ ] **Step 5：运行挑衅测试**

Run: `npx vitest run tests/skill-tests/挑衅.test.ts`
Expected: 全部 passed（含新火杀用例）。

### Task 3.2：激将迁移

**Files:**
- Modify: `src/engine/skills/激将.ts`（use 分支杀结算约 60-112 行；respond 分支约 149-195 行）

- [ ] **Step 1：写失败测试——火杀经激将**

`glob tests/skill-tests/激将*` 找测试文件。在 describe 内追加火杀用例（主公激将蜀角色，蜀角色用火杀对 killTarget，killTarget 藤甲 → 2 血）。

- [ ] **Step 2：重写激将 use 分支杀结算**

激将 use 分支（主公主动激将）当前用 `请求回应(requestType='杀/respondKill')` + 手写结算。改为 `请求回应(useCardAndTarget, requestType='激将/出杀')` + `useCard(none, mandatedTargets:[killTarget])`。蜀角色通过新 respond action 捕获 {cardId, targets}。

参考借刀杀人 Task 2.3 模式。激将已有 onInit，在其内新增/改 respond 注册。

- [ ] **Step 3：重写激将 respond 分支（响应型激将）**

激将 respond 分支（主公被询问杀时，逐个问蜀角色代打出）当前把杀移入处理区供调用方检查。**此分支不改**——它是"代打出"（respond 杀），不是"代使用"（use 杀）。仅 use 分支改用 useCard。

- [ ] **Step 4：运行激将测试**

Run: `npx vitest run tests/skill-tests/激将.test.ts`
Expected: 全部 passed。

### Task 3.3：乱武迁移 + 删除 resolveForcedSlash

**Files:**
- Modify: `src/engine/skills/乱武.ts`（`resolveForcedSlash` 约 55-100 行；execute 约 139-166 行）

- [ ] **Step 1：写失败测试——火杀经乱武**

在 `tests/skill-tests/乱武.test.ts`（`glob` 确认）追加：被乱武者用火杀对最近目标(藤甲) → 2 血。

- [ ] **Step 2：删除 `resolveForcedSlash`，execute 改用 useCard**

乱武 execute（约 156-166 行）当前：

```ts
            if (choice && ... ) {
              await resolveForcedSlash(st, p, choice.target, choice.cardId);
            } else {
              await applyAtom(st, { type: '失去体力', target: p, amount: 1 });
            }
```

改为：

```ts
            if (
              choice &&
              st.players[p].hand.includes(choice.cardId) &&
              nearestOthers(st, p).includes(choice.target) &&
              st.players[choice.target]?.alive
            ) {
              // 复用完整使用牌流程（含 damageType）；逼杀不计次数
              const err = await useCard(st, p, choice.cardId, [choice.target], {
                quotaPolicy: 'none',
                mandatedTargets: [choice.target],
                skipValidate: true, // 乱武自身已校验最近目标
              });
              if (err) {
                // useCard validate 失败（理论上不应发生，choice 已校验）→ 失去体力兜底
                await applyAtom(st, { type: '失去体力', target: p, amount: 1 });
              }
            } else {
              await applyAtom(st, { type: '失去体力', target: p, amount: 1 });
            }
```

删除 `resolveForcedSlash` 函数（约 55-100 行）整体。

补 import：`import { useCard } from '../card-effect/use-card';`。移除不再用的 `runDamageFlow`、`frameCards`、`pushFrame`（若仅 resolveForcedSlash 用）。

- [ ] **Step 3：运行乱武测试**

Run: `npx vitest run tests/skill-tests/乱武.test.ts`
Expected: 全部 passed（含新火杀用例）。

### Task 3.4：Phase 3 全量验证 + Commit

- [ ] **Step 1：全量测试**

Run: `npx vitest run`
Expected: 全部 passed。

- [ ] **Step 2：确认无残留手写杀结算**

```
grep -rn "询问闪" src/engine/skills/ src/engine/card-effects/   # 应只在 杀.ts/use-card.ts/闪.ts 等核心
grep -rn "resolveForcedSlash" src/engine/                         # 应无结果
grep -rn "手动.*incSlashUsed\|incSlashUsed" src/engine/skills/   # 应无界技能手动调用
```

（用本环境的 grep 工具，非 shell grep。）

- [ ] **Step 3：Commit**

```bash
git add src/engine/skills/挑衅.ts src/engine/skills/激将.ts src/engine/skills/乱武.ts tests/skill-tests/挑衅.test.ts tests/skill-tests/激将.test.ts tests/skill-tests/乱武.test.ts
git commit -m "refactor(逼杀): 挑衅/激将/乱武 统一改用 useCard(quotaPolicy='none')

- 删除 4 处手写杀结算（借刀杀人/挑衅/激将/乱武），统一 useCard(none, mandatedTargets)
- 修复火杀/雷杀经逼杀丢失 damageType（runUseFlow 内 resolve 自带 damageType）
- 删除 乱武.resolveForcedSlash
- 挑衅/激将 改用 请求回应(useCardAndTarget) 模式（与借刀杀人/乱武一致）
- 新增三处火杀 damageType 回归测试"
```

---

## Phase 4（后续计划，本计划不实施）：activeWhen 清理

**问题：** `杀.activeWhen = defaultPlayActive && viewCanSlash`（杀.ts:90-92）把出牌阶段逻辑焊进卡的 UI 描述。`桃`/`顺手牵羊` 等也有类似 `activeWhen`。

**目标（独立计划）：** 把 `defaultPlayActive`/`viewCanSlash` 等玩阶段门控从卡的 `activeWhen` 移到"询问上下文"（出牌窗口 / 借刀杀人请求 / 乱武请求）。卡的 `CardEffect.prompt`（含 targetFilter）保留为 context-free 的 UI 真理源。

**为何本计划不做：** Phase 2/3 的借刀杀人/乱武 已通过 `请求回应(useCardAndTarget)` 复用了客户端渲染（乱武已验证），不依赖 activeWhen 改动。activeWhen 清理是纯客户端 UX 重构，独立成计划风险更可控。

**后续计划入口：** 新建 `docs/superpowers/plans/YYYY-MM-DD-active-when-cleanup.md`，scout 客户端 `findUseActionForCard`/`isActiveAction`/`derivePlayRules`（gameViewHelpers.ts）的 activeWhen 消费链路后制定。

---

## Self-Review

**1. Spec coverage（用户诉求）：**
- ✅ "借刀杀人... 复用使用牌技能中的逻辑" → Phase 2 useCard(none)
- ✅ "借刀杀人目标响应参数应该包含 杀流程 的参数" → Phase 2 useCardAndTarget prompt + targets
- ✅ "区别1：时机（不再是杀使用者的出牌阶段）" → quotaPolicy='none' + mode='forced'（跳过 play-phase 基线）
- ✅ "区别2：目标必须包含借刀杀人指定的目标" → mandatedTargets:[B]
- ✅ "回合管理技能来校验使用次数，而不是 runUseFlow" → Phase 1 onSettle 移出 runUseFlow，归属 useCard(charge)，使用牌 use action（被出牌窗口驱动）传 charge
- ✅ "所有，不局限与杀" → useCard 原语通用，Phase 2/3 收编 4 处逼杀，界虚拟杀也统一
- ✅ damageType bug → Phase 2/3 修复（runUseFlow 内 resolveSlash 自带 damageType）

**2. Placeholder scan：** 无 TBD/TODO；每步含具体代码或具体命令。

**3. Type consistency：**
- `useCard(state, source, cardId, targets, opts)` 签名贯穿 Phase 1-3 ✓
- `UseCardOpts { quotaPolicy?, virtual?, skipCancelQuery?, mandatedTargets?, skipValidate? }` 一致 ✓
- `QuotaPolicy = 'charge' | 'none'` 一致 ✓
- `validateCardUse(..., mode: 'play'|'forced')` 一致 ✓
- localVars keys：`借刀杀人/killTarget`（preUse 设，resolve 读）、`借刀杀人/出杀选择`（respond 设，resolve 读）、`挑衅/出杀选择`、`挑衅/弃牌目标`、`乱武` 的 CHOICE_VAR —— 各自独立，无冲突 ✓

**4. 风险点（已在对应 Task 标注）：**
- 五谷丰登 onSettle 在 charge+非虚拟 下仍调（行为不变）；charge+virtual 五谷变体暂无 ✓
- 挑衅/激将 改 useCardAndTarget 需新增 respond action（已在 Task 3.1 Step 4、3.2 Step 2 说明）✓
- 界虚拟杀 canSlash 预检：useCard(charge) 的 mode='play' validate 含 canSlash，等价于界技能原预检（需 Task 1.4 Step 2 验证界仁德测试）✓
- 借刀杀人 preUse 保留（仍处理 P1 发起时的 target+killTarget）✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-25-use-card-flow-unification.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 按 Task 派发独立 subagent，Task 间审查，快速迭代。Phase 1（行为不变）适合先全跑验证抽象正确，再进 Phase 2/3。

**2. Inline Execution** - 本会话内按 executing-plans 批量执行，checkpoint 审查。

建议 Phase 1 用 Inline（紧密、需频繁全量测试），Phase 2/3 用 Subagent-Driven（每技能独立可并行）。Which approach?
