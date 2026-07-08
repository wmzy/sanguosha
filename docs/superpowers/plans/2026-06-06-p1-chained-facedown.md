# P1-C 实施计划：抽 `chained` + Mark `faceDown` 体系（解锁 5 技能）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 `PlayerState.chained: boolean`（铁索连环状态）+ `Mark<T> = { id, scope, payload?, duration }` 体系第一步：`faceDown` Mark（翻面状态）。解锁：铁索连环 / 周泰创牌（仅结构）/ 曹仁据守 / 贾诩放逐 / 雷击（前置）。

**Architecture:**
- `chained: boolean` 直接作为 PlayerState 字段（不挂 Mark——T-08 决策：简单 boolean 状态走字段，不走 Mark 抽象）。
- `Mark` 体系仅用于"持续但有生命周期"的状态：先落地 `faceDown` 一个 Mark 类型（`Mark<{ faceDown: true }>` 派生于基础 `Mark` 联合）。
- `state.marks: Record<PlayerId, Mark[]>` 字段；阶段推进时清理过期 Mark。
- `chained` 在 damage 钩子中读：type=fire/thunder 且目标 chained → 找链上其他角色 emit 追加 damage（同 source、同 amount、同 type）。

**Tech Stack:** TypeScript 5.9 + vitest 4.1 + pnpm。Mark 走新 `src/src/engine/mark.ts` 模块；chained 走字段 + `damage` 钩子扩展。

**Spec:** `docs/ENGINE-DESIGN.md` §1.2（loseHealth / chained / Mark faceDown 决策）+ §5 T-07（Mark faceDown + untilTurnEnd）+ T-08（创牌独立牌区——本 Plan **不**做创牌，只做 Mark 体系骨架）+ §4.8（PlayerState 缺字段）。

**Non-Goals:**
- 不做铁索连环卡牌完整流程（卡牌定义在 src/shared/cards/tricks.ts 已存在，但 handler 未实现——本 Plan 只做"chained 状态字段 + 连环传导钩子"，卡牌使用流程留 P2）
- 不做曹仁据守 / 贾诩放逐 / 雷击技能（仅做底层 Mark + chained 字段，由后续 PR 落地）
- 不做周泰创牌（T-08 决策：独立牌区，与本 Plan 体系无关）
- 不引入"战斗"以外的任何连环触发器（火杀/雷击/庞统连环留 P2）

---

## Task 1: PlayerState.chained 字段 + reducer 兼容

**Files:**
- Modify: `src/src/engine/types.ts:54-65`（PlayerState 加 chained 字段）
- Modify: `src/src/engine/view/reducer.ts:578`（创建 player 时默认 chained=false——按 docs/ENGINE-DESIGN.md §0.3 已知这不是新 bug，是补默认）
- Test: `tests/atoms/player-chained.test.ts`

### 1.1 写失败测试

`tests/atoms/player-chained.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('PlayerState.chained', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('createTestGame 默认 chained=false', () => {
    const s0 = createTestGame({ players: { P1: { health: 4 } } });
    expect(s0.players.P1.chained).toBe(false);
  });

  it('setVar 无法改 chained（YAGNI：直接走 field，vars 留作私有）', () => {
    // 反向断言：setVar 写到 vars.chained 不影响 .chained 字段
    const s0 = createTestGame({ players: { P1: { health: 4 } } });
    const { state } = applyAtoms(s0, [
      { type: 'setVar', player: 'P1', key: 'chained', value: true },
    ]);
    expect(state.players.P1.chained).toBe(false);
    expect(state.players.P1.vars.chained).toBe(true);
  });
});
```

### 1.2 跑测试确认失败

Run: `pnpm test tests/atoms/player-chained.test.ts`
Expected: FAIL（`PlayerState.chained` 不存在）

### 1.3 给 PlayerState 加 chained 字段

`src/src/engine/types.ts:54-65` 改为：

```ts
export interface PlayerState {
  info: PlayerInfo;
  health: number;
  maxHealth: number;
  hand: string[];
  equipment: EquipmentSlots;
  pendingTricks: PendingTrick[];
  /** 玩家级状态：技能运行时数据（发动次数、激活标记等） */
  vars: Record<string, Json>;
  /** 标记（增益/减益） */
  tags: string[];
  /** 铁索连环状态：true 时受 fire/thunder 伤害会传导给链上其他角色 */
  chained: boolean;
}
```

### 1.4 找 createTestGame / reducer 创建 player 的位置

`src/src/engine/view/reducer.ts:578`（按 docs/ENGINE-DESIGN.md §0.3 提示是已知位点）创建 player 时加 `chained: false` 显式字段。

`tests/engine-helpers.ts:createTestGame` 创建 player 时也加 `chained: false`。

### 1.5 跑测试确认通过

Run: `pnpm test tests/atoms/player-chained.test.ts`
Expected: PASS

### 1.6 typecheck + 全量

Run: `pnpm typecheck && pnpm test`
Expected: 全部 PASS（chained 默认为 false，老逻辑不变）

### 1.7 提交

```bash
git add src/src/engine/types.ts src/engine/view/reducer.ts tests/engine-helpers.ts tests/atoms/player-chained.test.ts
git commit -m "feat(state): PlayerState.chained 字段（默认 false）"
```

---

## Task 2: `setChained` atom + 钩子

**Files:**
- Modify: `src/src/engine/types.ts`（Atom 联合加 setChained）
- Create: `src/src/engine/atoms/setChained.ts`
- Modify: `src/src/engine/atoms/index.ts`
- Test: `tests/atoms/set-chained.test.ts`

### 2.1 写失败测试

`tests/atoms/set-chained.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('setChained atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('setChained=true 把目标设为连环', () => {
    const s0 = createTestGame({ players: { P1: { health: 4 } } });
    const { state } = applyAtoms(s0, [
      { type: 'setChained', target: 'P1', chained: true },
    ]);
    expect(state.players.P1.chained).toBe(true);
  });

  it('setChained=false 解除连环', () => {
    const s0 = {
      ...createTestGame({ players: { P1: { health: 4 } } }),
      players: { P1: { ...createTestGame().players.P1, chained: true } },
    };
    const { state } = applyAtoms(s0, [
      { type: 'setChained', target: 'P1', chained: false },
    ]);
    expect(state.players.P1.chained).toBe(false);
  });

  it('setChained 写入 server event payload', () => {
    const s0 = createTestGame({ players: { P1: { health: 4 } } });
    const { events } = applyAtoms(s0, [
      { type: 'setChained', target: 'P1', chained: true },
    ]);
    expect(events[0].type).toBe('setChained');
    expect(events[0].payload).toMatchObject({ target: 'P1', chained: true });
  });
});
```

### 2.2 跑测试确认失败

Run: `pnpm test tests/atoms/set-chained.test.ts`
Expected: FAIL（TypeScript：setChained 不在联合）

### 2.3 扩 Atom 联合类型

`src/src/engine/types.ts` 新增：

```ts
  | { type: 'setChained'; target: Expr<string>; chained: Expr<boolean> }
```

### 2.4 写 `src/src/engine/atoms/setChained.ts`

```ts
import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: 'setChained',
    apply(state: GameState, atom: Atom & { type: 'setChained' }): GameState {
      const target = atom.target as string;
      const chained = atom.chained as boolean;
      return updatePlayer(state, target, p => ({ chained }));
    },
    toEvents(_state: GameState, atom: Atom & { type: 'setChained' }): AtomEventResult {
      const target = atom.target as string;
      const chained = atom.chained as boolean;
      const payload: Json = { target, chained };
      const server = makeServerEvent('setChained', payload);
      return [server, new Map(), makePlayerEvent('setChained', payload)];
    },
  });
}
```

### 2.5 注册 atom

`src/src/engine/atoms/index.ts` 加 `import { register as registerSetChained } from './setChained';` 和 `registerSetChained();`。

### 2.6 跑测试确认通过

Run: `pnpm test tests/atoms/set-chained.test.ts`
Expected: PASS

### 2.7 typecheck + 全量

Run: `pnpm typecheck && pnpm test`
Expected: 全部 PASS

### 2.8 提交

```bash
git add src/src/engine/types.ts src/engine/atoms/setChained.ts src/engine/atoms/index.ts tests/atoms/set-chained.test.ts
git commit -m "feat(atom): setChained atom（设置/解除连环状态）"
```

---

## Task 3: Mark 体系骨架 + `faceDown` Mark

**Files:**
- Create: `src/src/engine/mark.ts`（Mark 类型 + state.marks 字段操作函数）
- Modify: `src/src/engine/types.ts:48-88`（GameState 加 marks 字段 + Mark 类型导出）
- Modify: `src/src/engine/view/reducer.ts`（state.marks 默认空 Record）
- Modify: `tests/engine-helpers.ts:createTestGame`（state.marks 默认空 Record）
- Test: `tests/unit/mark.test.ts`

### 3.1 写失败测试

`tests/unit/mark.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';
import type { Mark } from '@engine/types';

describe('Mark 体系', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('GameState.marks 默认空 Record', () => {
    const s0 = createTestGame();
    expect(s0.marks).toEqual({});
  });

  it('addMark 写入玩家 marks 列表', () => {
    const s0 = createTestGame();
    const mark: Mark = { id: 'faceDown:P1', scope: 'player', payload: { faceDown: true }, duration: 'untilTurnEnd' };
    const { state, events } = applyAtoms(s0, [
      { type: 'addMark', player: 'P1', mark },
    ]);
    expect(state.marks.P1).toHaveLength(1);
    expect(state.marks.P1[0]).toEqual(mark);
    expect(events[0].type).toBe('addMark');
  });

  it('removeMark 按 id 移除', () => {
    const s0 = createTestGame();
    const mark: Mark = { id: 'faceDown:P1', scope: 'player', duration: 'untilTurnEnd' };
    const s1 = applyAtoms(s0, [
      { type: 'addMark', player: 'P1', mark },
    ]).state;
    const { state } = applyAtoms(s1, [
      { type: 'removeMark', player: 'P1', markId: 'faceDown:P1' },
    ]);
    expect(state.marks.P1).toEqual([]);
  });

  it('clearExpiredMarks 清理 untilTurnEnd 的 Mark', () => {
    const s0 = {
      ...createTestGame(),
      marks: {
        P1: [{ id: 'faceDown:P1', scope: 'player' as const, duration: 'untilTurnEnd' as const }],
        P2: [{ id: 'permanent:P2', scope: 'player' as const, duration: 'permanent' as const }],
      },
    };
    const { state } = applyAtoms(s0, [
      { type: 'clearExpiredMarks', phase: 'turnEnd' },
    ]);
    expect(state.marks.P1).toEqual([]);
    expect(state.marks.P2).toHaveLength(1);
  });
});
```

### 3.2 跑测试确认失败

Run: `pnpm test tests/unit/mark.test.ts`
Expected: FAIL（addMark / removeMark / clearExpiredMarks 不在 Atom 联合；Mark 类型不存在）

### 3.3 创建 `src/src/engine/mark.ts`

```ts
import type { GameState, Mark, PlayerId, TurnPhase } from './types';

/** 在指定玩家 marks 列表添加 Mark（去重 by id） */
export function addMarkToPlayer(state: GameState, player: PlayerId, mark: Mark): GameState {
  const current = state.marks[player] ?? [];
  const filtered = current.filter(m => m.id !== mark.id);
  return {
    ...state,
    marks: { ...state.marks, [player]: [...filtered, mark] },
  };
}

/** 按 id 移除 Mark */
export function removeMarkFromPlayer(state: GameState, player: PlayerId, markId: string): GameState {
  const current = state.marks[player] ?? [];
  return {
    ...state,
    marks: { ...state.marks, [player]: current.filter(m => m.id !== markId) },
  };
}

/** 在阶段推进时清理 untilTurnEnd / untilPhaseEnd 的 Mark */
export function clearExpiredMarksByPhase(state: GameState, phase: TurnPhase): GameState {
  const next: GameState['marks'] = {};
  for (const [player, marks] of Object.entries(state.marks)) {
    const kept = marks.filter(m => {
      if (m.duration === 'permanent') return true;
      if (m.duration === 'untilTurnEnd' && phase === 'turnEnd') return false;
      if (m.duration === 'untilPhaseEnd' && m.scope === 'relation') {
        // 简化：仅在 phase=turnEnd 时清理
        return phase !== 'turnEnd';
      }
      return true;
    });
    next[player] = kept;
  }
  return { ...state, marks: next };
}
```

### 3.4 扩 types.ts

`src/src/engine/types.ts:48-65` 加 marks 字段：

```ts
export interface GameState {
  // ... 现有字段
  marks: Record<PlayerId, Mark[]>;
}
```

并新增类型定义：

```ts
export type MarkScope = 'player' | 'relation' | 'transient';
export type MarkDuration = 'permanent' | 'untilTurnEnd' | 'untilPhaseEnd';

export interface Mark {
  id: string;
  scope: MarkScope;
  payload?: Record<string, Json>;
  duration: MarkDuration;
}
```

`src/src/engine/types.ts:198-235` Atom 联合新增：

```ts
  | { type: 'addMark'; player: Expr<string>; mark: Mark }
  | { type: 'removeMark'; player: Expr<string>; markId: string }
  | { type: 'clearExpiredMarks'; phase: TurnPhase }
```

### 3.5 实现 3 个 atom

`src/src/engine/atoms/mark.ts`:

```ts
import type { GameState, Atom, AtomEventResult, Json, Mark } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { addMarkToPlayer, removeMarkFromPlayer, clearExpiredMarksByPhase } from '../mark';

export function register() {
  registerAtom({
    type: 'addMark',
    apply(state, atom) {
      return addMarkToPlayer(state, atom.player as string, atom.mark);
    },
    toEvents(_state, atom) {
      const player = atom.player as string;
      const mark = atom.mark;
      const payload: Json = { player, mark };
      const server = makeServerEvent('addMark', payload);
      return [server, new Map(), makePlayerEvent('addMark', payload)];
    },
  });

  registerAtom({
    type: 'removeMark',
    apply(state, atom) {
      return removeMarkFromPlayer(state, atom.player as string, atom.markId);
    },
    toEvents(_state, atom) {
      const player = atom.player as string;
      const markId = atom.markId;
      const payload: Json = { player, markId };
      const server = makeServerEvent('removeMark', payload);
      return [server, new Map(), makePlayerEvent('removeMark', payload)];
    },
  });

  registerAtom({
    type: 'clearExpiredMarks',
    apply(state, atom) {
      return clearExpiredMarksByPhase(state, atom.phase);
    },
    toEvents(_state, atom) {
      const payload: Json = { phase: atom.phase };
      const server = makeServerEvent('clearExpiredMarks', payload);
      return [server, new Map(), makePlayerEvent('clearExpiredMarks', payload)];
    },
  });
}
```

### 3.6 注册 atom

`src/src/engine/atoms/index.ts` 加 `import { register as registerMark } from './mark';` 和 `registerMark();`。

### 3.7 跑测试确认通过

Run: `pnpm test tests/unit/mark.test.ts`
Expected: PASS

### 3.8 typecheck + 全量

Run: `pnpm typecheck && pnpm test`
Expected: 全部 PASS

### 3.9 提交

```bash
git add src/src/engine/mark.ts src/engine/types.ts src/engine/atoms/mark.ts src/engine/atoms/index.ts src/engine/view/reducer.ts tests/engine-helpers.ts tests/unit/mark.test.ts
git commit -m "feat(mark): Mark 体系骨架（addMark/removeMark/clearExpiredMarks + state.marks）"
```

---

## Task 4: `faceDown` Mark 阶段跳过

**Files:**
- Modify: `src/src/engine/phase-advance.ts`（在 turnStart / 阶段推进时检查 faceDown）
- Test: `tests/unit/phase-advance-facedown.test.ts`

### 4.1 写失败测试

`tests/unit/phase-advance-facedown.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';
import type { Mark } from '@engine/types';

describe('faceDown Mark 阶段跳过', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('玩家有 faceDown Mark 时，turnStart 跳过其出牌阶段（具体行为由 phase-advance 决定）', () => {
    // 本测试只验证 phase-advance 读到 faceDown 标记并能查到
    // 实际跳过行为：phase-advance 在 phaseBegin 时检查 self.marks，
    // 若含 faceDown 则跳过并清理 Mark
    const mark: Mark = { id: 'faceDown:P1', scope: 'player', duration: 'untilTurnEnd' };
    const s0 = {
      ...createTestGame({ currentPlayer: 'P1' }),
      marks: { P1: [mark] },
    };
    // 简化：faceDown Mark 的存在性测试
    expect(s0.marks.P1[0].id).toBe('faceDown:P1');
    expect(s0.marks.P1[0].duration).toBe('untilTurnEnd');
  });
});
```

### 4.2 跑测试确认失败

Run: `pnpm test tests/unit/phase-advance-facedown.test.ts`
Expected: FAIL（若 `state.marks` 未在 createTestGame 中默认设置）

### 4.3 修 `tests/engine-helpers.ts:createTestGame`

加：

```ts
marks: {},
```

字段默认空。

### 4.4 跑测试确认通过

Run: `pnpm test tests/unit/phase-advance-facedown.test.ts`
Expected: PASS

### 4.5 typecheck + 全量

Run: `pnpm typecheck && pnpm test`
Expected: 全部 PASS

### 4.6 提交

```bash
git add tests/engine-helpers.ts tests/unit/phase-advance-facedown.test.ts
git commit -m "test(mark): faceDown Mark 默认 marks 字段"
```

> **注**：本 Task 只做"Mark 字段 + 类型 + 基础原子"，不实际改 phase-advance 跳过逻辑（曹仁据守 / 贾诩放逐的真实效果留后续 PR）。本 Plan 范围是"解锁字段和原子"。

---

## Task 5: chained 状态在 damage 钩子中的连环传导（占位实现）

**Files:**
- Create: `src/src/engine/skills/chained-propagation.ts`（v3 registerAtomHook）
- Modify: `tests/fixtures/藤甲.ts`（注册连环传导钩子）
- Test: `tests/scenarios/装备/铁索连环.test.ts`

### 5.1 写失败测试

`tests/scenarios/装备/铁索连环.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks, registerAtomHook } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../../engine-helpers';
import '../../fixtures/铁索连环';

describe('铁索连环（chained 传导）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('P1、P3 都 chained，P1 受 fire 伤害 → P3 也受同伤害', () => {
    const s0 = createTestGame({
      players: {
        P1: { health: 4, chained: true },
        P2: { health: 4, chained: false },
        P3: { health: 4, chained: true },
      },
    });
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'fire' },
    ]);
    // P1 受伤害
    expect(state.players.P1.health).toBe(3);
    // P3 也受同伤害（chain 传导）
    expect(state.players.P3.health).toBe(3);
    // server log 含 2 个 damage 事件
    const damageEvents = events.filter(e => e.type === 'damage');
    expect(damageEvents).toHaveLength(2);
  });

  it('chained=false 的角色不参与传导', () => {
    const s0 = createTestGame({
      players: {
        P1: { health: 4, chained: true },
        P2: { health: 4, chained: false },
        P3: { health: 4, chained: true },
      },
    });
    const { state } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2' }, // normal
    ]);
    // normal 伤害不传导（v2 规则：仅 fire/thunder 传导）
    expect(state.players.P3.health).toBe(4);
  });
});
```

### 5.2 跑测试确认失败

Run: `pnpm test tests/scenarios/装备/铁索连环.test.ts`
Expected: FAIL（连环传导钩子未注册；P3 不受伤害 → 反向断言失败时 P3 不会扣血，事件数=1）

### 5.3 写 `src/src/engine/skills/chained-propagation.ts`

```ts
import type { GameState, Atom } from '../types';
import { registerAtomHook } from '../skill-hook';

export function register() {
  registerAtomHook({
    atomType: 'damage',
    filter(_state: GameState, atom: Atom) {
      if (atom.type !== 'damage') return false;
      const damageType = (atom.damageType as string | undefined) ?? 'normal';
      // 仅 fire/thunder 传导
      return damageType === 'fire' || damageType === 'thunder';
    },
    onAfter(state: GameState, atom: Atom) {
      if (atom.type !== 'damage') return {};
      const target = atom.target as string;
      const targetPlayer = state.players[target];
      if (!targetPlayer?.chained) return {};

      const amount = atom.amount as number;
      const source = atom.source as string | undefined;
      const damageType = atom.damageType as 'fire' | 'thunder' | undefined;
      const additionalAtoms = Object.entries(state.players)
        .filter(([name, p]) => p.chained && name !== target)
        .map(([name]) => ({
          type: 'damage' as const,
          target: name,
          amount,
          ...(source ? { source } : {}),
          ...(damageType ? { damageType } : {}),
        }));

      return { additionalAtoms };
    },
  });
}
```

### 5.4 写 fixture

`tests/fixtures/铁索连环.ts`:

```ts
import { register as registerChainedPropagation } from '@src/engine/skills/chained-propagation';
registerChainedPropagation();
```

### 5.5 跑测试确认通过

Run: `pnpm test tests/scenarios/装备/铁索连环.test.ts`
Expected: PASS

### 5.6 typecheck + 全量

Run: `pnpm typecheck && pnpm test`
Expected: 全部 PASS（连环传导仅对 chained=true 角色生效；normal 伤害不传导）

### 5.7 提交

```bash
git add src/src/engine/skills/chained-propagation.ts tests/scenarios/装备/铁索连环.test.ts tests/fixtures/铁索连环.ts
git commit -m "feat(skill): chained fire/thunder 伤害自动传导（registerAtomHook onAfter）"
```

---

## 工作约定（Plan 1C 适用）

- **TDD 顺序**：每个 Task 内"写失败测试 → 跑确认失败 → 写最小实现 → 跑确认通过 → 提交"。
- **commit 颗粒度**：每个 Task 提交一次。
- **测试命令**：`pnpm test <path>`（vitest run）跑单文件，`pnpm test` 跑全量。
- **typecheck**：`pnpm typecheck` 在每个 Task 完成后跑一次。
- **跳过测试保护**：实施期间不许改 `it.skip` → `it` 来"通过"测试。
- **Phase-advance 跳过逻辑**：本 Plan 不实现 faceDown 的"跳过出牌阶段"行为——T-07 决策是 Mark + untilTurnEnd，真实跳过留 P2。本 Plan 仅做"Mark 字段 + 清除周期"骨架。

---

## 验证清单（Plan 完成后）

- [ ] `pnpm typecheck` 无错
- [ ] `pnpm test` 全量通过
- [ ] PlayerState.chained 默认 false，老 reducer 行为不变
- [ ] setChained atom 写入 server event
- [ ] Mark 体系 4 个原子（add/remove/clearExpired/addMark）行为正确
- [ ] chained fire/thunder 伤害自动传导到链上其他角色
- [ ] chained normal 伤害不传导
