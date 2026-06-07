# P1-A 实施计划：抽 `damage.type` 字段（解锁 6 技能）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `damage` atom 加 `type: 'normal' | 'fire' | 'thunder'` 字段（[T-11]），让藤甲 / 大雾 / 火杀 / 雷击 / 连环传导 / 雷电伤害技能可读 type 而不靠 cardName 推断。

**Architecture:** 单点修改 `src/src/engine/atoms/damage.ts`：扩展 `damage` atom 类型 + 写入 server event payload + 实现 `chainPropagation` 副作用（连环状态被 §0.3 标记为缺失，本 Task **不引入** chained 字段，只为后续 P1-B 留接口；`chainPropagation` 在 type=thunder/normal 时按 `chained: boolean` 字段传播，没有该字段则不传播——纯依赖驱动）。

**Tech Stack:** TypeScript 5.9 + vitest 4.1 + pnpm。Atom 注册走 `src/src/engine/atom.ts:registerAtom`；事件订阅走 `src/src/engine/skill-hook.ts:registerAtomHook`。

**Spec:** `docs/ENGINE.md` §1.2（damage 无 type 字段）+ §5 T-11（加 type 字段）+ §6 P1 第一项。

**Non-Goals:**
- 不实现 chained 状态字段（Plan 1B）
- 不实现连环传导真实效果（留接口；本 Task 只做"占位 noop"）
- 不实现藤甲/大雾/雷击技能（依赖 type 字段已就位，由后续 PR 落地）
- 不改 damage amount 字段语义

---

## Task 1: damage.type 字段 + 默认 normal

**Files:**
- Modify: `src/src/engine/types.ts:199`（Atom 联合加 type 字段）
- Modify: `src/src/engine/atoms/damage.ts:7-26`（apply/toEvents 读写 type）
- Test: `tests/atoms/damage-type.test.ts`（新）

### 1.1 写失败测试

`tests/atoms/damage-type.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { registerAllAtoms } from '@engine/atoms';
import { clearAtomHooks } from '@engine/skill-hook';
import { createTestGame } from '../engine-helpers';

describe('damage.type', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('默认 type 为 normal，写入 server event payload', () => {
    const s0 = createTestGame({ players: { P1: { health: 4 } } });
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2' },
    ]);
    expect(state.players.P1.health).toBe(3);
    expect(events[0].type).toBe('damage');
    expect(events[0].payload).toMatchObject({ type: 'normal', amount: 1 });
  });

  it('type=fire 写入 payload', () => {
    const s0 = createTestGame({ players: { P1: { health: 3 } } });
    const { events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', type: 'fire' },
    ]);
    expect(events[0].payload).toMatchObject({ type: 'fire' });
  });

  it('type=thunder 写入 payload', () => {
    const s0 = createTestGame({ players: { P1: { health: 3 } } });
    const { events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', type: 'thunder' },
    ]);
    expect(events[0].payload).toMatchObject({ type: 'thunder' });
  });

  it('replay 阶段 fromEvents 重建时 type 字段保留', () => {
    // 验证 reducer.ts 读 serverLog 重建 damage 时不丢 type
    const s0 = createTestGame({ players: { P1: { health: 4 } } });
    const { events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 2, source: 'P2', type: 'fire' },
    ]);
    expect(events[0].payload).toHaveProperty('type', 'fire');
    // 注意：完整 reducer round-trip 由 P0 已建好的 reduceGameState 覆盖
    // 本测试只确认 payload 不丢字段
  });
});
```

### 1.2 跑测试确认失败

Run: `pnpm test tests/atoms/damage-type.test.ts`
Expected: FAIL（TypeScript 编译错误：`type` 不在 damage atom 联合类型中）

### 1.3 扩 Atom 联合类型

`src/src/engine/types.ts:199` 把：

```ts
  | { type: 'damage'; target: Expr<string>; amount: Expr<number>; source?: Expr<string>; cardId?: Expr<string> }
```

改为：

```ts
  | { type: 'damage'; target: Expr<string>; amount: Expr<number>; source?: Expr<string>; cardId?: Expr<string>; damageType?: Expr<'normal' | 'fire' | 'thunder'> }
```

> **字段名说明**：用 `damageType` 而非 `type` 避免和 Atom 联合的 `type: 'damage'` 判别字段冲突。序列化到 server event payload 时命名为 `type`（对外协议保持简洁）。

### 1.4 改 `src/src/engine/atoms/damage.ts`

完整替换为：

```ts
import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

/** damage type 默认值：所有未显式指定的 damage 视为 normal */
const DEFAULT_DAMAGE_TYPE = 'normal' as const;

export function register() {
  registerAtom({
    type: 'damage',
    apply(state: GameState, atom: Atom & { type: 'damage' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      return updatePlayer(state, target, p => ({
        health: p.health - amount,
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: 'damage' }): AtomEventResult {
      const target = atom.target as string;
      const amount = atom.amount as number;
      const source = atom.source as string | undefined;
      const cardId = atom.cardId as string | undefined;
      const damageType = (atom.damageType as 'normal' | 'fire' | 'thunder' | undefined) ?? DEFAULT_DAMAGE_TYPE;
      const payload: Json = {
        target,
        amount,
        type: damageType,
        ...(source ? { source } : {}),
        ...(cardId ? { cardId } : {}),
      };
      const server = makeServerEvent('damage', payload);
      return [server, new Map(), makePlayerEvent('damage', payload)];
    },
  });
}
```

### 1.5 跑测试确认通过

Run: `pnpm test tests/atoms/damage-type.test.ts`
Expected: PASS（4 个用例全过）

### 1.6 跑全量 damage/draw 相关测试 + typecheck

Run: `pnpm typecheck && pnpm test tests/atoms/`
Expected: 全部 PASS（damage 默认 type=normal 行为向后兼容，老的 `damage` atom 调用站点不受影响）

### 1.7 提交

```bash
git add src/src/engine/types.ts src/engine/atoms/damage.ts tests/atoms/damage-type.test.ts
git commit -m "feat(atom): damage.type 字段（normal/fire/thunder），默认 normal"
```

---

## Task 2: damage fire/thunder 防御装备 skill 钩子骨架

**Files:**
- Create: `src/src/engine/skills/tengjia.ts`（v3 registerAtomHook 实现）
- Create: `src/src/engine/skills/daqi.ts`（v3 registerAtomHook 实现）
- Modify: `src/src/engine/skills/equipment.ts`（删旧 stub；不删装备注册，删 handler 空壳）
- Test: `tests/scenarios/装备/藤甲.test.ts`（新）
- Test: `tests/scenarios/装备/大雾.test.ts`（新）

### 2.1 写失败测试：藤甲防止 fire 伤害

`tests/scenarios/装备/藤甲.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks, registerAtomHook } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../../engine-helpers';
import '../../fixtures/藤甲'; // 注册技能钩子

describe('藤甲（火伤免疫）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('装备藤甲受 fire 伤害时，cancel 整个链', () => {
    const s0 = createTestGame({
      players: {
        P1: { health: 4, equipment: { armor: 'tengjia' } },
        P2: { health: 4 },
      },
    });
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'fire' },
    ]);
    expect(state.players.P1.health).toBe(4); // 没扣
    expect(events).toHaveLength(0); // damage 被 cancel，连 server event 都不发
  });

  it('藤甲对 normal 伤害不生效', () => {
    const s0 = createTestGame({
      players: {
        P1: { health: 4, equipment: { armor: 'tengjia' } },
      },
    });
    const { state } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2' },
    ]);
    expect(state.players.P1.health).toBe(3);
  });

  it('藤甲对 thunder 伤害不生效', () => {
    const s0 = createTestGame({
      players: {
        P1: { health: 4, equipment: { armor: 'tengjia' } },
      },
    });
    const { state } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBe(3);
  });
});
```

### 2.2 跑测试确认失败

Run: `pnpm test tests/scenarios/装备/藤甲.test.ts`
Expected: FAIL（`tests/fixtures/藤甲` 不存在，藤甲钩子未注册）

### 2.3 写 `src/src/engine/skills/tengjia.ts`

```ts
import type { GameState, Atom } from '../types';
import { registerAtomHook } from '../skill-hook';
import { getPlayer } from '../state';

const TENGJIA_ID = 'tengjia';

export function register() {
  registerAtomHook({
    atomType: 'damage',
    filter(state: GameState, atom: Atom) {
      if (atom.type !== 'damage') return false;
      const target = atom.target as string;
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.equipment.armor !== TENGJIA_ID) return false;
      const damageType = (atom.damageType as string | undefined) ?? 'normal';
      return damageType === 'fire';
    },
    onBefore() {
      // 藤甲：fire 伤害全防
      return { cancel: true };
    },
  });
}
```

### 2.4 写 `src/src/engine/skills/daqi.ts`（大雾：thunder 伤害无效）

> 大雾与藤甲对称。实现防 thunder。

```ts
import type { GameState, Atom } from '../types';
import { registerAtomHook } from '../skill-hook';
import { getPlayer } from '../state';

const DAQI_ID = 'daqi';

export function register() {
  registerAtomHook({
    atomType: 'damage',
    filter(state: GameState, atom: Atom) {
      if (atom.type !== 'damage') return false;
      const target = atom.target as string;
      const targetPlayer = getPlayer(state, target);
      if (targetPlayer.equipment.armor !== DAQI_ID) return false;
      const damageType = (atom.damageType as string | undefined) ?? 'normal';
      return damageType === 'thunder';
    },
    onBefore() {
      return { cancel: true };
    },
  });
}
```

### 2.5 写 fixture 文件

`tests/fixtures/藤甲.ts`:

```ts
import { register as registerTengjia } from '@src/engine/skills/tengjia';
import { register as registerDaqi } from '@src/engine/skills/daqi';

registerTengjia();
registerDaqi();
```

### 2.6 跑测试确认通过

Run: `pnpm test tests/scenarios/装备/藤甲.test.ts tests/scenarios/装备/大雾.test.ts`
Expected: PASS

### 2.7 跑全量 + typecheck

Run: `pnpm typecheck && pnpm test`
Expected: 全部 PASS（damage.type 字段、藤甲/大雾钩子都是新增，老的 damage 调用站点 default 行为不变）

### 2.8 提交

```bash
git add src/src/engine/skills/tengjia.ts src/engine/skills/daqi.ts tests/scenarios/装备/藤甲.test.ts tests/scenarios/装备/大雾.test.ts tests/fixtures/藤甲.ts
git commit -m "feat(skill): 藤甲/大雾 v3 registerAtomHook 实现（fire/thunder 免疫）"
```

---

## 工作约定（Plan 1A 适用）

- **TDD 顺序**：每个 Task 内"写失败测试 → 跑确认失败 → 写最小实现 → 跑确认通过 → 提交"。
- **commit 颗粒度**：每个 Task 提交一次。
- **跳过测试保护**：实施期间不许改 `it.skip` → `it` 来"通过"测试。
- **测试命令**：`pnpm test <path>`（vitest run）跑单文件，`pnpm test` 跑全量。
- **typecheck**：`pnpm typecheck` 在每个 Task 完成后跑一次。

---

## 验证清单（Plan 完成后）

- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全量通过（1315+ 测试）
- [ ] damage atom payload 包含 `type: 'normal' | 'fire' | 'thunder'`
- [ ] 藤甲防 fire 不写 server event
- [ ] 大雾防 thunder 不写 server event
- [ ] 老 `damage` atom 调用站点（无 `damageType` 字段）行为完全一致
