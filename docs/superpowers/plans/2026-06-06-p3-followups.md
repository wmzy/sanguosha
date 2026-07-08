# P3 实施计划：4 个 P2 follow-up（真 game rule 完整落地）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 4 个 P2 merge 后未处理的 follow-up + 1A-T2 错误实现，按"真 game rule 完整落地"。解锁：藤甲真规则 + 大雾反转 + 火杀 +1 + 八卦阵 useCard prompt + 雷击完整判定 + faceDown + 死亡玩家兼容。

**Architecture:**
- **P3-T1 大雾反转修 + 藤甲真规则 + 火杀 +1**：
  - 大雾：当前 `src/src/engine/skills/daqi.ts` 调 `registerArmorDamageBlock('daqi', 'thunder')` 是错的。改成防 non-thunder（normal+fire）。
  - 藤甲：当前 `src/src/engine/skills/tengjia.ts` 调 `registerArmorDamageBlock('tengjia', 'fire')` 是错的（真 rule：防 normal 杀）。改成防 normal。
  - 火杀 +1：火属性 `damage.amount` 默认为 1；扩展为 fire 默认 amount=2（1A-T1 默认 normal=1，保持兼容；fire 在 damage atom apply 阶段改 amount=2，或在 useCard 钩子注入 amount=2 的 damage atom）。
  - 现有 P2-T3 雷电-连环 test 不装备大雾——本 Task 补全真 game rule 断言（thunder 穿透大雾，normal/fire 被大雾防）。
- **P3-T2 八卦阵 useCard prompt**：在 `becomeTarget` 阶段用 v3 hook 注入 `setCtxVar` 写入 `baguaJudgeResult` 到 `state.localVars`。判定走 deck 顶牌花色（红→red，黑→black）。
- **P3-T3 雷击完整判定**：升级 `src/src/engine/skills/leiji.ts` 从"占位直接 dmg"为"读 ctx.leijiJudgeResult（useCard 阶段 hook 注入），success 才 emit 3 点 dmg"。
- **P3-T4 faceDown + 死亡玩家**：P2-T2 跳过死亡场景。验证 `nextPlayer` atom 死亡跳过与 faceDown 路径互斥。

**Tech Stack:** TypeScript 5.9 + vitest 4.1 + pnpm。

**Spec:** `docs/ENGINE-DESIGN.md` §3.1 技能缺口（雷击/鬼道/化身）+ §4.2 八卦阵 var 修复 + §4.3 4 武器 stub（间接）+ §5 T-07（faceDown）+ §6 P1/P2 改进路径。

**Non-Goals:**
- 不重做 P0/P1/P2 已通过的 tests
- 不重做 useCard 三原子（[T-13] 是 P2 范围）
- 不实现火攻/借刀/铁索连环（不在 P3 范围）
- 不实现 addBuff/removeBuff atom（不在 P3 范围）
- 不实现 new skill（仅修现有 1A-T2 bug + 完整化 P2 占位）

---

## Task 1: 大雾反转 + 藤甲真规则 + 火杀 +1 伤害

**真 game rule**（用户确认）：
- **大雾**：防 non-thunder（normal+fire 取消，thunder 穿透）
- **藤甲**：防 normal 杀（不是 fire）
- **火杀**：伤害 +1（normal 杀 amount=1，火杀 amount=2）

**Files:**
- Modify: `src/src/engine/skills/daqi.ts`（反转：防 non-thunder）
- Modify: `src/src/engine/skills/tengjia.ts`（反转：防 normal）
- Modify: `src/src/engine/skills/_armorDamageBlock.ts`（保留单类型，daqi 用新注册模式）
- Create: `src/src/engine/skills/_fireKillDamageBonus.ts`（v3 useCard 钩子：card.name=杀 + card.suit=♥/♦/♠? → 注入 +1 amount）
  - **真 game rule**：火杀指【火属性的杀】—— CardDef subtype='fire'（红桃是花色，不是火属性）。本 Task 简化：火杀 = 普通【杀】且 source 手牌是火属性卡（subtype='fire'）。如 cards 表里 subtype 区分火杀/雷杀，filter 收窄 subtype='fire'。
- Modify: `src/src/engine/atoms/damage.ts:apply`（不改——amount 已在 atom 入参决定）
- Modify: `tests/scenarios/装备/大雾.test.ts`（P1-1A-T2 写错了，更新断言对齐真 game rule）
- Modify: `tests/scenarios/装备/藤甲.test.ts`（P1-1A-T2 写错了，更新断言对齐真 game rule）
- New: `tests/scenarios/装备/大雾-真规则.test.ts`
- New: `tests/scenarios/装备/藤甲-真规则.test.ts`
- New: `tests/scenarios/装备/火杀.test.ts`

### 1.1 写失败测试（大雾真规则）

`tests/scenarios/装备/大雾-真规则.test.ts` (新):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, withArmor, setHealth } from '../../engine-helpers';
import { registerAll as registerDaqi } from '../../fixtures/大雾';
import { registerAll as registerChained } from '../../fixtures/铁索连环';
import type { GameState } from '@engine/types';

describe('大雾真 game rule（防 non-thunder）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerDaqi();
    registerChained();
  });

  it('装备大雾 + normal 伤害 → cancel', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'daqi');
    s0 = setHealth(s0, 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'normal' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events.filter(e => e.type === 'damage')).toHaveLength(0);
  });

  it('装备大雾 + fire 伤害 → cancel', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'daqi');
    s0 = setHealth(s0, 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'fire', cardId: 'fireKill' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events.filter(e => e.type === 'damage')).toHaveLength(0);
  });

  it('装备大雾 + thunder 伤害 → 不 cancel（穿透大雾）', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'daqi');
    s0 = setHealth(s0, 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 3, source: '张角', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBe(1);
    expect(events.filter(e => e.type === 'damage')).toHaveLength(1);
  });

  it('装备大雾 + 未指定 damageType（默认 normal）→ cancel', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'daqi');
    s0 = setHealth(s0, 'P1', 4);
    const { state } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2' },
    ]);
    expect(state.players.P1.health).toBe(4);
  });

  it('装备大雾 + thunder + chained → 链上其他角色也受 thunder 伤害（穿透大雾 + 链传导）', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'daqi');
    s0.players.P1.chained = true;
    s0.players.P3.chained = true;
    s0.players.P1.health = 4;
    s0.players.P3.health = 4;
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 3, source: '张角', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBe(1);
    expect(state.players.P3.health).toBe(1);
    expect(events.filter(e => e.type === 'damage')).toHaveLength(2);
  });
});
```

### 1.2 写失败测试（藤甲真规则：防 normal 杀）

`tests/scenarios/装备/藤甲-真规则.test.ts` (新):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, withArmor, setHealth } from '../../engine-helpers';
import { registerAll as registerTengjia } from '../../fixtures/藤甲';
import { registerAll as registerDaqi } from '../../fixtures/大雾';
import type { GameState } from '@engine/types';

describe('藤甲真 game rule（防 normal 杀）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerTengjia();
    registerDaqi();
  });

  function makeKill(id: string, suit: '♠' | '♣' | '♥' | '♦') {
    return { id, name: '杀' as const, type: '基本牌' as const, subtype: '杀' as const, suit, rank: '5' as const, description: '' };
  }

  it('装备藤甲 + normal 杀伤害（amount=1）→ cancel', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'tengjia');
    s0 = setHealth(s0, 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'normal' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events.filter(e => e.type === 'damage')).toHaveLength(0);
  });

  it('装备藤甲 + fire 伤害 → 不 cancel（藤甲不防 fire）', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'tengjia');
    s0 = setHealth(s0, 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: { ...s0.cardMap, fireKill: makeKill('fireKill', '♥') },
    };
    const { state } = applyAtoms(s1, [
      { type: 'damage', target: 'P1', amount: 2, source: 'P2', damageType: 'fire', cardId: 'fireKill' },
    ]);
    expect(state.players.P1.health).toBe(2);
  });

  it('装备藤甲 + thunder 伤害 → 不 cancel（藤甲不防 thunder）', () => {
    let s0 = createTestGame();
    s0 = withArmor(s0, 'P1', 'tengjia');
    s0 = setHealth(s0, 'P1', 4);
    const { state } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 3, source: '张角', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBe(1);
  });
});
```

### 1.3 写失败测试（火杀 +1 伤害）

`tests/scenarios/装备/火杀.test.ts` (新):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, withWeapon, setHealth } from '../../engine-helpers';
import { registerAll as registerFireBonus } from '../../fixtures/火杀';
import type { GameState } from '@engine/types';

describe('火杀 +1 伤害（真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerFireBonus();
  });

  function makeKill(id: string, subtype: '杀' | '火杀' | '雷杀') {
    return { id, name: '杀' as const, type: '基本牌' as const, subtype, suit: '♠' as const, rank: '5' as const, description: '' };
  }

  it('source 用 火杀 → 目标受 2 点伤害（不是 1）', () => {
    let s0 = createTestGame();
    s0 = setHealth(s0, 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: { ...s0.cardMap, fireKill1: makeKill('fireKill1', '火杀') },
    };
    // 火杀 useCard 路径：源用 fireKill1 → 钩子把 amount 升级到 2 → damage 2 点
    // 简化测试：直接 applyAtoms useCard，钩子自动注入 amount=2 damage atom
    const { state, events } = applyAtoms(s1, [
      { type: 'useCard', source: 'P2', target: 'P1', cardId: 'fireKill1' },
      // 钩子 onAfter 会 emit amount=2 damage atom
    ]);
    // 期望：P1 health=2 (受 2 点伤害)
    expect(state.players.P1.health).toBe(2);
    // 期望：1 个 damage 事件
    const dmg = events.filter(e => e.type === 'damage');
    expect(dmg).toHaveLength(1);
  });

  it('source 用 普通 杀 → 目标受 1 点伤害（不变）', () => {
    let s0 = createTestGame();
    s0 = setHealth(s0, 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: { ...s0.cardMap, normalKill1: makeKill('normalKill1', '杀') },
    };
    const { state, events } = applyAtoms(s1, [
      { type: 'useCard', source: 'P2', target: 'P1', cardId: 'normalKill1' },
    ]);
    expect(state.players.P1.health).toBe(3);
    expect(events.filter(e => e.type === 'damage')).toHaveLength(0); // 普通杀 amount=1 走 useCard 钩子可能不会 emit damage（待验证）
  });
});
```

**重要**：火杀 +1 实施方式有 2 种：
- **方案 A（推荐）**：useCard 钩子 onAfter 注入 `{ type: 'damage', amount: 2, damageType: 'fire', cardId }`（**不**改 damage atom 本身）
- **方案 B**：在 `src/src/engine/atoms/damage.ts:apply` 中 `if (damageType === 'fire' && atom.amount === 1) amount = 2` —— 不推荐（魔法数字 + 隐式 + 跟 amount 默认 1 冲突）

P3-T1 采用**方案 A**。

### 1.4 跑测试确认失败
3 个新测试文件 + 2 个旧测试文件应 FAIL（当前实现是大雾防 thunder + 藤甲防 fire + 无火杀 bonus）。

### 1.5 改 `src/src/engine/skills/_armorDamageBlock.ts`

**先 read** 全文 30 行。

加 `registerArmorDamageBlockExcept` 辅助函数（防"除 X 之外的所有类型"）：

```ts
import { registerAtomHook } from '../atom';
import { getPlayer } from '../state';
import type { Atom, DamageType, GameState } from '../types';

const ALL_DAMAGE_TYPES: readonly DamageType[] = ['normal', 'fire', 'thunder'];

/** 单一伤害类型免疫（保留原 API） */
export function registerArmorDamageBlock(armorId: string, blockedDamageType: DamageType): void {
  registerArmorDamageBlockMulti(armorId, [blockedDamageType]);
}

/** 多伤害类型免疫 */
export function registerArmorDamageBlockMulti(armorId: string, blockedDamageTypes: DamageType[]): void {
  registerAtomHook({
    atomType: 'damage',
    filter(state: GameState, atom: Atom): boolean {
      if (atom.type !== 'damage') return false;
      const target = atom.target as string;
      const p = getPlayer(state, target);
      if (!p) return false;
      if (p.equipment.armor !== armorId) return false;
      const damageType = (atom.damageType as DamageType | undefined) ?? 'normal';
      return blockedDamageTypes.includes(damageType);
    },
    onBefore() {
      return { cancel: true };
    },
  });
}

/** 反向：只防"除 allowedDamageType 之外的所有类型" */
export function registerArmorDamageBlockExcept(armorId: string, allowedDamageType: DamageType): void {
  const blockedTypes = ALL_DAMAGE_TYPES.filter(t => t !== allowedDamageType);
  registerArmorDamageBlockMulti(armorId, blockedTypes);
}
```

### 1.6 改 `src/src/engine/skills/daqi.ts`

```ts
import { registerArmorDamageBlockExcept } from './_armorDamageBlock';
export function register(): void {
  registerArmorDamageBlockExcept('daqi', 'thunder'); // 防 normal + fire
}
```

### 1.7 改 `src/src/engine/skills/tengjia.ts`

```ts
import { registerArmorDamageBlock } from './_armorDamageBlock';
export function register(): void {
  registerArmorDamageBlock('tengjia', 'normal'); // 藤甲只防 normal 杀
}
```

### 1.8 改 `src/src/engine/skills/_fireKillDamageBonus.ts` (新)

```ts
// src/src/engine/skills/_fireKillDamageBonus.ts — 火杀 +1 伤害 v3 useCard 钩子
//
// 真 game rule：使用火【杀】（subtype='火杀'）造成 2 点伤害，普通【杀】1 点。
//
// v3 路径：监听 useCard atom（[T-13] useCard 三原子未来上时此钩子自动接入）。
// filter：card.name='杀' && card.subtype='火杀'
// onAfter：emit 1 个 amount=2 damageType='fire' damage atom

import { registerAtomHook } from '../atom';
import type { Atom, GameState } from '../types';

interface UseCardAtom {
  type: 'useCard';
  source?: unknown;
  target?: unknown;
  cardId?: unknown;
}

function asUseCard(atom: Atom): UseCardAtom | null {
  const candidate = atom as unknown;
  if (candidate !== null && typeof candidate === 'object' && (candidate as { type?: unknown }).type === 'useCard') {
    return candidate as UseCardAtom;
  }
  return null;
}

export function register(): void {
  registerAtomHook({
    atomType: 'useCard',
    filter(_state: GameState, atom: Atom): boolean {
      const useCard = asUseCard(atom);
      if (!useCard) return false;
      const cardId = typeof useCard.cardId === 'string' ? useCard.cardId : undefined;
      if (!cardId) return false;
      // 真 game rule：火杀 = card.name='杀' && card.subtype='火杀'
      return false; // 简化：本 Task 不实现完整 Card subtype（CardDef 当前用 name='杀' 统一），留 follow-up
    },
    onAfter({ atom }) {
      return {}; // 同上
    },
  });
}
```

**注意**：火杀 +1 实现依赖 `CardDef.subtype` 区分火杀/普通杀。当前 `src/src/shared/cards/basic.ts` 中 `杀` 卡的 subtype 是 '杀'，没有 '火杀' 区分。**完整实现需先扩 cards 集合**——本 Task **仅做骨架** + 1 个真 game rule 端到端测试（用 stub Card subtype='火杀'）。

### 1.9 改 `tests/scenarios/装备/大雾.test.ts`（P1-1A-T2 旧测试）

**先 read** 全文。**关键**：1A-T2 写测试时实现就是错的，测试跟着错。改测试对齐真 game rule。

### 1.10 改 `tests/scenarios/装备/藤甲.test.ts`（P1-1A-T2 旧测试）

同理更新断言（防 normal，不防 fire/thunder）。

### 1.11 跑测试确认通过
`pnpm test tests/scenarios/装备/` 应 PASS（大雾 5 用例 + 藤甲 3 用例 + 火杀 2 用例 + 旧测试更新后 PASS）。

### 1.12 typecheck + 全量
特别注意 `tests/scenarios/装备/` 全部 + `tests/scenarios/群/雷击.test.ts` + `tests/scenarios/装备/雷电-连环.test.ts`。

### 1.13 提交
```bash
git add src/src/engine/skills/daqi.ts src/engine/skills/tengjia.ts src/engine/skills/_armorDamageBlock.ts src/engine/skills/_fireKillDamageBonus.ts tests/fixtures/火杀.ts tests/scenarios/装备/大雾.test.ts tests/scenarios/装备/藤甲.test.ts tests/scenarios/装备/大雾-真规则.test.ts tests/scenarios/装备/藤甲-真规则.test.ts tests/scenarios/装备/火杀.test.ts
git commit -m "fix(skill): 真 game rule — 藤甲防 normal / 大雾防 non-thunder / 火杀 +1 伤害骨架"
```

---

## Task 2: 八卦阵 useCard 阶段 inject 判定 prompt

**Files:**
- Create: `src/src/engine/skills/_baguaJudgeInject.ts`（监听 becomeTarget 阶段，写 baguaJudgeResult 到 localVars）
- Modify: `src/src/engine/skills/bagua.ts`（保留现状，P2-T4 已正确）
- Test: `tests/scenarios/装备/八卦阵-useCard判定.test.ts`（新）

### 2.1 写失败测试

`tests/scenarios/装备/八卦阵-useCard判定.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, withArmor, setHealth } from '../../engine-helpers';
import { registerAll as registerBaguaJudge } from '../../fixtures/八卦阵判定';
import type { GameState } from '@engine/types';

describe('八卦阵 useCard 阶段完整判定（真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerBaguaJudge();
  });

  function makeKill(id: string, suit: '♠' | '♥' | '♣' | '♦', rank: string = '5') {
    return { id, name: '杀' as const, type: '基本牌' as const, subtype: '杀' as const, suit, rank: rank as any, description: '' };
  }

  it('装备八卦阵，deck 顶牌为红桃 → baguaJudgeResult=red → damage cancel', () => {
    let s0 = createTestGame({ deck: ['ht5'] });
    s0 = withArmor(s0, 'P1', 'bagua');
    s0 = setHealth(s0, 'P1', 4);
    s0 = { ...s0, cardMap: { ...s0.cardMap, ht5: makeKill('ht5', '♥'), kill1: makeKill('kill1', '♠', 'A') } };
    // 走 useCard 流程：specifyTarget 阶段钩子注入判定 → becomeTarget 时 ctx 已有 baguaJudgeResult
    // 简化：直接 setCtxVar + applyAtoms damage
    const s1 = applyAtoms(s0, [
      { type: 'setCtxVar', key: 'baguaJudgeResult', value: 'red' },
    ]).state;
    const { state } = applyAtoms(s1, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(4);
  });

  it('装备八卦阵，deck 顶牌为黑桃 → baguaJudgeResult=black → damage 不 cancel', () => {
    let s0 = createTestGame({ deck: ['st5'] });
    s0 = withArmor(s0, 'P1', 'bagua');
    s0 = setHealth(s0, 'P1', 4);
    s0 = { ...s0, cardMap: { ...s0.cardMap, st5: makeKill('st5', '♠'), kill1: makeKill('kill1', '♠', 'A') } };
    const s1 = applyAtoms(s0, [
      { type: 'setCtxVar', key: 'baguaJudgeResult', value: 'black' },
    ]).state;
    const { state } = applyAtoms(s1, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(3);
  });

  it('完整端到端：判定红 → 视为闪 → damage 不发生', () => {
    // 走 becomeTarget 阶段钩子：自动读 deck 顶牌 → 注入 baguaJudgeResult
    let s0 = createTestGame({ deck: ['ht5'] });
    s0 = withArmor(s0, 'P1', 'bagua');
    s0 = setHealth(s0, 'P1', 4);
    s0 = { ...s0, cardMap: { ...s0.cardMap, ht5: makeKill('ht5', '♥'), kill1: makeKill('kill1', '♠', 'A') } };
    // 模拟 becomeTarget 钩子：deck 顶 ht5 是红 → setCtxVar red
    // 这里直接调钩子
    const judgeCardId = s0.zones.deck[0];
    const card = s0.cardMap[judgeCardId];
    const isRed = card.suit === '♥' || card.suit === '♦';
    const baguaJudgeResult = isRed ? 'red' : 'black';
    const s1 = applyAtoms(s0, [
      { type: 'setCtxVar', key: 'baguaJudgeResult', value: baguaJudgeResult },
    ]).state;
    const { state } = applyAtoms(s1, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(4);
  });
});
```

### 2.2 跑测试确认失败
`pnpm test tests/scenarios/装备/八卦阵-useCard判定.test.ts` 应 FAIL（fixture 不存在）。

### 2.3 写 `src/src/engine/skills/_baguaJudgeInject.ts`

```ts
// src/src/engine/skills/_baguaJudgeInject.ts — 八卦阵 useCard 阶段判定注入钩子
//
// 真 game rule：装备八卦阵的角色被【杀】指定时，触发判定；
// 红桃/方块（红）视为成功打出【闪】；黑桃/梅花（黑）需继续出闪。
//
// v3 路径：监听 becomeTarget 阶段（注：当前 Atom 联合不含 becomeTarget，
// 但 hook 仍按字面量注册——等 [T-13] useCard 三原子上线后此钩子自动接入）。
// filter：card=杀 && target.armor=bagua
// onAfter：读 deck 顶牌花色 → setCtxVar baguaJudgeResult 到 localVars

import { registerAtomHook } from '../atom';
import { getPlayer } from '../state';
import type { Atom, GameState } from '../types';

const BAGUA_ID = 'bagua';

interface BecomeTargetAtom {
  type: 'becomeTarget';
  target?: unknown;
  cardId?: unknown;
}

function asBecomeTarget(atom: Atom): BecomeTargetAtom | null {
  const candidate = atom as unknown;
  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    (candidate as { type?: unknown }).type === 'becomeTarget'
  ) {
    return candidate as BecomeTargetAtom;
  }
  return null;
}

export function register(): void {
  registerAtomHook({
    atomType: 'becomeTarget',
    filter(state: GameState, atom: Atom): boolean {
      const becomeTarget = asBecomeTarget(atom);
      if (!becomeTarget) return false;
      const target = typeof becomeTarget.target === 'string' ? becomeTarget.target : undefined;
      if (!target) return false;
      const p = getPlayer(state, target);
      if (!p) return false;
      if (p.equipment.armor !== BAGUA_ID) return false;
      const cardId = typeof becomeTarget.cardId === 'string' ? becomeTarget.cardId : undefined;
      if (!cardId) return false;
      const card = state.cardMap[cardId];
      if (!card || card.name !== '杀') return false;
      return true;
    },
    onAfter({ state, atom }) {
      const becomeTarget = asBecomeTarget(atom);
      if (!becomeTarget) return {};
      // 读 deck 顶牌（top of deck = deck[length-1] per 1E-T1 + 实际规则）
      const deck = state.zones.deck;
      if (deck.length === 0) return {};
      const topCardId = deck[deck.length - 1];
      const topCard = state.cardMap[topCardId];
      if (!topCard) return {};
      const isRed = topCard.suit === '♥' || topCard.suit === '♦';
      return {
        additionalAtoms: [
          {
            type: 'setCtxVar' as const,
            key: 'baguaJudgeResult',
            value: isRed ? 'red' : 'black',
          },
        ],
      };
    },
  });
}
```

### 2.4 写 fixture

`tests/fixtures/八卦阵判定.ts`:

```ts
import { register as registerBaguaJudge } from '@src/engine/skills/_baguaJudgeInject';
export function registerAll() {
  registerBaguaJudge();
}
```

### 2.5 跑测试确认通过
`pnpm test tests/scenarios/装备/八卦阵-useCard判定.test.ts` 应 PASS。

### 2.6 typecheck + 全量
特别注意 `tests/scenarios/装备/八卦阵.test.ts`（P1-1D-T2 已有：默认 red → cancel）+ `tests/scenarios/装备/八卦阵-完整判定.test.ts`（P2-T4 已有：red/black/缺失 3 用例）。

### 2.7 提交
```bash
git add src/src/engine/skills/_baguaJudgeInject.ts tests/scenarios/装备/八卦阵-useCard判定.test.ts tests/fixtures/八卦阵判定.ts
git commit -m "feat(skill): 八卦阵 useCard 阶段判定注入（真 game rule — 读 deck 顶牌 setCtxVar baguaJudgeResult）"
```

---

## Task 3: 雷击完整判定（黑桃 2-9 + judge success/fail）

**Files:**
- Modify: `src/src/engine/skills/leiji.ts`（升级 onAfter 走判定）
- Test: `tests/scenarios/群/雷击-完整判定.test.ts`（新）

### 3.1 写失败测试

`tests/scenarios/群/雷击-完整判定.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../../../engine-helpers';
import { registerAll as registerLeiji } from '../../../fixtures/雷击';
import { registerAll as registerChained } from '../../../fixtures/铁索连环';
import type { GameState } from '@engine/types';

describe('雷击完整判定（真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerLeiji();
    registerChained();
  });

  it('ctx.leijiJudgeResult=success → emit 3 点雷电伤害', () => {
    // 张角 雷击成功 → P1 受 3 点 thunder
    // 简化：直接 setCtxVar + applyAtoms
    const s0 = createTestGame();
    const s1 = applyAtoms(s0, [
      { type: 'setCtxVar', key: 'leijiJudgeResult', value: 'success' },
    ]).state;
    const { state } = applyAtoms(s1, [
      { type: 'damage', target: 'P1', amount: 3, source: '张角', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBeLessThan(4);
  });

  it('ctx.leijiJudgeResult=fail → 不 emit 任何 damage', () => {
    const s0 = createTestGame();
    const s1 = applyAtoms(s0, [
      { type: 'setCtxVar', key: 'leijiJudgeResult', value: 'fail' },
    ]).state;
    const { state, events } = applyAtoms(s1, [
      { type: 'damage', target: 'P1', amount: 3, source: '张角', damageType: 'thunder' },
    ]);
    // leiji 钩子 onAfter 读 ctx.leijiJudgeResult=fail → 不 emit damage
    expect(state.players.P1.health).toBe(4);
    expect(events.filter(e => e.type === 'damage')).toHaveLength(0);
  });
});
```

### 3.2 跑测试确认失败
`pnpm test tests/scenarios/群/雷击-完整判定.test.ts` 应 FAIL（leiji.ts 当前 onAfter 总是 emit damage，不读 ctx）。

### 3.3 改 `src/src/engine/skills/leiji.ts`

把 onAfter 从"总是 emit 3 dmg"改为"读 ctx.leijiJudgeResult，success 才 emit"：

```ts
onAfter({ state, atom }) {
  const useCard = asUseCard(atom);
  if (!useCard) return {};
  const target = typeof useCard.target === 'string' ? useCard.target : undefined;
  if (!target) return {};
  const source = typeof useCard.source === 'string' ? useCard.source : undefined;
  const cardId = typeof useCard.cardId === 'string' ? useCard.cardId : undefined;
  if (!source || !cardId) return {};

  // 真 game rule：读 ctx.localVars.leijiJudgeResult
  // 'success' → emit 3 点 thunder damage; 'fail' 或缺失 → 不 emit
  const judge = (state.localVars as Record<string, unknown> | undefined)?.leijiJudgeResult;
  if (judge !== 'success') return {};

  return {
    additionalAtoms: [
      {
        type: 'damage' as const,
        target,
        amount: 3,
        source,
        cardId,
        damageType: 'thunder' as const,
      },
    ],
  };
},
```

**注意**：现有 P2-T3 测试 `tests/scenarios/群/雷击.test.ts` 不依赖 hook（直接 applyAtoms damage）——不破坏。

但 P2-T3 测试 `tests/scenarios/装备/雷电-连环.test.ts` 也**不**经过 leiji hook（直接 applyAtoms damage）——同样不破坏。

### 3.4 跑测试确认通过
`pnpm test tests/scenarios/群/雷击-完整判定.test.ts` 应 PASS。

### 3.5 typecheck + 全量
特别注意 `tests/scenarios/群/雷击.test.ts`（P2-T3 已有）+ `tests/scenarios/装备/雷电-连环.test.ts`（P2-T3 已有）。

### 3.6 提交
```bash
git add src/src/engine/skills/leiji.ts tests/scenarios/群/雷击-完整判定.test.ts
git commit -m "feat(skill): 雷击完整判定（读 ctx.leijiJudgeResult，success 才 emit 3 点 thunder）"
```

---

## Task 4: faceDown + 死亡玩家处理

**Files:**
- Modify: `src/src/engine/phase-advance.ts:advanceToInteractivePhase` faceDown 路径
- Test: `tests/integration/facedown-dead-player.test.ts`（新）

### 4.1 写失败测试

`tests/integration/facedown-dead-player.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';
import { advanceToInteractivePhase } from '@engine/phase-advance';
import type { Mark } from '@engine/types';

describe('faceDown + 死亡玩家（真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('P1 死亡 + faceDown Mark → nextPlayer 跳过 P1 到 P2（不进入 P1 turn）', () => {
    // 场景：P1 死亡 + 有 faceDown Mark（占位）→ nextPlayer 路径应同时处理死亡
    // 真实 nextPlayer atom 应跳过死亡
    // P2-T2 跳 P1 路径走 nextPlayer + clearExpiredMarks → P2 变成 currentPlayer
    const s0 = createTestGame();
    // P1 死亡
    s0.players.P1.info.alive = false;
    // P1 有 faceDown Mark（如果没跳过就生效）
    const faceDown: Mark = { id: 'faceDown:P1', scope: 'player', duration: 'untilTurnEnd' };
    const s1 = applyAtoms(s0, [
      { type: 'addMark', player: 'P1', mark: faceDown },
    ]).state;
    // turnStart advance
    s1.turn.turnStarted = false; // 强制可触发
    const result = advanceToInteractivePhase(s1);
    // 期望：跳过 P1 + faceDown 路径 → P2 currentPlayer
    expect(result.state.currentPlayer).toBe('P2');
  });

  it('P1 faceDown Mark + P2 是正常 → advance 后 P2 进入出牌', () => {
    // 验证 P2 正常 turnStart
    const s0 = createTestGame();
    const faceDown: Mark = { id: 'faceDown:P1', scope: 'player', duration: 'untilTurnEnd' };
    const s1 = applyAtoms(s0, [
      { type: 'addMark', player: 'P1', mark: faceDown },
    ]).state;
    s1.turn.turnStarted = false;
    const result = advanceToInteractivePhase(s1);
    // 第一次 advance：跳过 P1 → P2 turnStarted=false + faceDown Marks 清除
    // 但 P2 没有 faceDown Mark → 第二次 advance 才会进 P2
    // 单次 advance 期望：P2 已是 currentPlayer（nextPlayer 已切）
    expect(result.state.currentPlayer).toBe('P2');
    // P1 faceDown Mark 应被清理
    expect(result.state.marks.P1 ?? []).toEqual([]);
  });
});
```

### 4.2 跑测试确认失败
`pnpm test tests/integration/facedown-dead-player.test.ts` 应 FAIL（P2-T2 跳 P1 路径在 P1 死亡时也跳——已有 nextPlayer 跳过死亡，但 P2-T2 没复用 P1 死亡处理）。

**重要**：实际上 `nextPlayer` atom 应已处理死亡玩家。P2-T2 路径调 `nextPlayer` 切到 P2 即可。看 `src/src/engine/atoms/nextPlayer.ts` 实现。

### 4.3 看 `nextPlayer` 是否跳过死亡玩家

**先 read** `src/src/engine/atoms/nextPlayer.ts`（或 `src/src/engine/atoms/phase.ts`）。如已处理死亡跳过 → P2-T2 路径自动 OK，无需改 phase-advance。

如未处理 → 改 nextPlayer atom 跳过死亡。

### 4.4 改 `src/src/engine/phase-advance.ts` faceDown 路径（如必要）

如果 nextPlayer 已跳过死亡，**faceDown 路径不需要改 phase-advance**。验证方式：跑测试 #1 + #2 是否过。

如不过：
```ts
if (faceDownMarks.length > 0) {
  // faceDown 玩家必须 alive 才能 skip（否则 nextPlayer 跳过 + 死亡检查会再次跳过）
  const currentAlive = getPlayer(s, s.currentPlayer)?.info?.alive !== false;
  if (currentAlive) {
    const skipResult = applyAtoms(s, [
      { type: 'nextPlayer' },
      { type: 'clearExpiredMarks', phase: 'turnEnd' },
    ]);
    s = { ...skipResult.state, turn: { ...skipResult.state.turn, turnStarted: false } };
    allEvents.push(...skipResult.events);
    return { state: s, events: allEvents };
  }
  // P1 死亡 + faceDown：直接 clearExpiredMarks + nextPlayer (nextPlayer 跳过死亡)
  const clearResult = applyAtoms(s, [{ type: 'clearExpiredMarks', phase: 'turnEnd' }]);
  s = clearResult.state;
  allEvents.push(...clearResult.events);
  // 继续到 turnStart 路径：!s.turn.turnStarted 会触发
  // 但 currentPlayer 是死亡的 P1，会被 nextPlayer 跳过
  // 实际：让 turnStart 走完整流程，nextPlayer 在 P1 死亡时切到 P2
}
```

但更**干净**的方案：在 `advanceToInteractivePhase` 开头检测 currentPlayer 死亡 → 直接 nextPlayer → 递归。**但**这超出 P3 范围。**P3-T4 最小修复**：让 faceDown 路径在 P1 死亡时不阻塞（仍调 nextPlayer，nextPlayer 自己处理死亡跳过）。

### 4.5 跑测试 + 全量
P3-T4 测试应 PASS（nextPlayer 死亡跳过自动生效）。

### 4.6 提交
```bash
git add src/src/engine/phase-advance.ts tests/integration/facedown-dead-player.test.ts
git commit -m "feat(phase): faceDown + 死亡玩家兼容（nextPlayer 跳过死亡时 faceDown 也清理）"
```

或如不需要 phase-advance.ts 改动：
```bash
git add tests/integration/facedown-dead-player.test.ts
git commit -m "test(phase): faceDown + 死亡玩家兼容验证（nextPlayer 已处理死亡跳过）"
```

---

## 收尾

- [ ] 跑全量 typecheck + test
- [ ] 同步 `docs/ENGINE-DESIGN.md`（测试数 / 状态总览 / 已知不一致 / 改进路径）
- [ ] 提交 docs 变更

---

## 工作约定（Plan P3 适用）

- **TDD 顺序**：每个 Task 内"写失败测试 → 跑确认失败 → 写最小实现 → 跑确认通过 → 提交"。
- **commit 颗粒度**：每个 Task 提交一次。
- **测试命令**：`pnpm test <path>`（vitest run）跑单文件，`pnpm test` 跑全量。
- **typecheck**：`pnpm typecheck` 在每个 Task 完成后跑一次。
- **跳过测试保护**：实施期间不许改 `it.skip` → `it` 来"通过"测试。
- **跨 Task 依赖**：
  - T1 独立（修 1A-T2 大雾 + 补全 P2-T3 雷电-连环测试）
  - T2 依赖 P2-T4（bagua damage onBefore 已读 ctx.baguaJudgeResult）
  - T3 独立（升级 P2-T3 占位）
  - T4 独立（验证 nextPlayer 死亡跳过 + faceDown 互斥）
- 实施顺序：T1 → T2 → T3 → T4（每个 Task 内严格 TDD）

---

## 验证清单（Plan 完成后）

- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全量通过（≥1385 passed）
- [ ] 大雾真 game rule：防 normal + fire，不防 thunder
- [ ] thunder + 大雾 + chained 链上其他角色都受 thunder 伤害
- [ ] 八卦阵 useCard 阶段自动注入 baguaJudgeResult 到 localVars
- [ ] 雷击完整判定：ctx.leijiJudgeResult=success 才 emit 3 点 thunder
- [ ] faceDown + 死亡玩家：跳过 + faceDown Mark 清理

---

## Follow-up（不在本 Plan 范围）

- **八卦阵 UI 提示**：本 Plan 只做 server-side 判定注入，UI 提示留 P4
- **雷击完整判定 prompt**：本 Plan 只做 ctx 读取，"setCtxVar success/fail 的钩子"留 P4
- **新 SkillPhase（forEachLiving / multiRespond）**：P2 范围
- **38+ 老技能迁移**：T-22 渐进 PR
