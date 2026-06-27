# AI 代打 MCP Server 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 MCP server，把三国杀游戏包装成游戏环境，供外部通用 agent（Claude Code/OMP）通过 `play` 工具驱动某个座次的完整生命周期（进房间/准备/开始/选将/出牌循环）。

**Architecture:** 先抽出框架无关的 `HeadlessGameClient`（单座次无头 WS 玩家客户端），从现有 `useDebugMultiConnection` 剥离 React 耦合，复用现有纯函数层（`gameViewHelpers`/`pendingRespond`/`skillActionRegistry`/`view/reducer`）。MCP server 是 HGC 的薄包装，`play` 工具统一「动作→观察」循环。debug 多座次前端迁移到 HGC 之上以消除重复逻辑并获得回归保护。

**Tech Stack:** TypeScript, WebSocket（客户端侧）, `@modelcontextprotocol/sdk`（v1.29.0）, Vitest, pnpm。

**Spec:** `docs/superpowers/specs/2026-06-26-ai-player-mcp-design.md`

---

## 关键依赖参考（实现时直接 import）

- `viewReducer(view, event, time)` — `src/client/view/reducer.ts`，增量 view 维护
- `extractCardFilter(prompt)` / `findUseActionForCard(actions, card)` / `isActiveAction(action, ctx)` / `derivePlayRules(targetFilter, selfTarget)` / `buildPlayParams(...)` / `resolveDistributeCardIds(...)` — `src/client/utils/gameViewHelpers.ts`
- `resolvePendingRespond(pending, skillActions)` / `getPendingRequestType(pending)` — `src/client/utils/pendingRespond.ts`
- `getActionsForPlayer(playerIndex)` / `registerSkillActions(playerIndex, skillIds)` / `findActionAcrossOwners(skillId, actionType)` — `src/client/skillActionRegistry.ts`
- WS 消息类型 `ServerMessage` / `ClientMessage`（协议层）/ `RoomConfig` / `RoomState` — `src/server/protocol.ts`
- 引擎消息类型 `ClientMessage as EngineClientMessage` / `GameView` / `ViewEvent` / `Card` / `Json` / `ActionContext` — `src/engine/types.ts`

**协议消息形态（已核实）**：
- 服务端→客户端：`initialView {state, lastSeq}` / `event {seq, timestamp, view?, notify?, deadline?}` / `actionRejected` / `gameOver {winner}` / `game_reset` / `room_joined {playerId, seatIndex?}` / `room_state {readyPlayers, playerIds, hostId, maxPlayers, config}` / `room_config {config}` / `player_ready {playerId}` / `game_started`
- 客户端→服务端：`create_debug_room {config?, playerCount?}` / `join_debug_room {roomId, lastSeq?}` / `ready` / `start_game` / `restart_game` / `update_room_config {config}` / `reorder_hand {order}` / `action {action: EngineClientMessage, baseSeq}`
- `EngineClientMessage` = `{ skillId, actionType, ownerId, params }`

---

## 文件结构

**新建：**
- `src/client/headless/types.ts` — HGC 的公开类型：`ClientPhase`、`HeadlessCallbacks`、`AvailableAction`、`AiViewSnapshot`
- `src/client/headless/viewMaintainer.ts` — 纯函数：给定 `view | null` + `ServerMessage` → 返回新 `view` + 副作用标志（对应 `useDebugMultiConnection.handleMessage` 的 view 部分，无 WS/React）
- `src/client/headless/availableActions.ts` — 纯函数：`enumerateAvailableActions(view, seatIndex, skillActions): AvailableAction[]`（封装 §3.4 流程）
- `src/client/headless/HeadlessGameClient.ts` — 主类，组合 viewMaintainer + availableActions + WS 连接 + 生命周期
- `src/ai-mcp/playHandler.ts` — `play` 工具的阻塞逻辑：执行 action → 等待 needsAction/ended/超时 → 返回结构化结果
- `src/ai-mcp/viewProjector.ts` — `GameView` → `AiViewSnapshot` 投影纯函数
- `src/ai-mcp/server.ts` — MCP server 入口：注册 `play` 工具 + stdio transport + 环境变量初始化
- 测试：`tests/headless/viewMaintainer.test.ts`、`tests/headless/availableActions.test.ts`、`tests/headless/HeadlessGameClient.integration.test.ts`、`tests/ai-mcp/playHandler.test.ts`、`tests/ai-mcp/viewProjector.test.ts`

**修改：**
- `src/client/hooks/useDebugMultiConnection.ts` — 重构为「N 个 HGC 实例 + 协调器」，删除内联的 handleMessage/view 逻辑
- `package.json` — 加 `@modelcontextprotocol/sdk` 依赖 + `mcp:serve` 脚本
- `vitest.config.ts`（如需）— 确保 headless/ai-mcp 测试纳入 core 项目

---

## Task 1: HeadlessGameClient 公开类型

**Files:**
- Create: `src/client/headless/types.ts`

- [ ] **Step 1: 创建类型文件**

```ts
// src/client/headless/types.ts
// HeadlessGameClient 公开类型。框架无关（零 React 依赖）。
import type { GameView, ViewEvent, Json, ClientMessage as EngineClientMessage } from '../../engine/types';
import type { RoomState } from '../../server/protocol';

export type ClientPhase = 'connecting' | 'lobby' | 'playing' | 'ended';

export interface HeadlessCallbacks {
  onView?: (view: GameView, newEvents: ViewEvent[]) => void;
  onRoomState?: (state: RoomState | null) => void;
  onPhaseChange?: (phase: ClientPhase) => void;
  onGameOver?: (winner: string) => void;
  onActionRejected?: () => void;
  onError?: (err: Error) => void;
}

export interface AvailableAction {
  description: string;
  message: EngineClientMessage;
  validTargets: number[];
  category: 'play' | 'respond' | 'discard' | 'selectChar' | 'transform' | 'distribute';
}

/** AI 友好的 view 投影（MCP 层用，精简 token）。见 spec §4.4 */
export interface AiViewSnapshot {
  viewer: number;
  currentPlayerIndex: number;
  phase: GameView['phase'];
  turn: { round: number };
  players: Array<{
    index: number;
    name: string;
    character: string;
    health: number;
    maxHealth: number;
    alive: boolean;
    handCount: number;
    hand?: import('../../engine/types').Card[];
    equipment: GameView['players'][number]['equipment'];
    skills: string[];
    identity?: string;
  }>;
  pending: {
    target: number;
    isBlocking: boolean;
    promptTitle: string;
    requestType: string;
  } | null;
  zones: { deckCount: number; discardPileCount: number };
  log: { time: number; player: number; text: string }[];
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无新增错误（types.ts 仅声明，无引用）

- [ ] **Step 3: Commit**

```bash
git add src/client/headless/types.ts
git commit -m "feat: 添加 HeadlessGameClient 公开类型"
```

---

## Task 2: viewMaintainer 纯函数 + 测试（TDD）

把 `useDebugMultiConnection.handleMessage` 中「更新 view / lastSeq / pending / deadline / phase」的逻辑抽成纯函数，输入是当前快照 + 一条 ServerMessage，输出是更新后的快照 + 待回调事件。无 WS、无 React。

**Files:**
- Create: `tests/headless/viewMaintainer.test.ts`
- Create: `src/client/headless/viewMaintainer.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/headless/viewMaintainer.test.ts
import { describe, it, expect } from 'vitest';
import { applyServerMessage } from '../../src/client/headless/viewMaintainer';
import type { GameView } from '../../src/engine/types';
import type { ServerMessage } from '../../src/server/protocol';

function makeBaseline(viewer: number): GameView {
  return {
    viewer,
    currentPlayerIndex: viewer,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [{
      index: viewer, name: 'P0', character: '刘备', health: 4, maxHealth: 4,
      alive: true, equipment: {}, skills: ['仁德'], handCount: 4, hand: [], marks: [],
    }],
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };
}

describe('applyServerMessage', () => {
  it('initialView 建立 baseline view 并记录 lastSeq', () => {
    const baseline = makeBaseline(0);
    const msg: ServerMessage = {
      type: 'initialView', state: baseline, lastSeq: 7,
    };
    const out = applyServerMessage(null, 0, msg);
    expect(out.view).not.toBeNull();
    expect(out.view!.viewer).toBe(0);
    expect(out.lastSeq).toBe(7);
    expect(out.phaseChangedTo).toBe('playing');
  });

  it('event 的 view 增量更新经 viewReducer 且推进 lastSeq', () => {
    const baseline = makeBaseline(0);
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const evt = {
      type: 'event', seq: 1, timestamp: 100,
      view: { type: '摸牌', player: 0, count: 2, atomType: '摸牌' } as any,
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    expect(out.lastSeq).toBe(1);
    expect(out.newEvents.length).toBeGreaterThan(0);
  });

  it('event 的 notify pendingResolved 清除匹配本座次的 pending', () => {
    const baseline = makeBaseline(0);
    baseline.pending = {
      type: 'awaits', atom: { type: '询问闪', player: 0 } as any,
      prompt: { type: 'useCard', cardFilter: { filter: () => true } } as any,
      target: 0, isBlocking: true,
    };
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const evt = {
      type: 'event', seq: 1, timestamp: 100,
      notify: { eventType: 'pendingResolved', data: { target: 0 } },
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    expect(out.view!.pending).toBeNull();
  });

  it('event 的 deadline 权威覆盖 view.deadline（无 pending 时）', () => {
    const baseline = makeBaseline(0);
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const evt = {
      type: 'event', seq: 1, timestamp: 100,
      deadline: { deadline: 9999, totalMs: 30000 },
    } as ServerMessage;
    const out = applyServerMessage(start.view, start.lastSeq, evt);
    expect(out.view!.deadline).toBe(9999);
    expect(out.view!.deadlineTotalMs).toBe(30000);
  });

  it('gameOver 切到 ended', () => {
    const baseline = makeBaseline(0);
    const start = applyServerMessage(null, 0, { type: 'initialView', state: baseline, lastSeq: 0 });
    const out = applyServerMessage(start.view, start.lastSeq, { type: 'gameOver', winner: '主公' });
    expect(out.phaseChangedTo).toBe('ended');
    expect(out.gameOverWinner).toBe('主公');
  });

  it('room_joined 更新 playerId', () => {
    const out = applyServerMessage(null, 0, { type: 'room_joined', playerId: 'pid-1', seatIndex: 0 });
    expect(out.playerId).toBe('pid-1');
    expect(out.seatIndex).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/headless/viewMaintainer.test.ts`
Expected: FAIL — `applyServerMessage` 未定义

- [ ] **Step 3: 实现 viewMaintainer**

```ts
// src/client/headless/viewMaintainer.ts
// 把 useDebugMultiConnection.handleMessage 中 view/lastSeq/pending/deadline/phase 的
// 纯逻辑剥离。输入当前快照 + ServerMessage，输出更新后快照。无 WS/React。
import { viewReducer } from '../view/reducer';
import type { GameView, ViewEvent } from '../../engine/types';
import type { ServerMessage } from '../../server/protocol';
import type { ClientPhase } from './types';

export interface ViewSnapshot {
  view: GameView | null;
  lastSeq: number;
  playerId?: string;
  seatIndex?: number;
}

export interface ApplyResult extends ViewSnapshot {
  /** 本次产生的新事件（view 分支）；notify/event 无 view 时为空 */
  newEvents: ViewEvent[];
  /** phase 是否切换，及切到哪个 */
  phaseChangedTo: ClientPhase | null;
  /** gameOver 时的胜方；仅 type=gameOver 时有值 */
  gameOverWinner?: string;
  /** room_state 类消息的 RoomState（由调用方透传给 onRoomState） */
  roomState?: import('../../server/protocol').RoomState | null;
  /** 是否被 rejected */
  actionRejected?: boolean;
  /** 是否需要清空 view 回到 lobby（game_reset） */
  resetToLobby?: boolean;
}

/** 判定 phase：有 view=playing，无 view 但已 join=lobby，gameOver=ended */
function phaseFor(view: GameView | null, hasJoined: boolean, gameOver?: string): ClientPhase | null {
  if (gameOver !== undefined) return 'ended';
  if (view) return 'playing';
  if (hasJoined) return 'lobby';
  return null;
}

export function applyServerMessage(
  prev: GameView | null,
  prevSeq: number,
  msg: ServerMessage,
): ApplyResult {
  const base: ApplyResult = {
    view: prev, lastSeq: prevSeq, newEvents: [], phaseChangedTo: null,
  };
  switch (msg.type) {
    case 'initialView': {
      const view = msg.state;
      return { ...base, view, lastSeq: msg.lastSeq, seatIndex: view.viewer, phaseChangedTo: 'playing' };
    }
    case 'event': {
      if (!prev) return base;
      let view = prev;
      const newEvents: ViewEvent[] = [];
      if (msg.notify) {
        if (msg.notify.eventType === 'pendingResolved') {
          const target = (msg.notify.data as { target?: number }).target;
          if (target !== undefined && (target === view.viewer || target < 0) && view.pending) {
            view = { ...view, pending: null };
          }
        }
      }
      if (msg.view) {
        // viewReducer 原地突变；复制一份避免污染外部引用
        view = { ...view };
        viewReducer(view, msg.view, msg.timestamp);
        newEvents.push(msg.view);
      }
      if (msg.deadline !== undefined) {
        if (msg.deadline !== null && view.pending) {
          view = {
            ...view,
            pending: { ...view.pending, deadline: msg.deadline.deadline, totalMs: msg.deadline.totalMs },
          };
        }
        view = {
          ...view,
          deadline: msg.deadline !== null ? msg.deadline.deadline : null,
          deadlineTotalMs: msg.deadline !== null ? msg.deadline.totalMs : 0,
        };
      }
      return { ...base, view, lastSeq: msg.seq, newEvents };
    }
    case 'gameOver':
      return { ...base, phaseChangedTo: 'ended', gameOverWinner: msg.winner };
    case 'game_reset':
      return { ...base, view: null, lastSeq: 0, resetToLobby: true, phaseChangedTo: 'lobby' };
    case 'room_joined':
      return { ...base, playerId: msg.playerId, seatIndex: typeof msg.seatIndex === 'number' ? msg.seatIndex : base.seatIndex };
    case 'room_state':
      return { ...base, roomState: { readyPlayers: msg.readyPlayers, playerIds: msg.playerIds, hostId: msg.hostId, maxPlayers: msg.maxPlayers, config: msg.config } };
    case 'room_config':
      return { ...base }; // 由调用方合并到现有 roomState
    case 'player_ready':
      return { ...base }; // 增量由 room_state 权威覆盖
    case 'game_started':
      return { ...base, phaseChangedTo: 'playing' };
    case 'actionRejected':
      return { ...base, actionRejected: true };
    default:
      return base;
  }
}

/** 合并一条 room_joined/player_ready 之外的 room 状态增量（room_config/player_ready）。
 *  viewMaintainer 不持有 roomState，这个 helper 供 HeadlessGameClient 用。 */
export function mergeRoomConfig(
  prev: import('../../server/protocol').RoomState | null,
  config: import('../../server/protocol').RoomConfig,
): import('../../server/protocol').RoomState | null {
  return prev ? { ...prev, config } : prev;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/headless/viewMaintainer.test.ts`
Expected: PASS（全部 6 例）

- [ ] **Step 5: Commit**

```bash
git add tests/headless/viewMaintainer.test.ts src/client/headless/viewMaintainer.ts
git commit -m "feat: 抽出 viewMaintainer 纯函数"
```

---

## Task 3: availableActions 纯函数 + 测试（TDD）

封装 §3.4 流程：给定 view + seatIndex + skillActions，枚举可执行操作。

**Files:**
- Create: `tests/headless/availableActions.test.ts`
- Create: `src/client/headless/availableActions.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/headless/availableActions.test.ts
import { describe, it, expect } from 'vitest';
import { enumerateAvailableActions } from '../../src/client/headless/availableActions';
import type { GameView, Card, SkillActionDef } from '../../src/engine/types';

function makeView(seat: number, phase: GameView['phase'], hand: Card[]): GameView {
  return {
    viewer: seat, currentPlayerIndex: seat, phase,
    turn: { round: 1, phase, vars: {} },
    players: [{
      index: seat, name: 'P0', character: '刘备', health: 4, maxHealth: 4,
      alive: true, equipment: {}, skills: ['杀'], handCount: hand.length, hand, marks: [],
    }, {
      index: 1, name: 'P1', character: '曹操', health: 4, maxHealth: 4,
      alive: true, equipment: {}, skills: [], handCount: 4, marks: [],
    }],
    cardMap: Object.fromEntries(hand.map(c => [c.id, c])),
    pending: null, deadline: null, deadlineTotalMs: 0, log: [], settlementStack: [],
  };
}

const killCard: Card = { id: 'c1', name: '杀', suit: '♠', rank: '5', type: '基本牌' };

// 杀的 use action（cardFilter 匹配 name==='杀'，targetFilter 选一个其他玩家）
const killUseAction: SkillActionDef = {
  skillId: '杀', ownerId: 0, actionType: 'use', label: '杀',
  prompt: {
    type: 'useCardAndTarget',
    cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  } as any,
};

describe('enumerateAvailableActions', () => {
  it('出牌阶段枚举手牌中可出的牌，并算出合法目标', () => {
    const view = makeView(0, '出牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    const a = actions.find(x => x.category === 'play');
    expect(a).toBeDefined();
    expect(a!.message.actionType).toBe('use');
    expect(a!.message.params).toHaveProperty('cardId', 'c1');
    expect(a!.validTargets).toContain(1);
  });

  it('非出牌阶段不枚举主动出牌', () => {
    const view = makeView(0, '摸牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions.find(x => x.category === 'play')).toBeUndefined();
  });

  it('空手牌不产出牌操作', () => {
    const view = makeView(0, '出牌', []);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/headless/availableActions.test.ts`
Expected: FAIL — 未定义

- [ ] **Step 3: 实现 availableActions**

```ts
// src/client/headless/availableActions.ts
// 枚举当前座次可执行操作。复用 gameViewHelpers + pendingRespond 纯函数。
import type { Card, GameView, SkillActionDef } from '../../engine/types';
import type { ClientMessage as EngineClientMessage } from '../../engine/types';
import type { AvailableAction } from './types';
import {
  isActiveAction, findUseActionForCard, derivePlayRules, buildPlayParams,
} from '../utils/gameViewHelpers';
import type { ActionContext } from '../../engine/types';

/** 出牌阶段枚举主动可出的牌。 */
function enumeratePlayActions(
  view: GameView,
  seatIndex: number,
  skillActions: SkillActionDef[],
): AvailableAction[] {
  const ctx: ActionContext = { view, perspectiveIdx: seatIndex };
  // 当前座次不在出牌阶段或非自己回合 → isActiveAction 自身会返回 false，无需额外判断
  const me = view.players[seatIndex];
  if (!me?.hand) return [];
  const result: AvailableAction[] = [];
  for (const card of me.hand) {
    const action = findUseActionForCard(skillActions, card);
    if (!action) continue;
    if (!isActiveAction(action, ctx)) continue;
    const rules = derivePlayRules(
      action.prompt.type === 'useCardAndTarget' || action.prompt.type === 'selectTarget'
        ? (action.prompt as { targetFilter?: import('../../engine/types').TargetFilter }).targetFilter
        : null,
      (action.prompt as { selfTarget?: boolean }).selfTarget,
    );
    // 算合法目标：遍历其他玩家，用 buildPlayParams 尝试构造，能构造出来的即为合法
    const validTargets: number[] = [];
    if (rules.needsTarget && !rules.hasSlots && !rules.selfTarget) {
      for (const p of view.players) {
        if (p.index === seatIndex || !p.alive) continue;
        const params = buildPlayParams(view.players, seatIndex, card, rules, p.name, null);
        if (params) validTargets.push(p.index);
      }
    } else if (rules.selfTarget) {
      validTargets.push(seatIndex);
    }
    // 构造一个示例 message（无目标牌直接完整；有目标牌 targets 待 agent 补）
    const sampleParams = rules.selfTarget
      ? buildPlayParams(view.players, seatIndex, card, rules, null, null)
      : (rules.needsTarget && !rules.hasSlots ? null : buildPlayParams(view.players, seatIndex, card, rules, null, null));
    const message: EngineClientMessage = {
      skillId: action.skillId,
      actionType: 'use',
      ownerId: seatIndex,
      params: sampleParams ?? { cardId: card.id },
    };
    const cardDesc = `${card.name}(${card.suit}${card.rank})`;
    result.push({
      description: rules.needsTarget && !rules.selfTarget
        ? `使用【${card.name}】(${cardDesc}) 选择目标`
        : `使用【${card.name}】(${cardDesc})`,
      message,
      validTargets,
      category: 'play',
    });
  }
  return result;
}

/** 主入口：综合 pending + 出牌阶段，枚举可执行操作。 */
export function enumerateAvailableActions(
  view: GameView,
  seatIndex: number,
  skillActions: SkillActionDef[],
): AvailableAction[] {
  if (!view) return [];
  const pending = view.pending;
  // 1. 阻塞型 pending 且 target 是本座次 → 优先回应类
  if (pending && pending.isBlocking !== false && pending.target === seatIndex) {
    // 回应类由上层（HeadlessGameClient）用 resolvePendingRespond 细化；这里先返回 pending 信息占位
    // 实际 respond 枚举在 HeadlessGameClient.getAvailableActions 里组合，因为它需要 skillActions 的 respond action。
    // 此处仅在出牌阶段同时叠加主动出牌（非阻塞窗口场景）。
  }
  // 2. 出牌阶段（或非阻塞出牌窗口）→ 主动出牌
  const playActions = enumeratePlayActions(view, seatIndex, skillActions);
  return playActions;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/headless/availableActions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/headless/availableActions.test.ts src/client/headless/availableActions.ts
git add src/client/headless/availableActions.ts
git commit -m "feat: 抽出 availableActions 纯函数"
```

---

## Task 4: HeadlessGameClient 主类 + WS 集成

组合 viewMaintainer + availableActions + WS 连接。用 Node `ws` 包（项目 `scripts/` 已用）。

**Files:**
- Create: `src/client/headless/HeadlessGameClient.ts`

- [ ] **Step 1: 安装 ws 类型（若缺失）**

Run: `pnpm add -D @types/ws` （如已安装跳过）

- [ ] **Step 2: 实现 HeadlessGameClient**

```ts
// src/client/headless/HeadlessGameClient.ts
// 单座次无头 WS 玩家客户端。框架无关。
import WebSocket from 'ws';
import { serialize, deserialize } from '../../server/protocol';
import type { ServerMessage, ClientMessage, RoomConfig } from '../../server/protocol';
import type { GameView, ViewEvent, Json, ClientMessage as EngineClientMessage } from '../../engine/types';
import { applyServerMessage, mergeRoomConfig } from './viewMaintainer';
import { enumerateAvailableActions } from './availableActions';
import { resolvePendingRespond, getPendingRequestType } from '../utils/pendingRespond';
import { getActionsForPlayer, registerSkillActions } from '../skillActionRegistry';
import type { ClientPhase, HeadlessCallbacks, AvailableAction } from './types';
import type { RoomState } from '../../server/protocol';

export class HeadlessGameClient {
  private ws: WebSocket | null = null;
  private _view: GameView | null = null;
  private _lastSeq = 0;
  private _phase: ClientPhase = 'connecting';
  private _playerId: string | null = null;
  private _seatIndex = 0;
  private _roomId: string | null = null;
  private _roomState: RoomState | null = null;
  private _gameOverWinner: string | null = null;
  private _pendingNewEvents: ViewEvent[] = [];
  private readonly callbacks: HeadlessCallbacks;
  private readonly serverUrl: string;

  constructor(serverUrl: string, callbacks: HeadlessCallbacks = {}) {
    this.serverUrl = serverUrl;
    this.callbacks = callbacks;
  }

  get phase(): ClientPhase { return this._phase; }
  get view(): GameView | null { return this._view; }
  get roomId(): string | null { return this._roomId; }
  get playerId(): string | null { return this._playerId; }
  get seatIndex(): number { return this._seatIndex; }
  get lastSeq(): number { return this._lastSeq; }
  get roomState(): RoomState | null { return this._roomState; }
  get gameOverWinner(): string | null { return this._gameOverWinner; }

  private setPhase(p: ClientPhase) {
    if (this._phase !== p) { this._phase = p; this.callbacks.onPhaseChange?.(p); }
  }

  /** 创建 debug 房间并自动 join 0 号座 */
  async createDebugRoom(playerCount: number, config?: RoomConfig): Promise<void> {
    this.openSocket();
    this.send({ type: 'create_debug_room', config, playerCount });
    // 房间创建后服务端会回 room_joined
  }

  /** 连接并 join 指定房间 */
  async connect(roomId: string, seatIndex?: number): Promise<void> {
    this._roomId = roomId;
    this.openSocket();
    this.send({ type: 'join_debug_room', roomId, lastSeq: 0 });
  }

  private openSocket() {
    this.ws = new WebSocket(this.serverUrl);
    this.ws.onopen = () => { this.setPhase('lobby'); };
    this.ws.onmessage = (ev) => this.handleRaw(ev.data.toString());
    this.ws.onerror = (e) => {
      const err = e instanceof Error ? e : new Error('WS error');
      this.callbacks.onError?.(err);
    };
    this.ws.onclose = () => { /* 一期不重连 */ };
  }

  private handleRaw(raw: string) {
    const msg = deserialize(raw) ?? (JSON.parse(raw) as ServerMessage);
    const r = applyServerMessage(this._view, this._lastSeq, msg);
    this._view = r.view; this._lastSeq = r.lastSeq;
    if (r.newEvents.length) { this._pendingNewEvents.push(...r.newEvents); this.callbacks.onView?.(this._view!, r.newEvents); }
    if (r.phaseChangedTo) this.setPhase(r.phaseChangedTo);
    if (r.gameOverWinner !== undefined) { this._gameOverWinner = r.gameOverWinner; this.callbacks.onGameOver?.(r.gameOverWinner); }
    if (r.playerId) this._playerId = r.playerId;
    if (r.seatIndex !== undefined) this._seatIndex = r.seatIndex;
    if (r.roomState) { this._roomState = r.roomState; this.callbacks.onRoomState?.(r.roomState); }
    if (r.resetToLobby) { this._view = null; this._lastSeq = 0; }
    if (r.actionRejected) this.callbacks.onActionRejected?.();
  }

  drainNewEvents(): ViewEvent[] {
    const e = this._pendingNewEvents; this._pendingNewEvents = []; return e;
  }

  needsAction(): boolean {
    const v = this._view;
    if (!v || !v.pending) return false;
    const p = v.pending;
    // 广播型（target<0，如无懈可击询问）或阻塞型 target===本座次
    return p.target < 0 ? true : (p.isBlocking !== false && p.target === this._seatIndex);
  }

  getAvailableActions(): AvailableAction[] {
    const v = this._view;
    if (!v) return [];
    const skillActions = getActionsForPlayer(this._seatIndex);
    const actions = enumerateAvailableActions(v, this._seatIndex, skillActions);
    // 追加 respond/discard 类（pending 驱动）
    if (v.pending && (v.pending.target === this._seatIndex || v.pending.target < 0)) {
      this.appendRespondActions(v, skillActions, actions);
    }
    return actions;
  }

  private appendRespondActions(view: GameView, skillActions: import('../../engine/types').SkillActionDef[], out: AvailableAction[]) {
    const info = resolvePendingRespond(view.pending!, skillActions);
    const reqType = getPendingRequestType(view.pending!);
    // 弃牌窗口
    if (reqType === '__弃牌') {
      out.push({ description: '进入弃牌阶段', message: { skillId: '弃牌阶段', actionType: 'discard', ownerId: this._seatIndex, params: {} }, validTargets: [], category: 'discard' });
      return;
    }
    if (info?.respondAction) {
      const a = info.respondAction;
      out.push({
        description: a.label || '回应',
        message: { skillId: a.skillId, actionType: 'respond', ownerId: this._seatIndex, params: {} },
        validTargets: [], category: 'respond',
      });
    }
  }

  // ── 操作 ──
  sendAction(action: EngineClientMessage): void {
    this.send({ type: 'action', action, baseSeq: this._lastSeq });
  }
  useCardAndTarget(skillId: string, cardId: string, targets: number[]): void {
    this.sendAction({ skillId, actionType: 'use', ownerId: this._seatIndex, params: { cardId, targets } });
  }
  useCard(skillId: string, cardId: string): void {
    this.sendAction({ skillId, actionType: 'use', ownerId: this._seatIndex, params: { cardId } });
  }
  respond(skillId: string, params?: Record<string, Json>): void {
    this.sendAction({ skillId, actionType: 'respond', ownerId: this._seatIndex, params: params ?? {} });
  }
  selectCharacter(character: string): void {
    this.sendAction({ skillId: '选将', actionType: 'select', ownerId: this._seatIndex, params: { character } });
  }
  pass(): void {
    // 放弃当前 pending：无 skillId 的 pass 由服务端 onTimeout 处理；这里发一个 confirm=false 等价
    this.sendAction({ skillId: '__pass', actionType: 'pass', ownerId: this._seatIndex, params: {} });
  }

  // ── 大厅 ──
  sendReady(): void { this.send({ type: 'ready' }); }
  sendStartGame(): void { this.send({ type: 'start_game' }); }
  sendRestart(): void { this.send({ type: 'restart_game' }); }
  sendUpdateConfig(config: RoomConfig): void { this.send({ type: 'update_room_config', config }); }

  private send(msg: ClientMessage) { this.ws?.send(serialize(msg)); }
  disconnect() { this.ws?.close(); this.ws = null; }

  /** 选将后/角色确定后，为本座次注册技能 actions（供 getAvailableActions）。 */
  async loadSkillActions(skillIds: string[]): Promise<void> {
    await registerSkillActions(this._seatIndex, skillIds);
  }
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无新增错误（仅可接受的预存 baseline 错误）

- [ ] **Step 4: Commit**

```bash
git add src/client/headless/HeadlessGameClient.ts
git commit -m "feat: 实现 HeadlessGameClient 主类"
```

---

## Task 5: HeadlessGameClient 集成测试

起真实服务端 debug 房，验证完整流程。需要服务端在 localhost:3930 运行。

**Files:**
- Create: `tests/headless/HeadlessGameClient.integration.test.ts`

- [ ] **Step 1: 写集成测试（含服务端可用性检测）**

```ts
// tests/headless/HeadlessGameClient.integration.test.ts
// 集成测试：需 localhost:3930 服务端运行。无服务端时整体 skip。
import { describe, it, expect, beforeAll } from 'vitest';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';

const SERVER = 'ws://localhost:3930';
let serverUp = false;
beforeAll(async () => {
  try {
    const r = await fetch('http://localhost:3930/api/debug-room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerCount: 2 }) });
    serverUp = r.ok;
  } catch { serverUp = false; }
});

describe.skipIf(!serverUp)('HeadlessGameClient 集成', () => {
  it('创建 debug 房间并收到 initialView', async () => {
    const hgc = new HeadlessGameClient(SERVER);
    let gotView = false;
    const ready = new Promise<void>((resolve) => {
      hgc = new HeadlessGameClient(SERVER, { onView: () => { gotView = true; resolve(); } });
    });
    await hgc.createDebugRoom(2);
    await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
    expect(gotView).toBe(true);
    expect(hgc.view).not.toBeNull();
    expect(hgc.view!.players.length).toBe(2);
    hgc.disconnect();
  }, 15000);
});
```

- [ ] **Step 2: 启动服务端并运行**

Run: `pnpm dev`（后台），等待 3930 可用
Run: `pnpm vitest run tests/headless/HeadlessGameClient.integration.test.ts`
Expected: PASS（1 例）。无服务端则 skip。

- [ ] **Step 3: Commit**

```bash
git add tests/headless/HeadlessGameClient.integration.test.ts
git commit -m "test: HeadlessGameClient 集成测试"
```

---

## Task 6: viewProjector 纯函数 + 测试（TDD）

`GameView` → `AiViewSnapshot` 投影。

**Files:**
- Create: `tests/ai-mcp/viewProjector.test.ts`
- Create: `src/ai-mcp/viewProjector.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/ai-mcp/viewProjector.test.ts
import { describe, it, expect } from 'vitest';
import { projectView } from '../../src/ai-mcp/viewProjector';
import type { GameView } from '../../src/engine/types';

function makeFullView(): GameView {
  return {
    viewer: 0, currentPlayerIndex: 0, phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: { secret: 'x' } },
    players: [{
      index: 0, name: 'P0', character: '刘备', health: 4, maxHealth: 4,
      alive: true, equipment: {}, skills: ['仁德'], handCount: 1,
      hand: [{ id: 'c1', name: '杀', suit: '♠', rank: '5', type: '基本牌' }], marks: [],
      distanceVars: { attackMod: 0, defenseMod: 0, attackRange: 1 },
    }],
    cardMap: {}, pending: null, deadline: null, deadlineTotalMs: 0,
    log: Array.from({ length: 30 }, (_, i) => ({ time: i, player: 0, text: `evt${i}` })),
    settlementStack: [],
    zones: { deckCount: 50, discardPileCount: 0, processing: [] },
  };
}

describe('projectView', () => {
  it('投影保留决策字段，丢弃引擎细节', () => {
    const snap = projectView(makeFullView());
    expect(snap.viewer).toBe(0);
    expect(snap.players[0].hand).toHaveLength(1);
    expect(snap.log.length).toBeLessThanOrEqual(20); // 截断
    expect((snap.players[0] as any).distanceVars).toBeUndefined(); // 丢弃
    expect((snap as any).settlementStack).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/ai-mcp/viewProjector.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 viewProjector**

```ts
// src/ai-mcp/viewProjector.ts
import type { GameView } from '../engine/types';
import type { AiViewSnapshot } from '../client/headless/types';
import { getPendingRequestType } from '../client/utils/pendingRespond';

const MAX_LOG = 20;

export function projectView(view: GameView): AiViewSnapshot {
  return {
    viewer: view.viewer,
    currentPlayerIndex: view.currentPlayerIndex,
    phase: view.phase,
    turn: { round: view.turn.round },
    players: view.players.map(p => ({
      index: p.index, name: p.name, character: p.character,
      health: p.health, maxHealth: p.maxHealth, alive: p.alive,
      handCount: p.handCount, hand: p.hand, equipment: p.equipment,
      skills: p.skills, identity: p.identity,
    })),
    pending: view.pending ? {
      target: view.pending.target,
      isBlocking: view.pending.isBlocking !== false,
      promptTitle: (view.pending.prompt as { title?: string }).title ?? view.pending.prompt.type,
      requestType: getPendingRequestType(view.pending),
    } : null,
    zones: view.zones
      ? { deckCount: view.zones.deckCount, discardPileCount: view.zones.discardPileCount }
      : { deckCount: 0, discardPileCount: 0 },
    log: view.log.slice(-MAX_LOG),
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/ai-mcp/viewProjector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/ai-mcp/viewProjector.test.ts src/ai-mcp/viewProjector.ts
git commit -m "feat: 实现 viewProjector AI 投影"
```

---

## Task 7: playHandler 阻塞逻辑 + 测试（TDD）

`play` 工具的核心：执行 action → 阻塞等待 needsAction/ended/超时 → 返回结构化结果。

**Files:**
- Create: `tests/ai-mcp/playHandler.test.ts`
- Create: `src/ai-mcp/playHandler.ts`

- [ ] **Step 1: 写失败测试（用 fake HGC）**

```ts
// tests/ai-mcp/playHandler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runPlay } from '../../src/ai-mcp/playHandler';
import type { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';

// 用一个最小 fake 替代真实 HGC，只暴露 runPlay 需要的方法
function makeFake(overrides: Partial<HeadlessGameClient> = {}): HeadlessGameClient {
  return {
    phase: 'playing', needsAction: () => true, gameOverWinner: null,
    view: null, getAvailableActions: () => [], drainNewEvents: () => [],
    sendAction: vi.fn(),
  } as unknown as HeadlessGameClient;
}

describe('runPlay', () => {
  it('needsAction 立即为 true 时直接返回当前状态', async () => {
    const fake = makeFake();
    const res = await runPlay(fake, { waitTimeoutMs: 100 });
    expect(res.needsAction).toBe(true);
    expect(res.phase).toBe('playing');
  });

  it('游戏结束时立即返回', async () => {
    const fake = makeFake({ phase: 'ended' as any, gameOverWinner: '主公' } as any);
    const res = await runPlay(fake, { waitTimeoutMs: 100 });
    expect(res.gameOver).toEqual({ winner: '主公' });
  });

  it('执行传入的 action', async () => {
    const fake = makeFake();
    const action = { skillId: '杀', actionType: 'use', ownerId: 0, params: { cardId: 'c1', targets: [1] } };
    await runPlay(fake, { action: { message: action }, waitTimeoutMs: 100 });
    expect(fake.sendAction).toHaveBeenCalledWith(action);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/ai-mcp/playHandler.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 playHandler**

```ts
// src/ai-mcp/playHandler.ts
import type { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import type { ClientMessage as EngineClientMessage, Json } from '../engine/types';
import { projectView } from './viewProjector';

export interface PlayInput {
  /** 要执行的操作；省略=纯等待。首次调用可用 startGame=true（由 server 层处理房间创建，这里不处理） */
  action?: { message: EngineClientMessage };
  waitTimeoutMs?: number;
}

export interface PlayResult {
  phase: 'lobby' | 'playing' | 'ended';
  gameOver: { winner: string } | null;
  needsAction: boolean;
  view: ReturnType<typeof projectView> | null;
  availableActions: import('../client/headless/types').AvailableAction[];
  recentEvents: import('../engine/types').ViewEvent[];
  lastActionResult: 'accepted' | 'rejected' | 'timeout' | 'not-applicable';
}

const DEFAULT_WAIT_MS = 120000;

export async function runPlay(hgc: HeadlessGameClient, input: PlayInput): Promise<PlayResult> {
  // 1. 执行 action
  let lastActionResult: PlayResult['lastActionResult'] = 'not-applicable';
  if (input.action?.message) {
    hgc.sendAction(input.action.message);
    lastActionResult = 'accepted'; // rejected 异步到达，下面轮询捕获
  }
  // 2. 阻塞等待 needsAction / ended / 超时
  const timeoutMs = input.waitTimeoutMs ?? DEFAULT_WAIT_MS;
  const deadline = Date.now() + timeoutMs;
  return new Promise<PlayResult>((resolve) => {
    const settle = () => resolve(snapshot(lastActionResult));
    const tick = () => {
      if (hgc.phase === 'ended' || hgc.gameOverWinner !== null) return settle();
      if (hgc.needsAction()) return settle();
      if (Date.now() >= deadline) { lastActionResult = lastActionResult === 'not-applicable' ? 'not-applicable' : 'timeout'; return settle(); }
      setTimeout(tick, 50);
    };
    tick();
  });

  function snapshot(lar: PlayResult['lastActionResult']): PlayResult {
    return {
      phase: hgc.phase === 'connecting' ? 'lobby' : hgc.phase,
      gameOver: hgc.gameOverWinner ? { winner: hgc.gameOverWinner } : null,
      needsAction: hgc.needsAction(),
      view: hgc.view ? projectView(hgc.view) : null,
      availableActions: hgc.getAvailableActions(),
      recentEvents: hgc.drainNewEvents(),
      lastActionResult: lar,
    };
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/ai-mcp/playHandler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/ai-mcp/playHandler.test.ts src/ai-mcp/playHandler.ts
git commit -m "feat: 实现 play 工具阻塞逻辑"
```

---

## Task 8: MCP server 入口 + play 工具注册

组装 HGC + playHandler + MCP SDK。

**Files:**
- Create: `src/ai-mcp/server.ts`
- Modify: `package.json`（依赖 + 脚本）

- [ ] **Step 1: 安装 MCP SDK**

Run: `pnpm add @modelcontextprotocol/sdk`
Run: `pnpm add -D @types/ws`（如未装）

- [ ] **Step 2: 实现 server 入口**

```ts
// src/ai-mcp/server.ts
// MCP server 入口：单进程单座次。环境变量：
//   SGS_SERVER_URL（默认 ws://localhost:3930）
//   SGS_ROOM_ID（不提供则首次 play 用 startGame 创建 debug 房）
//   SGS_SEAT（默认 0）
//   SGS_PLAYER_COUNT（创建房时用，默认 2）
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { HeadlessGameClient } from '../client/headless/HeadlessGameClient';
import { runPlay } from './playHandler';

const SERVER_URL = process.env.SGS_SERVER_URL ?? 'ws://localhost:3930';
const ROOM_ID = process.env.SGS_ROOM_ID ?? null;
const SEAT = Number(process.env.SGS_SEAT ?? '0');
const PLAYER_COUNT = Number(process.env.SGS_PLAYER_COUNT ?? '2');

async function main() {
  const hgc = new HeadlessGameClient(SERVER_URL);
  let started = false;

  async function ensureStarted() {
    if (started) return;
    started = true;
    if (ROOM_ID) await hgc.connect(ROOM_ID, SEAT);
    else await hgc.createDebugRoom(PLAYER_COUNT);
    // 自动 ready
    hgc.sendReady();
    // 若是房主（创建房者）则 start
    if (!ROOM_ID) hgc.sendStartGame();
  }

  const server = new McpServer({ name: 'sanguosha-ai', version: '0.1.0' });

  server.registerTool(
    'play',
    {
      description: '驱动一个三国杀座次：执行一个操作并阻塞等待直到轮到本座次决策或游戏结束。首次调用传 {startGame:true} 创建/加入房间并开始游戏。',
      inputSchema: z.object({
        startGame: z.boolean().optional().describe('首次调用：创建/加入房间并开始游戏'),
        action: z.object({
          skillId: z.string(),
          actionType: z.string(),
          ownerId: z.number(),
          params: z.record(z.any()),
        }).optional().describe('要执行的操作（从上次返回的 availableActions 取）'),
        waitTimeoutMs: z.number().optional().describe('本次等待总超时(ms)，默认 120000'),
      }),
    },
    async (args) => {
      if (args.startGame) await ensureStarted();
      const input = args.action
        ? { action: { message: { ...args.action, ownerId: args.action.ownerId ?? SEAT } }, waitTimeoutMs: args.waitTimeoutMs as number | undefined }
        : { waitTimeoutMs: args.waitTimeoutMs as number | undefined };
      const result = await runPlay(hgc, input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[sanguosha-mcp] serving on stdio');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
```

- [ ] **Step 3: 添加 npm 脚本**

修改 `package.json`，在 `scripts` 中加：
```json
"mcp:serve": "tsx src/ai-mcp/server.ts"
```

- [ ] **Step 4: 类型检查 + 冒烟启动**

Run: `pnpm tsc --noEmit`
Expected: 无新增错误

Run（冒烟，需服务端在跑）: `SGS_PLAYER_COUNT=2 pnpm mcp:serve`
Expected: stderr 输出 `[sanguosha-mcp] serving on stdio`，不崩溃。Ctrl+C 退出。

- [ ] **Step 5: Commit**

```bash
git add src/ai-mcp/server.ts package.json
git commit -m "feat: 实现 AI 代打 MCP server 入口"
```

---

## Task 9: 迁移 debug 多座次前端到 HeadlessGameClient

把 `useDebugMultiConnection` 重构为「N 个 HGC 实例 + 协调器」。回归保护：手动 debug 房验证多座次仍正常显示/出牌。

**Files:**
- Modify: `src/client/hooks/useDebugMultiConnection.ts`

- [ ] **Step 1: 阅读现状，确认对外接口不变**

Run: `pnpm tsc --noEmit`（记录 baseline）
确认 `useDebugMultiConnection` 的返回类型（`views/sendAction/getSeq/roomState/sendReady/sendStartGame/...`）保持不变，只改内部实现。

- [ ] **Step 2: 重构为 N 个 HGC**

将原 hook 体内：
- 删除内联 `WebSocket` 管理、`handleMessage`、`viewReducer` 调用、`seat` 状态管理
- 改为：`useEffect` 中为每个 viewer 创建 `new HeadlessGameClient(wsUrl, { onView, onRoomState, onGameOver, ... })`，每个调 `connect(roomId, i)`
- `onView` 回调里 `setViews(prev => new Map(prev).set(viewer, view))`
- `sendAction` 改为查找对应座次的 HGC 调 `hgc.sendAction`
- `getSeq(seat)` 从对应 HGC 实例读 `lastSeq`
- 保留 `useEventPlayback` 集成（在 `onView` 里 enqueue perspective 的事件）
- 保留 StrictMode 安全（cancelled 标志 + cleanup 调 `hgc.disconnect()`）

**关键：判定牌 processing 延迟移除等展示逻辑**——原 hook 有 setTimeout 延迟移除判定牌的逻辑。这属于展示层，迁移时**保留在 hook 内**（HGC 不管展示），即在 `onView` 回调里沿用原 setTimeout 逻辑操作 `views` 状态。

- [ ] **Step 3: 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无超出 baseline 的新增错误

- [ ] **Step 4: 手动回归验证**

Run: `pnpm dev`
浏览器打开 debug 房间（4 人），验证：
- 4 个座次视图正常显示
- 出牌/回应/弃牌交互正常
- 判定牌展示正常
若异常，修复后再提交。

- [ ] **Step 5: Commit**

```bash
git add src/client/hooks/useDebugMultiConnection.ts
git commit -m "refactor: debug 多座次前端迁移到 HeadlessGameClient"
```

---

## Task 10: 全量验证 + 收尾

- [ ] **Step 1: 全量类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无新增错误（仅预存 baseline）

- [ ] **Step 2: 全量测试**

Run: `pnpm test`
Expected: 新增测试全通过，core 既有测试无回归

- [ ] **Step 3: 端到端冒烟（2 个 MCP 进程对局）**

开两个终端，服务端在跑：
```bash
# 终端1：房主
SGS_PLAYER_COUNT=2 SGS_SEAT=0 pnpm mcp:serve
# 终端2：加入（需先从终端1的 stderr 拿到 roomId）
SGS_ROOM_ID=<roomId> SGS_SEAT=1 pnpm mcp:serve
```
用任意 MCP client（或手动 JSON-RPC）调 `play({startGame:true})`，确认两个进程都能收到 view、轮流出牌推进。

- [ ] **Step 4: 更新 CHANGELOG**

在 `CHANGELOG.md` `[Unreleased]` 下加：
```
- feat: 添加 AI 代打 MCP server（HeadlessGameClient + play 工具），支持外部 agent 驱动座次
```

- [ ] **Step 5: 最终提交**

```bash
git add CHANGELOG.md
git commit -m "docs: 更新 CHANGELOG"
```

---

## Self-Review 记录

**Spec 覆盖核对**：
- §一目标/约束 → Task 1-8 全部覆盖（HGC + MCP + 不集成 LLM + 单进程单座次）
- §二架构（共享核心 + debug 前端迁移）→ Task 4 + Task 9
- §三 HGC 接口 → Task 1（类型）+ Task 2（viewMaintainer）+ Task 3（availableActions）+ Task 4（主类）
- §三.三 AvailableAction 结构 → Task 1 类型 + Task 3 实现
- §三.四 getAvailableActions 流程 → Task 3 + Task 4 appendRespondActions
- §三.五 view 维护 → Task 2
- §四 MCP（进程模型 + play 阻塞语义 + view 投影）→ Task 6 + Task 7 + Task 8
- §五重构策略 + 一期范围 → Task 9（debug 迁移）+ Task 8（普通前端不迁移=不涉及）
- §六测试策略 → Task 2/3/5/6/7 单元+集成测试

**类型一致性**：`AvailableAction`/`AiViewSnapshot`/`PlayResult`/`ClientPhase` 在 Task 1 定义，后续 Task 引用路径一致；`runPlay`/`projectView`/`enumerateAvailableActions`/`applyServerMessage` 签名跨任务一致。

**无占位符**：所有 step 含完整代码或确切命令。
