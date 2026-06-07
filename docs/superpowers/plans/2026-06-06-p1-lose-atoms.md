# P1-B 实施计划：抽 `loseHealth` / `loseCard` / `removeSkill` 三原子

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抽 3 个新 atom：`loseHealth`（苦肉）、`loseCard`（过河拆桥 / 借刀失败）、`removeSkill`（断肠 / 化身换技能）。语义独立于 `damage`/`heal`/`discard`/`addSkill`，让"丢失"类副作用统一走单独通道，便于钩子监听。

**Architecture:** 三个独立 atom。`loseHealth` = `health -= n`（无 source、无 type、不进伤害链）；`loseCard` = 把指定 cardId 从 `hand|equipment` 移到 `discardPile`（**不**走 `discard` 那种"玩家选"的语义——`loseCard` 是被动的、不可选的）；`removeSkill` = 从 `state.triggers` 移除该玩家的某 skillId（v2 兼容，不引入 v3 skill 卸载 API）。

**Tech Stack:** TypeScript 5.9 + vitest 4.1 + pnpm。`registerAtom` 单点。

**Spec:** `docs/ENGINE.md` §1.2（待新增 atom 列表）+ §6 P1 `loseHealth` / `loseCard` / `removeSkill` 三项。

**Non-Goals:**
- 不实现苦肉 / 过河拆桥 / 断肠技能本身（只做底层 atom）
- 不重做 `discard` 语义（`loseCard` 区别于 `discard`：loseCard 是被动移出，discard 是玩家主动）
- 不动 `state.triggers` 数据结构（v2 兼容走现状）

---

## Task 1: `loseHealth` atom

**Files:**
- Modify: `src/src/engine/types.ts:198-235`（Atom 联合加 loseHealth）
- Create: `src/src/engine/atoms/loseHealth.ts`
- Modify: `src/src/engine/atoms/index.ts`（注册）
- Test: `tests/atoms/lose-health.test.ts`

### 1.1 写失败测试

`tests/atoms/lose-health.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('loseHealth atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('loseHealth 等于 health -= n，无 source', () => {
    const s0 = createTestGame({ players: { P1: { health: 4 } } });
    const { state, events } = applyAtoms(s0, [
      { type: 'loseHealth', target: 'P1', amount: 2 },
    ]);
    expect(state.players.P1.health).toBe(2);
    expect(events[0].type).toBe('loseHealth');
    expect(events[0].payload).toMatchObject({ target: 'P1', amount: 2 });
    expect(events[0].payload).not.toHaveProperty('source');
  });

  it('loseHealth 不会触发 damage onAfter 钩子', () => {
    // 关键区别：damage 会触发 registerAtomHook('damage', onAfter)
    // loseHealth 是"失去体力"非"伤害"
    let hookFired = false;
    const s0 = createTestGame({ players: { P1: { health: 4 } } });
    const { state } = applyAtoms(s0, [
      { type: 'loseHealth', target: 'P1', amount: 1 },
    ]);
    expect(hookFired).toBe(false); // 没注册过钩子，纯断言不变量
    expect(state.players.P1.health).toBe(3);
  });

  it('loseHealth 不进濒死（amount=0 时不扣血）', () => {
    // YAGNI：loseHealth 不引发 checkDying，由调用方决定（苦肉先失血再弃牌）
    // 本测试仅验证 amount=0 不出错
    const s0 = createTestGame({ players: { P1: { health: 4 } } });
    const { state } = applyAtoms(s0, [
      { type: 'loseHealth', target: 'P1', amount: 0 },
    ]);
    expect(state.players.P1.health).toBe(4);
  });
});
```

### 1.2 跑测试确认失败

Run: `pnpm test tests/atoms/lose-health.test.ts`
Expected: FAIL（TypeScript：`type: 'loseHealth'` 不在 Atom 联合）

### 1.3 扩 Atom 联合类型

`src/src/engine/types.ts:198-235` 在 `heal` 后新增：

```ts
  | { type: 'loseHealth'; target: Expr<string>; amount: Expr<number> }
```

### 1.4 写 `src/src/engine/atoms/loseHealth.ts`

```ts
import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: 'loseHealth',
    apply(state: GameState, atom: Atom & { type: 'loseHealth' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      if (amount <= 0) return state;
      return updatePlayer(state, target, p => ({
        health: Math.max(0, p.health - amount),
      }));
    },
    toEvents(_state: GameState, atom: Atom & { type: 'loseHealth' }): AtomEventResult {
      const target = atom.target as string;
      const amount = atom.amount as number;
      const payload: Json = { target, amount };
      const server = makeServerEvent('loseHealth', payload);
      return [server, new Map(), makePlayerEvent('loseHealth', payload)];
    },
  });
}
```

### 1.5 注册 atom

`src/src/engine/atoms/index.ts` 加 `import { register as registerLoseHealth } from './loseHealth';` 和 `registerLoseHealth();`。

### 1.6 跑测试确认通过

Run: `pnpm test tests/atoms/lose-health.test.ts`
Expected: PASS

### 1.7 typecheck + 全量 damage/heal 相关测试

Run: `pnpm typecheck && pnpm test tests/atoms/`
Expected: 全部 PASS

### 1.8 提交

```bash
git add src/src/engine/types.ts src/engine/atoms/loseHealth.ts src/engine/atoms/index.ts tests/atoms/lose-health.test.ts
git commit -m "feat(atom): loseHealth atom（独立于 damage，passive health 减少）"
```

---

## Task 2: `loseCard` atom

**Files:**
- Modify: `src/src/engine/types.ts`（加 loseCard 变体）
- Create: `src/src/engine/atoms/loseCard.ts`
- Modify: `src/src/engine/atoms/index.ts`
- Test: `tests/atoms/lose-card.test.ts`

### 2.1 写失败测试

`tests/atoms/lose-card.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('loseCard atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('loseCard: hand → discardPile', () => {
    const s0 = createTestGame({ hand: { P1: ['c1', 'c2'] } });
    const { state, events } = applyAtoms(s0, [
      { type: 'loseCard', cardId: 'c1', from: { zone: 'hand', player: 'P1' } },
    ]);
    expect(state.players.P1.hand).toEqual(['c2']);
    expect(state.zones.discardPile).toContain('c1');
    expect(events[0].type).toBe('loseCard');
  });

  it('loseCard: equipment → discardPile（带装备 slot 清理）', () => {
    const s0 = createTestGame({
      players: { P1: { equipment: { weapon: 'wpn1' } } },
    });
    const { state } = applyAtoms(s0, [
      { type: 'loseCard', cardId: 'wpn1', from: { zone: 'equipment', player: 'P1', slot: 'weapon' } },
    ]);
    expect(state.players.P1.equipment.weapon).toBeUndefined();
    expect(state.zones.discardPile).toContain('wpn1');
  });

  it('loseCard 找不到 cardId 时 noop（不报错）', () => {
    // 重要：loseCard 是被动丢失，调用方不保证 cardId 仍在原 zone
    const s0 = createTestGame({ hand: { P1: ['c1'] } });
    const { state } = applyAtoms(s0, [
      { type: 'loseCard', cardId: 'ghost', from: { zone: 'hand', player: 'P1' } },
    ]);
    expect(state.players.P1.hand).toEqual(['c1']);
  });
});
```

### 2.2 跑测试确认失败

Run: `pnpm test tests/atoms/lose-card.test.ts`
Expected: FAIL（TypeScript：loseCard 不在联合）

### 2.3 扩 Atom 联合类型

`src/src/engine/types.ts` 在 `moveCard` 后新增：

```ts
  | { type: 'loseCard'; cardId: Expr<string>; from: { zone: 'hand' | 'equipment'; player: Expr<string>; slot?: EquipSlot } }
```

> **设计取舍**：`loseCard` 没有 `to` 字段——丢弃目标永远是 `discardPile`（不存牌堆、不存他人手牌）。这与 `moveCard` 的多 zone 表达区分。

### 2.4 写 `src/src/engine/atoms/loseCard.ts`

```ts
import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer, getPlayer } from '../state';

export function register() {
  registerAtom({
    type: 'loseCard',
    apply(state: GameState, atom: Atom & { type: 'loseCard' }): GameState {
      const cardId = atom.cardId as string;
      const from = atom.from;
      const playerName = from.player as string;

      if (from.zone === 'hand') {
        const player = getPlayer(state, playerName);
        if (!player.hand.includes(cardId)) return state;
        return {
          ...state,
          players: {
            ...state.players,
            [playerName]: {
              ...player,
              hand: player.hand.filter(id => id !== cardId),
            },
          },
          zones: { ...state.zones, discardPile: [...state.zones.discardPile, cardId] },
        };
      }

      if (from.zone === 'equipment') {
        const player = getPlayer(state, playerName);
        const slot = from.slot;
        if (!slot || player.equipment[slot] !== cardId) return state;
        return updatePlayer(
          { ...state, zones: { ...state.zones, discardPile: [...state.zones.discardPile, cardId] } },
          playerName,
          p => {
            const next = { ...p.equipment };
            delete next[slot!];
            return { equipment: next };
          },
        );
      }

      return state;
    },
    toEvents(_state: GameState, atom: Atom & { type: 'loseCard' }): AtomEventResult {
      const cardId = atom.cardId as string;
      const from = atom.from;
      const payload: Json = { cardId, from: { zone: from.zone, player: from.player as string } };
      const server = makeServerEvent('loseCard', payload);
      return [server, new Map(), makePlayerEvent('loseCard', payload)];
    },
  });
}
```

### 2.5 注册 atom

`src/src/engine/atoms/index.ts` 加 `import { register as registerLoseCard } from './loseCard';` 和 `registerLoseCard();`。

### 2.6 跑测试确认通过

Run: `pnpm test tests/atoms/lose-card.test.ts`
Expected: PASS

### 2.7 typecheck + 全量

Run: `pnpm typecheck && pnpm test`
Expected: 全部 PASS

### 2.8 提交

```bash
git add src/src/engine/types.ts src/engine/atoms/loseCard.ts src/engine/atoms/index.ts tests/atoms/lose-card.test.ts
git commit -m "feat(atom): loseCard atom（passive card 丢失，hand/equipment → discardPile）"
```

---

## Task 3: `removeSkill` atom

**Files:**
- Modify: `src/src/engine/types.ts`（加 removeSkill 变体）
- Create: `src/src/engine/atoms/removeSkill.ts`
- Modify: `src/src/engine/atoms/index.ts`
- Test: `tests/atoms/remove-skill.test.ts`

### 3.1 写失败测试

`tests/atoms/remove-skill.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';
import type { TriggerRule } from '@engine/types';

describe('removeSkill atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('removeSkill 从 state.triggers 移除该玩家该 skill 的全部 TriggerRule', () => {
    const trigger: TriggerRule = {
      player: 'P1',
      skillId: '断肠',
      source: 'character',
      event: 'phaseBegin',
    };
    const s0 = {
      ...createTestGame(),
      triggers: [trigger],
    };
    const { state, events } = applyAtoms(s0, [
      { type: 'removeSkill', player: 'P1', skillId: '断肠' },
    ]);
    expect(state.triggers).toEqual([]);
    expect(events[0].type).toBe('removeSkill');
  });

  it('removeSkill 不影响其他玩家的同名技能', () => {
    const s0 = {
      ...createTestGame(),
      triggers: [
        { player: 'P1', skillId: '断肠', source: 'character' as const, event: 'phaseBegin' as const },
        { player: 'P2', skillId: '断肠', source: 'character' as const, event: 'phaseBegin' as const },
      ],
    };
    const { state } = applyAtoms(s0, [
      { type: 'removeSkill', player: 'P1', skillId: '断肠' },
    ]);
    expect(state.triggers).toHaveLength(1);
    expect(state.triggers[0].player).toBe('P2');
  });

  it('removeSkill 不存在的 skillId 是 noop', () => {
    const s0 = {
      ...createTestGame(),
      triggers: [
        { player: 'P1', skillId: '激将', source: 'character' as const, event: 'phaseBegin' as const },
      ],
    };
    const { state } = applyAtoms(s0, [
      { type: 'removeSkill', player: 'P1', skillId: '鬼道' },
    ]);
    expect(state.triggers).toHaveLength(1);
  });
});
```

### 3.2 跑测试确认失败

Run: `pnpm test tests/atoms/remove-skill.test.ts`
Expected: FAIL（TypeScript：removeSkill 不在联合）

### 3.3 扩 Atom 联合类型

`src/src/engine/types.ts` 在 `addSkill` 后新增：

```ts
  | { type: 'removeSkill'; player: Expr<string>; skillId: string }
```

### 3.4 写 `src/src/engine/atoms/removeSkill.ts`

```ts
import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';

export function register() {
  registerAtom({
    type: 'removeSkill',
    apply(state: GameState, atom: Atom & { type: 'removeSkill' }): GameState {
      const player = atom.player as string;
      const skillId = atom.skillId;
      return {
        ...state,
        triggers: state.triggers.filter(t => !(t.player === player && t.skillId === skillId)),
      };
    },
    toEvents(_state: GameState, atom: Atom & { type: 'removeSkill' }): AtomEventResult {
      const player = atom.player as string;
      const skillId = atom.skillId;
      const payload: Json = { player, skillId };
      const server = makeServerEvent('removeSkill', payload);
      return [server, new Map(), makePlayerEvent('removeSkill', payload)];
    },
  });
}
```

### 3.5 注册 atom

`src/src/engine/atoms/index.ts` 加 `import { register as registerRemoveSkill } from './removeSkill';` 和 `registerRemoveSkill();`。

### 3.6 跑测试确认通过

Run: `pnpm test tests/atoms/remove-skill.test.ts`
Expected: PASS

### 3.7 typecheck + 全量

Run: `pnpm typecheck && pnpm test`
Expected: 全部 PASS（v2 兼容：v3 skill 不在 state.triggers 中，removeSkill 只删 v2 路径，不动 v3 注册表）

### 3.8 提交

```bash
git add src/src/engine/types.ts src/engine/atoms/removeSkill.ts src/engine/atoms/index.ts tests/atoms/remove-skill.test.ts
git commit -m "feat(atom): removeSkill atom（v2 兼容，从 state.triggers 移除）"
```

---

## 工作约定（Plan 1B 适用）

- **TDD 顺序**：每个 Task 内"写失败测试 → 跑确认失败 → 写最小实现 → 跑确认通过 → 提交"。
- **commit 颗粒度**：每个 Task 提交一次。
- **测试命令**：`pnpm test <path>`（vitest run）跑单文件，`pnpm test` 跑全量。
- **typecheck**：`pnpm typecheck` 在每个 Task 完成后跑一次。
- **跳过测试保护**：实施期间不许改 `it.skip` → `it` 来"通过"测试。

---

## 验证清单（Plan 完成后）

- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全量通过
- [ ] `loseHealth` 行为独立于 `damage`（不触发 damage 钩子链）
- [ ] `loseCard` 与 `discard` 区分：loseCard 是被动移出，destination 固定 discardPile
- [ ] `removeSkill` 只影响指定玩家的指定 skill，不误伤
