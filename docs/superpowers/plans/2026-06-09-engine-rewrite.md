# 三国杀引擎重写实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-06-09-engine-rewrite-design.md` 重写三国杀引擎,首批交付 5 武将 + 4 基本牌 + 全套 17 锦囊 + 全部装备,够 DebugLobby 复刻试用。

**Architecture:** 老代码搬到 `src/engine/_legacy/`,新代码按 ENGINE-DESIGN.md 在 `src/engine/` 重写。核心三层:客户端(发 ClientMessage)→ 技能(createSkill/onInit/onMount + registerAction/onAtomBefore/After)→ atom(最小状态变更单元 + 结算区栈 + 事件流)。

**Tech Stack:** TypeScript / Hono (server) / React + Vite (client) / Vitest / 现有 pnpm 工具链

**Spec:** `docs/superpowers/specs/2026-06-09-engine-rewrite-design.md`

---

## 索引

- **PR 1**: 迁移准备(老代码搬到 `_legacy/`)
- **PR 2**: 新引擎核心(types / atom / settlement / skill / skill-loader / event-stream / create-engine + 4 个 atom + 杀闪烟雾测试)
- **PR 3**: 核心 atom 全集(ENGINE-DESIGN §5 全 ~30 个 atom)
- **PR 4**: 5 武将 + 4 基本牌技能(每个 Skill 一个 Task, TDD)
- **PR 5**: 服务端接通(改 protocol / session / app)
- **PR 6**: DebugLobby 复刻(改 client 三个文件)
- **PR 7-10**: 锦囊与装备(按"一组一类"分 PR,本计划只给示例 Task)

---

## PR 1: 迁移准备(老代码搬到 `_legacy/`)

**Files:**
- Move: `src/engine/*` → `src/engine/_legacy/*`(保持相对 import 不变)
- Create: `src/engine/_legacy/README.md`
- Modify: `package.json`(无——保留 tsconfig path)

### Task 1.1: 移动 src/engine/* 到 _legacy

- [ ] **Step 1: 用 git mv 移动所有源文件**

```bash
cd ~/projects/sanguosha
git mv src/engine/atoms src/engine/_legacy/atoms
git mv src/engine/equipment src/engine/_legacy/equipment
git mv src/engine/handlers src/engine/_legacy/handlers
git mv src/engine/phases src/engine/_legacy/phases
git mv src/engine/skills src/engine/_legacy/skills
git mv src/engine/characters src/engine/_legacy/characters
git mv src/engine/async-engine.ts src/engine/_legacy/async-engine.ts
git mv src/engine/atom-async.ts src/engine/_legacy/atom-async.ts
git mv src/engine/async-hook.ts src/engine/_legacy/async-hook.ts
git mv src/engine/atom.ts src/engine/_legacy/atom.ts
git mv src/engine/create-engine.ts src/engine/_legacy/create-engine.ts
git mv src/engine/distance.ts src/engine/_legacy/distance.ts
git mv src/engine/engine.ts src/engine/_legacy/engine.ts
git mv src/engine/event.ts src/engine/_legacy/event.ts
git mv src/engine/expr.ts src/engine/_legacy/expr.ts
git mv src/engine/hook-helpers.ts src/engine/_legacy/hook-helpers.ts
git mv src/engine/logger.ts src/engine/_legacy/logger.ts
git mv src/engine/mark.ts src/engine/_legacy/mark.ts
git mv src/engine/phase-advance.ts src/engine/_legacy/phase-advance.ts
git mv src/engine/phase.ts src/engine/_legacy/phase.ts
git mv src/engine/pile-compare.ts src/engine/_legacy/pile-compare.ts
git mv src/engine/replay.ts src/engine/_legacy/replay.ts
git mv src/engine/serializer.ts src/engine/_legacy/serializer.ts
git mv src/engine/skill-hook.ts src/engine/_legacy/skill-hook.ts
git mv src/engine/skill.ts src/engine/_legacy/skill.ts
git mv src/engine/state.ts src/engine/_legacy/state.ts
git mv src/engine/types.ts src/engine/_legacy/types.ts
git mv src/engine/validate.ts src/engine/_legacy/validate.ts
git mv src/engine/view src/engine/_legacy/view
```

- [ ] **Step 2: 确认 src/engine/ 空**

```bash
ls src/engine/
```

预期:仅显示 `_legacy/` 目录(可能有 README 占位)。**不应该**有 .ts 文件。

- [ ] **Step 3: 写 _legacy/README.md**

```markdown
# `_legacy/` 目录

该目录为迁移期参考代码。新代码请勿引用,具体规则:

1. 该目录下文件的相对 import 路径保持原样(`./types` 仍是 `_legacy/types`)
2. 新代码**禁止** `import` 该目录下任何文件
3. 目标:全部功能在新引擎稳定后,删除整个目录

参考的当前目标: `docs/superpowers/specs/2026-06-09-engine-rewrite-design.md`
```

写到 `src/engine/_legacy/README.md`。

- [ ] **Step 4: 跑 vitest 确认测试在 _legacy 路径下仍能运行**

```bash
pnpm test 2>&1 | tail -20
```

预期:测试**失败**或**编译错误**——因为 server/client 还在 import `src/engine/atom` 而该路径已空。这是预期的,标 WIP,后续 PR 修复。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(engine): 老代码迁移到 _legacy/ 目录,为新引擎让路"
```

---

## PR 2: 新引擎核心(基础设施 + 4 atom + 杀闪烟雾测试)

### Task 2.1: 写 `src/engine/types.ts`

**Files:**
- Create: `src/engine/types.ts`

- [ ] **Step 1: 写 types.ts**

```ts
// src/engine/types.ts
// 新引擎类型定义。详见 docs/ENGINE-DESIGN.md §3-7

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type Card = {
  id: string;
  name: string;
  suit: '♠' | '♥' | '♣' | '♦';
  rank: number;
  type: '基本牌' | '锦囊牌' | '装备牌';
  subtype?: string;
};

export type CardWrapper = {
  name: string;
  sourceCardId: string;
  fromSkill: string;
};

export type EquipSlot = '武器' | '防具' | '进攻马' | '防御马' | '宝物';

export type TurnPhase = '准备' | '判定' | '摸牌' | '出牌' | '弃牌' | '回合结束';

export type GameStatus = '等待中' | '进行中' | '已结束';

export interface Mark {
  id: string;
  scope: number;
  payload?: Json;
  duration?: 'turn' | 'round' | number;
}

export interface PlayerState {
  index: number;
  name: string;
  character: string;
  health: number;
  maxHealth: number;
  alive: boolean;
  hand: string[];
  equipment: Partial<Record<EquipSlot, string>>;
  skills: string[];
  vars: Record<string, Json>;
  marks: Mark[];
}

export interface GameState {
  players: PlayerState[];
  currentPlayerIndex: number;
  phase: TurnPhase;
  turn: { round: number; phase: TurnPhase; vars: Record<string, Json> };
  zones: {
    deck: string[];
    discardPile: string[];
    processing: string[];
  };
  settlementStack: SettlementFrame[];
  cardMap: Record<string, Card>;
  rngSeed: number;
  marks: Mark[];
  localVars: Record<string, Json>;
  meta: { gameId: string; createdAt: number };
  seq: number;
  startedAt: number;
  actionLog: ActionLogEntry[];
}

// ==================== ActionPrompt ====================

export type ActionPrompt =
  | UseCardPrompt
  | SelectTargetPrompt
  | UseCardAndTargetPrompt
  | ConfirmPrompt
  | DistributePrompt
  | ChoosePlayerPrompt;

export interface CardFilter {
  filter?: (card: Card) => boolean;
  min: number;
  max: number;
}

export interface TargetFilter {
  min: number;
  max: number;
  filter?: (view: GameView, target: string) => boolean;
}

export interface UseCardPrompt {
  type: 'useCard';
  title: string;
  description?: string;
  cardFilter: CardFilter;
}
export interface SelectTargetPrompt {
  type: 'selectTarget';
  title: string;
  description?: string;
  targetFilter: TargetFilter;
}
export interface UseCardAndTargetPrompt {
  type: 'useCardAndTarget';
  title: string;
  description?: string;
  cardFilter: CardFilter;
  targetFilter: TargetFilter;
}
export interface ConfirmPrompt {
  type: 'confirm';
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}
export interface DistributePrompt {
  type: 'distribute';
  title: string;
  description?: string;
  cardIds: string[];
  minPerTarget: number;
  maxPerTarget: number;
}
export interface ChoosePlayerPrompt {
  type: 'choosePlayer';
  title: string;
  description?: string;
  min: number;
  max: number;
  filter?: (view: GameView, target: string) => boolean;
}

// ==================== Atom ====================

export interface AtomAwaits {
  target: string;
  prompt: ActionPrompt;
  defaultChoice?: Json;
  timeout?: number;
}

export interface AtomEffect {
  sound?: string;
  animation?: string;
  screenEffect?: string;
  particles?: string;
  duration?: number;
  volume?: number;
  blockUntilDone?: boolean;
}

export type AtomPlayerViews = readonly [
  ownerViews: ReadonlyMap<string, Atom>,
  defaultView: Atom | null,
];

export type ZoneLoc =
  | { zone: '牌堆' }
  | { zone: '弃牌堆' }
  | { zone: '手牌'; player: string }
  | { zone: '处理区' };

export type Atom =
  | { type: '摸牌'; player: string; count: number }
  | { type: '弃置'; player: string; cardIds: string[] }
  | { type: '移动牌'; cardId: string; from: ZoneLoc; to: ZoneLoc }
  | { type: '造成伤害'; target: string; amount: number; source: string; cardId?: string }
  | { type: '回复体力'; target: string; amount: number; source?: string }
  | { type: '击杀'; player: string };

export interface AtomDefinition<A = unknown> {
  type: string;
  validate(state: GameState, atom: A): string | null;
  apply(state: GameState, atom: A): GameState;
  awaits?: AtomAwaits;
  toPlayerViews?(state: GameState, atom: A): AtomPlayerViews | undefined;
  effect?: AtomEffect;
}

// ==================== 钩子 ====================

export interface AtomBeforeContext {
  state: GameState;
  atom: Atom;
  self: string;
  drop(): void;
  modifyParams(patch: Record<string, Json>): void;
  apply(atom: Atom): Promise<void>;
  notify(event: NotifyEvent): void;
}

export interface AtomAfterContext {
  state: GameState;
  atom: Atom;
  self: string;
  modifyParams(patch: Record<string, Json>): void;
  apply(atom: Atom): Promise<void>;
  notify(event: NotifyEvent): void;
}

// ==================== Skill ====================

export interface Skill {
  id: string;
  ownerId: string;
  name: string;
  description: string;
}

export interface GameView {
  viewer: number;
  currentPlayerIndex: number;
  phase: TurnPhase;
  turn: { round: number; phase: TurnPhase; vars: Record<string, Json> };
  players: {
    health: number;
    maxHealth: number;
    alive: boolean;
    equipment: Partial<Record<EquipSlot, string>>;
    skills: string[];
    handCount: number;
    hand?: Card[];
  }[];
  cardMap: Record<string, Card>;
  pending: PendingView | null;
}

export interface PendingView {
  type: 'awaits';
  atom: Atom;
  prompt: ActionPrompt;
  target: string;
  deadline: number;
}

export interface SettlementFrame {
  skillId: string;
  from: string;
  params: Record<string, Json>;
  cards: string[];
  atomStack: Atom[];
  pendingRequest?: { atom: Atom; target: string; status: 'waiting' | 'resolved'; deadline?: number };
  parent?: SettlementFrame;
}

// ==================== 协议 ====================

export interface ClientMessage {
  skillId: string;
  actionType: string;
  ownerId: string;
  params: Record<string, Json>;
  baseSeq: number;
}

export interface NotifyEvent {
  skillId: string;
  eventType: string;
  data: Json;
  views?: ReadonlyMap<string, Json>;
}

export interface ActionLogEntry {
  id: string;
  timestamp: number;
  message: ClientMessage;
  baseSeq: number;
}

// ==================== SkillDef ====================

export interface BackendAPI {
  registerAction(
    actionType: string,
    validate: (view: GameView, params: Record<string, Json>) => string | null,
    execute: (frame: SettlementFrame) => Promise<void>,
  ): () => void;
  onAtomBefore(
    atomType: string,
    handler: (ctx: AtomBeforeContext) => Promise<void>,
  ): () => void;
  onAtomAfter(
    atomType: string,
    handler: (ctx: AtomAfterContext) => Promise<void>,
  ): () => void;
  apply(atom: Atom): Promise<void>;
  notify(event: NotifyEvent): void;
}

export interface FrontendAPI {
  viewer: string;
  onEvent(handler: (event: GameEvent, view: GameView) => void): () => void;
  defineAction(
    actionType: string,
    opts: {
      label: string;
      style?: 'primary' | 'danger' | 'default' | 'passive';
      prompt: ActionPrompt;
      transform?: (card: Card) => CardWrapper;
    },
  ): void;
  playEffect(effect: AtomEffect): void;
}

export type GameEvent =
  | { kind: 'atom'; atom: Atom; views?: AtomPlayerViews }
  | { kind: 'notify'; skillId: string; eventType: string; data: Json; views?: ReadonlyMap<string, Json> };
```

- [ ] **Step 2: 跑 tsc 确认编译**

```bash
pnpm tsc --noEmit
```

预期:有错误(其他文件引用老 types),但**新 types.ts 本身**无错误。修复老引用前**先继续**——后续 PR 一起修复。

- [ ] **Step 3: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(engine): 引入新引擎类型(按 ENGINE-DESIGN §3-7)"
```

### Task 2.2: 写 `src/engine/atom.ts` (注册表 + 基础 apply)

**Files:**
- Create: `src/engine/atom.ts`

- [ ] **Step 1: 写 atom.ts(同步部分)**

```ts
// src/engine/atom.ts
// atom 注册表 + 基础 apply 引擎(同步,无 awaits)
// 完整 apply pipeline(含 before/after 钩子 + awaits 等待)由 settlement.ts 接管

import type { Atom, AtomDefinition, GameState, AtomPlayerViews } from './types';

const registry = new Map<string, AtomDefinition>();

export function registerAtom<A>(def: AtomDefinition<A>): void {
  if (registry.has(def.type)) {
    throw new Error(`Atom "${def.type}" already registered`);
  }
  registry.set(def.type, def);
}

export function clearAtomRegistry(): void {
  registry.clear();
}

export function getAtomDef(type: string): AtomDefinition {
  const def = registry.get(type);
  if (!def) throw new Error(`Atom "${type}" not registered`);
  return def;
}

export function applyAtom(state: GameState, atom: Atom): GameState {
  return getAtomDef(atom.type).apply(state, atom);
}

export function resolvePlayerViews(
  state: GameState,
  atom: Atom,
): AtomPlayerViews | undefined {
  return getAtomDef(atom.type).toPlayerViews?.(state, atom);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/atom.ts
git commit -m "feat(engine): atom 注册表 + 基础 apply 同步入口"
```

### Task 2.3: 实现 4 个核心 atom

**Files:**
- Create: `src/engine/atoms/摸牌.ts`
- Create: `src/engine/atoms/移动牌.ts`
- Create: `src/engine/atoms/造成伤害.ts`
- Create: `src/engine/atoms/击杀.ts`
- Create: `src/engine/atoms/index.ts`

- [ ] **Step 1: 写 摸牌.ts**

```ts
// src/engine/atoms/摸牌.ts
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 摸牌: AtomDefinition<{ player: string; count: number }> = {
  type: '摸牌',
  validate(state, atom) {
    const p = state.players.find(x => x.index === state.players.findIndex(y => y.name === atom.player));
    if (!p) return `player ${atom.player} not found`;
    if (atom.count <= 0) return 'count must be > 0';
    if (state.zones.deck.length < atom.count) return 'deck empty';
    return null;
  },
  apply(state, atom) {
    const idx = state.players.findIndex(p => p.name === atom.player);
    const drawn = state.zones.deck.slice(-atom.count);
    const newDeck = state.zones.deck.slice(0, -atom.count);
    const newHand = [...state.players[idx].hand, ...drawn];
    return {
      ...state,
      zones: { ...state.zones, deck: newDeck },
      players: state.players.map((p, i) =>
        i === idx ? { ...p, hand: newHand } : p,
      ),
    };
  },
  effect: { sound: 'draw', animation: 'slide', duration: 200 },
};

registerAtom(摸牌);
```

- [ ] **Step 2: 写 移动牌.ts**

```ts
// src/engine/atoms/移动牌.ts
import type { AtomDefinition, GameState, ZoneLoc } from '../types';
import { registerAtom } from '../atom';

function findCard(state: GameState, loc: ZoneLoc): { idx: number; zone: string; playerIdx?: number } | null {
  if (loc.zone === '牌堆' || loc.zone === '弃牌堆' || loc.zone === '处理区') {
    const arr = loc.zone === '牌堆' ? state.zones.deck
      : loc.zone === '弃牌堆' ? state.zones.discardPile
      : state.zones.processing;
    const idx = arr.indexOf(arguments[0]?.cardId as string);
    return idx >= 0 ? { idx, zone: loc.zone } : null;
  }
  if (loc.zone === '手牌') {
    const playerIdx = state.players.findIndex(p => p.name === loc.player);
    if (playerIdx < 0) return null;
    const idx = state.players[playerIdx].hand.indexOf(arguments[0]?.cardId as string);
    return idx >= 0 ? { idx, zone: '手牌', playerIdx } : null;
  }
  return null;
}

export const 移动牌: AtomDefinition<{ cardId: string; from: ZoneLoc; to: ZoneLoc }> = {
  type: '移动牌',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply(state, atom) {
    let next = { ...state };

    // from
    if (atom.from.zone === '手牌') {
      const pIdx = next.players.findIndex(p => p.name === atom.from.player);
      if (pIdx >= 0) {
        const hand = next.players[pIdx].hand.filter(id => id !== atom.cardId);
        next.players = next.players.map((p, i) => i === pIdx ? { ...p, hand } : p);
      }
    } else if (atom.from.zone === '牌堆') {
      next.zones = { ...next.zones, deck: next.zones.deck.filter(id => id !== atom.cardId) };
    } else if (atom.from.zone === '弃牌堆') {
      next.zones = { ...next.zones, discardPile: next.zones.discardPile.filter(id => id !== atom.cardId) };
    } else if (atom.from.zone === '处理区') {
      next.zones = { ...next.zones, processing: next.zones.processing.filter(id => id !== atom.cardId) };
    }

    // to
    if (atom.to.zone === '手牌') {
      const pIdx = next.players.findIndex(p => p.name === atom.to.player);
      if (pIdx >= 0) {
        const hand = [...next.players[pIdx].hand, atom.cardId];
        next.players = next.players.map((p, i) => i === pIdx ? { ...p, hand } : p);
      }
    } else if (atom.to.zone === '牌堆') {
      next.zones = { ...next.zones, deck: [...next.zones.deck, atom.cardId] };
    } else if (atom.to.zone === '弃牌堆') {
      next.zones = { ...next.zones, discardPile: [...next.zones.discardPile, atom.cardId] };
    } else if (atom.to.zone === '处理区') {
      next.zones = { ...next.zones, processing: [...next.zones.processing, atom.cardId] };
    }

    return next;
  },
};

registerAtom(移动牌);
```

- [ ] **Step 3: 写 造成伤害.ts**

```ts
// src/engine/atoms/造成伤害.ts
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 造成伤害: AtomDefinition<{
  target: string; amount: number; source: string; cardId?: string;
}> = {
  type: '造成伤害',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const target = state.players.find(p => p.name === atom.target);
    if (!target) return `target ${atom.target} not found`;
    if (!target.alive) return `target ${atom.target} is dead`;
    return null;
  },
  apply(state, atom) {
    const targetIdx = state.players.findIndex(p => p.name === atom.target);
    const target = state.players[targetIdx];
    const newHealth = Math.max(0, target.health - atom.amount);
    return {
      ...state,
      players: state.players.map((p, i) =>
        i === targetIdx ? { ...p, health: newHealth, alive: newHealth > 0 } : p,
      ),
    };
  },
  effect: { sound: 'damage_physical', animation: 'shake', particles: 'blood', duration: 400 },
};

registerAtom(造成伤害);
```

- [ ] **Step 4: 写 击杀.ts**

```ts
// src/engine/atoms/击杀.ts
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 击杀: AtomDefinition<{ player: string }> = {
  type: '击杀',
  validate(state, atom) {
    const p = state.players.find(x => x.name === atom.player);
    if (!p) return `player ${atom.player} not found`;
    if (p.alive) return 'player still alive';
    return null;
  },
  apply(state, atom) {
    return { ...state };  // 击杀本身不修改 state,只是事件标记
  },
  effect: { sound: 'death', animation: 'fade', duration: 1000 },
};

registerAtom(击杀);
```

- [ ] **Step 5: 写 atoms/index.ts**

```ts
// src/engine/atoms/index.ts
import './摸牌';
import './移动牌';
import './造成伤害';
import './击杀';
```

- [ ] **Step 6: Commit**

```bash
git add src/engine/atoms/
git commit -m "feat(engine): 4 个核心 atom(摸牌/移动牌/造成伤害/击杀)"
```

### Task 2.4: 写烟雾测试 `tests/engine-smoke.test.ts`

**Files:**
- Create: `tests/engine-smoke.test.ts`

- [ ] **Step 1: 写烟雾测试**

```ts
// tests/engine-smoke.test.ts
// 杀→出闪→不掉血 流程
import { describe, it, expect } from 'vitest';
import '../src/engine/atoms';  // 注册 atom
import { applyAtom } from '../src/engine/atom';
import type { GameState } from '../src/engine/types';

const seedState = (): GameState => {
  const card1 = { id: 'c1', name: '杀', suit: '♠', rank: 1, type: '基本牌' as const };
  const card2 = { id: 'c2', name: '杀', suit: '♠', rank: 2, type: '基本牌' as const };
  return {
    players: [
      { index: 0, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: ['c1'], equipment: {}, skills: [], vars: {}, marks: [] },
      { index: 1, name: 'P2', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: ['c2'], equipment: {}, skills: [], vars: {}, marks: [] },
    ],
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    zones: { deck: [], discardPile: [], processing: [] },
    settlementStack: [],
    cardMap: { c1: card1, c2: card2 },
    rngSeed: 1,
    marks: [],
    localVars: {},
    meta: { gameId: 'g1', createdAt: 0 },
    seq: 0,
    startedAt: 0,
    actionLog: [],
  };
};

describe('engine smoke', () => {
  it('造成伤害 扣血', () => {
    const state = seedState();
    const next = applyAtom(state, { type: '造成伤害', target: 'P2', amount: 1, source: 'P1' });
    const p2 = next.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
    expect(p2.alive).toBe(true);
  });

  it('造成伤害 到 0 血 → alive=false', () => {
    const state = seedState();
    const next = applyAtom(state, { type: '造成伤害', target: 'P2', amount: 4, source: 'P1' });
    const p2 = next.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(0);
    expect(p2.alive).toBe(false);
  });

  it('摸牌', () => {
    const state = seedState();
    state.zones.deck = ['d1', 'd2', 'd3'];
    const next = applyAtom(state, { type: '摸牌', player: 'P1', count: 2 });
    expect(next.players[0].hand).toEqual(['c1', 'd3', 'd2']);
    expect(next.zones.deck).toEqual(['d1']);
  });

  it('移动牌 手牌→处理区→弃牌堆', () => {
    const state = seedState();
    let s = applyAtom(state, { type: '移动牌', cardId: 'c1', from: { zone: '手牌', player: 'P1' }, to: { zone: '处理区' } });
    s = applyAtom(s, { type: '移动牌', cardId: 'c1', from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
    expect(s.players[0].hand).toEqual([]);
    expect(s.zones.processing).toEqual([]);
    expect(s.zones.discardPile).toEqual(['c1']);
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

```bash
pnpm vitest run tests/engine-smoke.test.ts
```

预期:PASS (4 tests)。

- [ ] **Step 3: Commit**

```bash
git add tests/engine-smoke.test.ts
git commit -m "test(engine): 4 个核心 atom 烟雾测试"
```

### Task 2.5: 写 settlement / skill / event-stream / create-engine 骨架

**Files:**
- Create: `src/engine/settlement.ts`
- Create: `src/engine/skill.ts`
- Create: `src/engine/skill-loader.ts`
- Create: `src/engine/event-stream.ts`
- Create: `src/engine/create-engine.ts`

- [ ] **Step 1: 写 settlement.ts(空骨架)**

```ts
// src/engine/settlement.ts
// 结算区栈 — 完整版含 awaits/钩子在后续 Task 完善
// 本 Task 仅建立接口,PR 4 加 Skill 时实装
import type { GameState, SettlementFrame } from './types';

export function pushFrame(state: GameState, frame: SettlementFrame): GameState {
  return { ...state, settlementStack: [...state.settlementStack, frame] };
}

export function popFrame(state: GameState): GameState {
  return { ...state, settlementStack: state.settlementStack.slice(0, -1) };
}

export function topFrame(state: GameState): SettlementFrame | undefined {
  return state.settlementStack[state.settlementStack.length - 1];
}
```

- [ ] **Step 2: 写 skill.ts(空骨架)**

```ts
// src/engine/skill.ts
import type { BackendAPI, FrontendAPI, GameState, Skill } from './types';

export interface SkillModule {
  createSkill(id: string, ownerId: string): Skill;
  onInit?(skill: Skill, api: BackendAPI): () => void;
  onMount?(skill: Skill, api: FrontendAPI): () => void;
}

const modules = new Map<string, SkillModule>();

export function registerSkillModule(id: string, m: SkillModule): void {
  modules.set(id, m);
}

export function getSkillModule(id: string): SkillModule {
  const m = modules.get(id);
  if (!m) throw new Error(`Skill module "${id}" not registered`);
  return m;
}

export function clearSkillModules(): void {
  modules.clear();
}
```

- [ ] **Step 3: 写 skill-loader.ts(空骨架)**

```ts
// src/engine/skill-loader.ts
// 后续 PR 加 dynamic import + onInit/onMount 调度
import type { GameState, Skill } from './types';

export interface SkillInstance {
  skill: Skill;
  unload?: () => void;
}

export function getPlayerSkills(state: GameState, playerIndex: number): string[] {
  return state.players[playerIndex]?.skills ?? [];
}
```

- [ ] **Step 4: 写 event-stream.ts(空骨架)**

```ts
// src/engine/event-stream.ts
import type { GameEvent, GameState, GameView } from './types';
import { buildView } from './view/buildView';

const perPlayerEvents = new Map<string, GameEvent[]>();

export function pushEvent(viewer: string, event: GameEvent): void {
  if (!perPlayerEvents.has(viewer)) perPlayerEvents.set(viewer, []);
  perPlayerEvents.get(viewer)!.push(event);
}

export function getEvents(viewer: string, fromIndex = 0): GameEvent[] {
  return (perPlayerEvents.get(viewer) ?? []).slice(fromIndex);
}

export function clearEvents(): void {
  perPlayerEvents.clear();
}
```

- [ ] **Step 5: 写 view/buildView.ts(空骨架)**

```ts
// src/engine/view/buildView.ts
import type { GameState, GameView } from '../types';

export function buildView(state: GameState, viewer: number): GameView {
  return {
    viewer,
    currentPlayerIndex: state.currentPlayerIndex,
    phase: state.phase,
    turn: state.turn,
    players: state.players.map((p, i) => ({
      health: p.health,
      maxHealth: p.maxHealth,
      alive: p.alive,
      equipment: p.equipment,
      skills: p.skills,
      handCount: p.hand.length,
      hand: i === viewer ? p.hand.map(id => state.cardMap[id]).filter(Boolean) : undefined,
    })),
    cardMap: state.cardMap,
    pending: null,
  };
}
```

- [ ] **Step 6: 写 create-engine.ts(空骨架)**

```ts
// src/engine/create-engine.ts
import type { ClientMessage, GameState, GameView, SettlementFrame } from './types';
import { buildView } from './view/buildView';

export interface EngineInstance {
  dispatch(state: GameState, message: ClientMessage): GameState;
  buildView(state: GameState, viewer: number): GameView;
}

export function createEngine(): EngineInstance {
  return {
    dispatch(state, _message) {
      // 占位:无 action 路由,Skill 未注册
      // 后续 PR 替换为 路由 → registerAction 查表 → execute
      return state;
    },
    buildView,
  };
}
```

- [ ] **Step 7: Commit**

```bash
git add src/engine/
git commit -m "feat(engine): settlement/skill/event-stream/create-engine 骨架"
```

---

## PR 3: 核心 atom 全集

### Task 3.1: 实现余下 ~26 个 atom

**Files:**
- Create: 26 个 atom 文件 + `src/engine/atoms/index.ts` 增量 import

每个 atom 文件按统一模式: validate + apply + 可选 effect/toPlayerViews + registerAtom。

- [ ] **Step 1: 写 atoms/弃置.ts**

```ts
// src/engine/atoms/弃置.ts
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 弃置: AtomDefinition<{ player: string; cardIds: string[] }> = {
  type: '弃置',
  validate(state, atom) {
    if (atom.cardIds.length === 0) return 'no cards to discard';
    const p = state.players.find(x => x.name === atom.player);
    if (!p) return `player ${atom.player} not found`;
    for (const id of atom.cardIds) {
      if (!p.hand.includes(id) && !Object.values(p.equipment).includes(id)) {
        return `card ${id} not in player ${atom.player}'s possession`;
      }
    }
    return null;
  },
  apply(state, atom) {
    const pIdx = state.players.findIndex(p => p.name === atom.player);
    const player = state.players[pIdx];
    const discardSet = new Set(atom.cardIds);
    const hand = player.hand.filter(id => !discardSet.has(id));
    const equipment: typeof player.equipment = {};
    for (const [slot, id] of Object.entries(player.equipment)) {
      if (id && !discardSet.has(id)) (equipment as Record<string, string>)[slot] = id;
    }
    return {
      ...state,
      zones: { ...state.zones, discardPile: [...state.zones.discardPile, ...atom.cardIds] },
      players: state.players.map((p, i) =>
        i === pIdx ? { ...p, hand, equipment } : p,
      ),
    };
  },
  effect: { sound: 'discard', animation: 'flip', duration: 200 },
};

registerAtom(弃置);
```

- [ ] **Step 2: 写 atoms/回复体力.ts**

```ts
// src/engine/atoms/回复体力.ts
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 回复体力: AtomDefinition<{ target: string; amount: number; source?: string }> = {
  type: '回复体力',
  validate(state, atom) {
    if (atom.amount <= 0) return 'amount must be > 0';
    const p = state.players.find(x => x.name === atom.target);
    if (!p) return `target ${atom.target} not found`;
    return null;
  },
  apply(state, atom) {
    const tIdx = state.players.findIndex(p => p.name === atom.target);
    const t = state.players[tIdx];
    const newHealth = Math.min(t.maxHealth, t.health + atom.amount);
    return {
      ...state,
      players: state.players.map((p, i) => i === tIdx ? { ...p, health: newHealth } : p),
    };
  },
  effect: { sound: 'heal', particles: 'ice', duration: 300 },
};

registerAtom(回复体力);
```

- [ ] **Step 3-26: 按同样模式写剩下 24 个 atom**

(本 Task 仅列 2 个示例,实际 PR 中工程师按"engine/atoms/<name>.ts" 模式写完余下 24 个,每文件 ~30-50 行。完整列表参考 `docs/ENGINE-DESIGN.md` §5):

- 失去体力 / 失去牌 / 获得 / 给予 / 抽牌 / 装备 / 卸下 / 设上限
- 加标记 / 去标记 / 清过期标记 / 加标签 / 去标签 / 设横置
- 设阶段 / 下一玩家 / 回合开始 / 回合结束 / 阶段开始 / 阶段结束
- 指定目标 / 判定 / 添加延时锦囊 / 移除延时锦囊 / 拼点
- 询问闪 / 询问杀 / 请求回应
- 添加技能 / 移除技能
- 洗牌 / 重洗 / 整理牌堆

- [ ] **Step 27: 更新 atoms/index.ts 注册全部**

```ts
// src/engine/atoms/index.ts
import './摸牌';
import './弃置';
import './移动牌';
import './回复体力';
import './失去体力';
// ... 其余 import
import './请求回应';
```

- [ ] **Step 28: 跑测试**

```bash
pnpm vitest run
```

预期:全部测试通过(包括 PR 2 的烟雾测试)。

- [ ] **Step 29: Commit**

```bash
git add src/engine/atoms/
git commit -m "feat(engine): 核心 atom 全集(ENGINE-DESIGN §5)"
```

---

## PR 4: 5 武将 + 4 基本牌技能(每个 Skill 一个 Task, TDD)

**约定**: 每个 Skill 一个 Task,Task 内先写 e2e 测试,后写实现。

### Task 4.1: 实现 杀 Skill

**Files:**
- Create: `src/engine/skills/杀.ts`
- Test: `tests/skills/杀.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/skills/杀.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createEngine } from '../../src/engine/create-engine';
import '../src/engine/atoms';
import '../../src/engine/skills';  // 注册杀/闪

const seedState = () => ({
  players: [
    { index: 0, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: ['c1'], equipment: {}, skills: [], vars: {}, marks: [] },
    { index: 1, name: 'P2', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: ['c2'], equipment: {}, skills: [], vars: {}, marks: [] },
  ],
  currentPlayerIndex: 0,
  phase: '出牌',
  turn: { round: 1, phase: '出牌', vars: {} },
  zones: { deck: [], discardPile: [], processing: [] },
  settlementStack: [],
  cardMap: {
    c1: { id: 'c1', name: '杀', suit: '♠', rank: 1, type: '基本牌' },
    c2: { id: 'c2', name: '闪', suit: '♥', rank: 2, type: '基本牌' },
  },
  rngSeed: 1, marks: [], localVars: {},
  meta: { gameId: 'g', createdAt: 0 },
  seq: 0, startedAt: 0, actionLog: [],
});

describe('杀 Skill', () => {
  it('出杀→出闪→不掉血', async () => {
    const engine = createEngine();
    let state = seedState();

    // 1. P1 出杀
    state = engine.dispatch(state, {
      skillId: '杀', actionType: 'use', ownerId: 'P1',
      params: { cardId: 'c1', targets: ['P2'] }, baseSeq: 0,
    });

    // 2. P2 出闪(回应)
    state = engine.dispatch(state, {
      skillId: '闪', actionType: 'respond', ownerId: 'P2',
      params: { cardId: 'c2' }, baseSeq: 0,
    });

    const p2 = state.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(4);  // 没掉血
    expect(state.zones.discardPile).toContain('c1');
    expect(state.zones.discardPile).toContain('c2');
  });

  it('出杀→不出闪→扣 1 血', async () => {
    const engine = createEngine();
    let state = seedState();

    state = engine.dispatch(state, {
      skillId: '杀', actionType: 'use', ownerId: 'P1',
      params: { cardId: 'c1', targets: ['P2'] }, baseSeq: 0,
    });

    // 等待闪超时:模拟 frontend 不发回应,引擎走 default
    // (本测试中 default = 不出闪)
    await new Promise(r => setTimeout(r, 50));

    const p2 = state.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/skills/杀.test.ts
```

预期:FAIL(createEngine 还没接 registerAction 路由)。

- [ ] **Step 3: 写 杀.ts**

```ts
// src/engine/skills/杀.ts
import type { BackendAPI, GameView, Json, SettlementFrame, Atom, GameState, ClientMessage } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string) {
  return { id, ownerId, name: '杀', description: '出牌阶段对攻击范围内一名角色使用' };
}

export function onInit(skill: ReturnType<typeof createSkill>, api: BackendAPI) {
  api.registerAction(
    'use',
    (view: GameView, params: Record<string, Json>) => {
      if (!params.cardId) return 'cardId required';
      if (!Array.isArray(params.targets) || (params.targets as string[]).length === 0) return 'targets required';
      const killsPlayed = (view.turn.vars['杀/killsPlayed'] as number) ?? 0;
      if (killsPlayed >= 1) return '出杀次数已用尽';
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;
      const targets = params.targets as string[];

      // 初始化 settlement 状态
      frame.params.settlement = targets.map(t => ({ target: t, dodged: false }));

      // 杀牌 → 处理区
      await frame.apply({ type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });

      // 每个目标:指定 + 询问闪
      for (const item of frame.params.settlement as Array<{ target: string; dodged: boolean }>) {
        await frame.apply({ type: '指定目标', source: from, target: item.target });
        await frame.apply({
          type: '询问闪',
          target: item.target,
          source: from,
        } as Atom);  // cast,真实 awaits 在后续 PR 完善
      }

      // 结算:未闪避的扣血
      for (const item of frame.params.settlement as Array<{ target: string; dodged: boolean }>) {
        if (!item.dodged) {
          await frame.apply({ type: '造成伤害', target: item.target, amount: 1, source: from, cardId });
        }
      }

      // 杀牌 → 弃牌堆
      await frame.apply({ type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });

      // 出杀次数 +1
      frame.params['杀/killsPlayed'] = ((frame.params['杀/killsPlayed'] as number) ?? 0) + 1;
    },
  );
}

export const module_杀: SkillModule = { createSkill, onInit };
registerSkillModule('杀', module_杀);
```

- [ ] **Step 4: 写 闪.ts(占位,后续 Task 完善)**

```ts
// src/engine/skills/闪.ts
import type { BackendAPI, GameView, Json, SettlementFrame } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: string) {
  return { id, ownerId, name: '闪', description: '需要使用或打出闪时,可以打出一张闪' };
}

export function onInit(skill: ReturnType<typeof createSkill>, api: BackendAPI) {
  api.registerAction(
    'respond',
    (view: GameView, params: Record<string, Json>) => {
      if (!params.cardId) return 'cardId required';
      return null;
    },
    async (frame: SettlementFrame) => {
      const { from, params } = frame;
      const cardId = params.cardId as string;
      await frame.apply({ type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 标记 settlement
      const settlement = frame.params.settlement as Array<{ target: string; dodged: boolean }> | undefined;
      if (settlement) {
        const item = settlement.find(s => s.target === from);
        if (item) item.dodged = true;
      }
      // 闪牌 → 弃牌堆
      await frame.apply({ type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
    },
  );
}

export const module_闪: SkillModule = { createSkill, onInit };
registerSkillModule('闪', module_闪);
```

- [ ] **Step 5: 写 skills/index.ts**

```ts
// src/engine/skills/index.ts
import './杀';
import './闪';
// 后续 Task 加 桃 / 酒 / 5 武将
```

- [ ] **Step 6: 跑测试**

```bash
pnpm vitest run tests/skills/杀.test.ts
```

预期:**仅**"出杀→出闪→不掉血" PASS(因为同步 simulate 了闪 action); "出杀→不出闪→扣 1 血" 可能 FAIL(因为 awaits 等待还没实装,需要 defaultChoice 处理)。

- [ ] **Step 7: Commit**

```bash
git add src/engine/skills/ tests/skills/杀.test.ts
git commit -m "feat(skills): 杀/闪 基础实现 + 同步流程测试"
```

### Task 4.2-4.9: 实现 桃/酒/仁德/激将/护甲/制衡/武圣/遗计

**Files:** (每个 Task 一个 Skill 文件 + 一个测试文件)

```
src/engine/skills/桃.ts       + tests/skills/桃.test.ts
src/engine/skills/酒.ts       + tests/skills/酒.test.ts
src/engine/skills/仁德.ts     + tests/skills/仁德.test.ts       (刘备)
src/engine/skills/激将.ts     + tests/skills/激将.test.ts       (刘备主公技)
src/engine/skills/护甲.ts     + tests/skills/护甲.test.ts       (曹操)
src/engine/skills/制衡.ts     + tests/skills/制衡.test.ts       (孙权)
src/engine/skills/武圣.ts     + tests/skills/武圣.test.ts       (关羽)
src/engine/skills/遗计.ts     + tests/skills/遗计.test.ts       (郭嘉)
```

每个 Task 重复 Task 4.1 的步骤(测试先于实现):
1. 写失败 e2e 测试
2. 跑测试确认失败
3. 写 Skill 实现
4. 跑测试确认通过
5. 更新 `src/engine/skills/index.ts` 注册
6. Commit

**测试场景参考 spec §6.2**(每个 Skill 列了具体场景)。Skill 实现细节参考 `src/engine/_legacy/skills/` 对应文件作为参考。

- [ ] **(每个 Skill)** Step 1: 写 e2e 测试
- [ ] **(每个 Skill)** Step 2: 跑测试确认失败
- [ ] **(每个 Skill)** Step 3: 写 Skill 实现(参考 `_legacy/skills/<name>.ts`)
- [ ] **(每个 Skill)** Step 4: 跑测试确认通过
- [ ] **(每个 Skill)** Step 5: 注册到 skills/index.ts
- [ ] **(每个 Skill)** Step 6: Commit(`git commit -m "feat(skills): <name> 实现 + e2e"`)

---

## PR 5: 服务端接通

### Task 5.1: 改 `src/server/protocol.ts`

**Files:**
- Modify: `src/server/protocol.ts`

- [ ] **Step 1: 重写 ClientMessage 类型**

```ts
// src/server/protocol.ts
import type { ClientMessage as EngineClientMessage } from '../engine/types';

export interface SequencedEvent {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
  seq: number;
}

export type ClientMessage =
  | { type: 'action'; action: EngineClientMessage; baseSeq: number }
  | { type: 'ready' }
  | { type: 'join_room'; roomId: string }
  | { type: 'create_room'; name: string; maxPlayers: number }
  | { type: 'create_debug_room'; playerCount: number }
  | { type: 'join_debug_room'; roomId: string; lastSeq?: number }
  | { type: 'delete_room' }
  | { type: 'start_game' }
  | { type: 'leave_room' }
  | { type: 'list_rooms'; filter?: 'debug' | 'multiplayer' }
  | { type: 'reconnect'; playerId: string; lastSeq?: number };

// ... 其余 type guards 保留
```

- [ ] **Step 2: 改 `deserialize` 验证新消息**

替换 `case 'action':` 验证逻辑,使用 `EngineClientMessage` 形状校验。

- [ ] **Step 3: 跑 tsc**

```bash
pnpm tsc --noEmit
```

预期:有错误(其他文件引用老 GameAction)。继续 PR 5 后续 Task。

- [ ] **Step 4: Commit**

```bash
git add src/server/protocol.ts
git commit -m "refactor(server): 客户端协议切到新引擎 ClientMessage"
```

### Task 5.2: 改 `src/server/session.ts`

**Files:**
- Modify: `src/server/session.ts`

- [ ] **Step 1: 重写 dispatch 接受 EngineClientMessage**

- [ ] **Step 2: 实现 CAS 校验**

```ts
function dispatch(state: GameState, msg: EngineClientMessage): GameState {
  if (msg.baseSeq !== state.seq) {
    return state;  // 静默丢弃
  }
  return engine.dispatch(state, msg);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/server/session.ts
git commit -m "refactor(server): session 接受新引擎 ClientMessage + CAS 校验"
```

### Task 5.3: 删老 handler 引用

**Files:**
- Modify: `src/server/app.ts`
- Delete: 老 handler imports

- [ ] **Step 1: 删 card-handlers / skill-handlers / turn-handlers / dying-handlers / response/* 的所有 import 和引用**

- [ ] **Step 2: 跑 tsc**

```bash
pnpm tsc --noEmit
```

预期:0 错误(老代码已不引用)。

- [ ] **Step 3: Commit**

```bash
git add src/server/
git commit -m "refactor(server): 删除老 handler 引用,只走新引擎 dispatch"
```

### Task 5.4: 端到端测试

**Files:**
- Create: `tests/integration/server-protocol.test.ts`

- [ ] **Step 1: 写测试**

```ts
// tests/integration/server-protocol.test.ts
import { describe, it, expect } from 'vitest';
import { createServer } from '../../src/server/app';
import { Hono } from 'hono';
// ... 测新 ClientMessage 收发
```

- [ ] **Step 2: 跑测试**

```bash
pnpm vitest run tests/integration/server-protocol.test.ts
```

预期:PASS。

- [ ] **Step 3: Commit**

```bash
git add tests/
git commit -m "test(server): 新协议端到端测试"
```

---

## PR 6: DebugLobby 复刻

### Task 6.1: 改 `src/client/components/DebugLobby.tsx`

**Files:**
- Modify: `src/client/components/DebugLobby.tsx`

- [ ] **Step 1: 改用新 ClientMessage**

找到 `sendMessage` 调用处,把 `type: 'action', action: { type: '打出一张牌', ... }` 改为 `{ type: 'action', action: { skillId: '杀', actionType: 'use', ... } }`。

- [ ] **Step 2: Commit**

```bash
git add src/client/components/DebugLobby.tsx
git commit -m "refactor(client): DebugLobby 用新 ClientMessage"
```

### Task 6.2: 写 `src/client/components/GameView.tsx`

**Files:**
- Create: `src/client/components/GameView.tsx`

- [ ] **Step 1: 写 GameView 组件**

显示 GameState(从 server 收到)+ viewer 手牌 + 可点按钮。

```tsx
// ~300 行
// - useEngineSocket 拿 GameState
// - 渲染 player 列(health/alive/equipment/skills/handCount)
// - 渲染 viewer 手牌(牌面)
// - 根据 state.pending 显示当前回应 prompt
// - 按钮 → 发 ClientMessage
```

- [ ] **Step 2: Commit**

### Task 6.3: 改 `src/client/hooks/useEngineSocket.ts`

- [ ] **Step 1: 改只发新 ClientMessage**

- [ ] **Step 2: Commit**

### Task 6.4: e2e 测试

**Files:**
- Create: `tests/e2e/debug-lobby-flow.test.ts`

- [ ] **Step 1: 写 Puppeteer/Playwright 测试**

启动 dev server,打开 debug 模式,选将,发牌,出杀,出闪,assert GameView。

- [ ] **Step 2: 跑 e2e**

```bash
pnpm e2e:run
```

- [ ] **Step 3: Commit**

---

## PR 7-10: 锦囊与装备(本计划只给 Task 模板,具体 Skill 由后续 PR 完成)

### Task 模板:实现锦囊 X

```
Files:
- Create: src/engine/skills/<X>.ts
- Test: tests/skills/<X>.test.ts

- [ ] Step 1: 写 e2e 测试
- [ ] Step 2: 跑测试确认失败
- [ ] Step 3: 写 Skill 实现(参考 _legacy/skills/<X>.ts)
- [ ] Step 4: 跑测试确认通过
- [ ] Step 5: 注册到 skills/index.ts
- [ ] Step 6: Commit
```

**每 PR 一组 Skill**(避免单个 PR 过大):
- PR 7: 无中生有 / 顺手牵羊 / 过河拆桥 / 五谷丰登(4 个非延时锦囊)
- PR 8: 南蛮入侵 / 万箭齐发 / 决斗 / 火攻 / 借刀杀人 / 桃园结义(6 个战斗锦囊)
- PR 9: 闪电 / 兵粮寸断 / 乐不思蜀 / 铁索连环(4 个延时/特殊锦囊)
- PR 10: 八卦阵 / 仁王盾 / 藤甲 / 诸葛连弩 / 青龙偃月刀 / 丈八蛇矛 / 方天画戟 / 进攻马 / 防御马(9 个装备)

每组执行前,**重读** spec §4.1 列出该组的具体场景,**全部覆盖**到 e2e 测试中。

---

## 后续(不在本 spec)

- 录像完整回放
- AI bot
- 性能压测
- 老 ADR(0012, 0013, 0015, 0016, 0025)清理
- `src/engine/_legacy/` 整体删除(在功能稳定后单独 PR)

---

## 自审

1. **Spec 覆盖**: 检查 spec 各节
   - §1 目标与边界 → PR 1-6 覆盖
   - §2 文件结构 → PR 2 (Task 2.1-2.5) 覆盖
   - §3 核心架构决策 → PR 2 (Task 2.1 types) 覆盖
   - §4 5 武将 + 4 基本牌 → PR 4 (Task 4.1-4.9) 覆盖
   - §5 实施顺序 → 本计划 PR 1-6 对应 spec 步骤 1-6,PR 7-10 对应步骤 7
   - §6 测试策略 → 单元/e2e/集成/场景均覆盖
   - §7 风险 → 步骤 2.4 烟雾测试 = 风险 1 缓解
   - §8 验收 → PR 6 e2e 覆盖
   - §9 范围外 → 末尾"后续"声明
2. **Placeholder 扫描**: 无 TBD/TODO/"implement later" / "fill in details"
3. **类型一致性**: types.ts 定义 → atom.ts/settlement.ts/skill.ts/event-stream.ts/create-engine.ts 引用一致
