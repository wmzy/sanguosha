# AI 代打 MCP Server 设计

> 创建日期: 2026-06-26
> 状态: 设计待实现

## 一、目标与背景

为三国杀游戏添加 **AI 代打**能力：把游戏引擎包装成一个**游戏环境**，通过 MCP server 暴露给通用 agent（Claude Code、OMP、Pi 等），由外部 agent 驱动某个座次的完整生命周期（进房间、准备、开始游戏、选将、出牌循环）。

**核心约束（已与用户确认）**：

- 游戏项目**不集成 LLM**、不碰 API key——LLM 推理由外部 agent 完成。项目只提供「游戏环境」。
- 暴露形态为 **MCP server**（常驻进程），优先 stdio transport，兼容标准 MCP client。
- MCP server 是**无头 WS 玩家客户端**，连真实服务端房间（`localhost:3930`），复用现有 WS 协议与服务端房间/对局/持久化设施。
- **一个 MCP 进程 = 一个座次视角**。多座次对局 = 多个 agent 各启动一个 MCP 进程连同一房间。一个 agent 只接管一个视角。
- 开局走完整流程：进房间 → 准备 → 开始游戏 → 选将 → 出牌循环。
- 复用现有已抽成纯函数的「可执行操作枚举」逻辑（`gameViewHelpers` / `pendingRespond` / `skillActionRegistry` / `view/reducer`）。

**实现方案：共享核心库**——把前端连接+view 维护+交互层抽成框架无关的 `HeadlessGameClient`（下称 HGC），debug 多座次前端与 MCP server 共用。普通真人前端一期不改（二期再说）。

### 不做什么（YAGNI）

- 一期不集成 LLM、不内置 AI 规则兜底。
- 一期不做 CLI 宿主（仅 MCP）。
- 一期不做断线重连（断开即报错 `onError`）。
- 一期不做 MCP 主动推送（状态推进靠 `play` 工具的阻塞返回）。
- 一期不迁移普通真人前端到 HGC。

---

## 二、总体架构

核心抽象 `HeadlessGameClient`（HGC）：一个框架无关的「单座次 WS 玩家客户端」。它把现有 `useDebugMultiConnection` 里耦合 React 的连接/view 维护逻辑剥离出来，变成命令式、事件驱动的类。

```mermaid
graph LR
  subgraph 共享核心["src/client/headless/"]
    HGC["HeadlessGameClient<br/>(单座次 WS 玩家)"]
  end
  subgraph 纯函数["已就位纯函数(直接复用,不改)"]
    GVH["gameViewHelpers<br/>pendingRespond<br/>skillActionRegistry<br/>view/reducer"]
  end
  HGC --> GVH

  subgraph 宿主2["debug 多座次前端(一期迁移)"]
    H2["N 个 HGC 实例<br/>+ 协调器"]
  end
  subgraph 宿主3["MCP server(新)"]
    H3["1 个 HGC 实例<br/>+ MCP tools"]
  end
  H2 --> HGC
  H3 --> HGC

  HGC -.WS.-> SRV["服务端房间<br/>localhost:3930"]
  AGENT["外部通用 agent<br/>(Claude Code/OMP)"] ==MCP stdio==> H3
```

**职责切分**：

| 层 | 职责 | 形态 |
|---|---|---|
| `HeadlessGameClient` | WS 连接、消息分发、单座次 `view` 维护（`initialView` baseline + `viewReducer` 增量）、房间生命周期（join/ready/start）、选将、`sendAction`、可执行操作枚举 | 命令式类，事件回调（`onView`/`onRoomState`/`onPhaseChange`/`onGameOver`/`onActionRejected`/`onError`），零 React 依赖 |
| 纯函数层 | `viewReducer`、`gameViewHelpers`、`pendingRespond`、`skillActionRegistry` | 已存在，一期不改 |
| 宿主 | 把 HGC 回调桥接到各自运行时（React state / MCP tool 返回） | 各自薄适配 |

**模块位置**：HGC 放 `src/client/headless/`，与同目录纯函数（`src/client/utils/`、`src/client/view/`、`src/client/skillActionRegistry.ts`）协同。MCP server 放 `src/ai-mcp/`。

**为什么这样切**：现有 `useDebugMultiConnection` 的消息处理（initialView/event/notify/deadline/room_state/gameOver）全是纯逻辑，React 只提供 `useState` 容器。把容器换成「类内字段 + 回调」，逻辑一行不改地搬进 HGC；纯函数层（可执行操作枚举）本就框架无关，直接复用。

---

## 三、HeadlessGameClient 接口

### 3.1 生命周期状态机

一个连接经历四个阶段，HGC 用 `phase` 字段暴露：

```
connecting → lobby(配置/大厅) → playing(对局中) → ended(游戏结束)
                                    ↑ restart ↘
```

- `connecting`：WS 连接建立中
- `lobby`：已 join 房间，处于配置/准备阶段（房间未开始游戏）
- `playing`：游戏进行中
- `ended`：游戏结束（收到 `gameOver` 消息）

### 3.2 核心接口

```ts
// src/client/headless/HeadlessGameClient.ts
import type { GameView, ViewEvent, Json } from '../../engine/types';
import type { ClientMessage as EngineClientMessage } from '../../engine/types';
import type { RoomConfig, RoomState } from '../../server/protocol';

export type ClientPhase = 'connecting' | 'lobby' | 'playing' | 'ended';

export interface HeadlessCallbacks {
  /** view 每次更新（initialView 或增量 event 后）。携带自上次以来的新事件窗口 */
  onView?: (view: GameView, newEvents: ViewEvent[]) => void;
  /** 配置阶段房间状态变化 */
  onRoomState?: (state: RoomState | null) => void;
  /** 阶段切换（进入 lobby/playing/ended） */
  onPhaseChange?: (phase: ClientPhase) => void;
  /** 游戏结束 */
  onGameOver?: (winner: string) => void;
  /** 出牌被拒（CAS baseSeq 失配或 validate 失败） */
  onActionRejected?: () => void;
  /** 连接异常/断开 */
  onError?: (err: Error) => void;
}

export class HeadlessGameClient {
  constructor(serverUrl: string, callbacks?: HeadlessCallbacks);

  // ── 连接与生命周期 ──
  /** 连接并 join 指定房间（debug 房用 join_debug_room） */
  connect(roomId: string, seatIndex?: number): Promise<void>;
  /** 创建 debug 房间（可选 playerCount），成功后自动 join 0 号座 */
  createDebugRoom(playerCount: number, config?: RoomConfig): Promise<void>;
  disconnect(): void;

  // ── 大厅/配置阶段 ──
  sendReady(): void;
  sendStartGame(): void;
  sendRestart(): void;
  sendUpdateConfig(config: RoomConfig): void;

  // ── 游戏阶段：查询（均基于本地 view，无网络往返）──
  get phase(): ClientPhase;
  get view(): GameView | null;             // 当前座次完整快照（可能 null）
  get roomId(): string | null;
  get playerId(): string | null;
  get seatIndex(): number;                 // 本座次下标
  get lastSeq(): number;
  /** 自上次查询以来的新事件（消费后清空） */
  drainNewEvents(): ViewEvent[];
  /** 当前是否轮到本座次操作：阻塞型 pending target===本座次，或广播型 pending（如无懈可击询问） */
  needsAction(): boolean;
  /** 枚举本座次当前可执行操作（复用 gameViewHelpers + pendingRespond + skillActions） */
  getAvailableActions(): AvailableAction[];

  // ── 游戏阶段：操作（构造 ClientMessage 并 send，自动填 baseSeq=lastSeq）──
  sendAction(action: EngineClientMessage): void;   // 通用入口
  // 便捷封装：
  useCardAndTarget(skillId: string, cardId: string, targets: number[]): void;
  useCard(skillId: string, cardId: string): void;
  respond(skillId: string, params?: Record<string, Json>): void;
  selectCharacter(character: string): void;         // 选将（对应选将 pending）
  pass(): void;                                      // 放弃当前 pending
}
```

### 3.3 AvailableAction 结构

`getAvailableActions()` 是 AI 决策的核心输入。它把「可执行操作」拍平成一个数组，每个元素是可直接喂给 `sendAction` 的完整 `EngineClientMessage`（预填好 `skillId/actionType/params` 模板），加上人类可读描述。agent 只需从列表里选一条 + 补 `targets`，无需自己拼参数。

```ts
export interface AvailableAction {
  /** 人类可读描述，如 "使用【杀】(♠5) 攻击 P2" / "出【闪】响应杀" / "进入弃牌阶段(选 X 张)" */
  description: string;
  /** 预填的 ClientMessage 模板；目标类操作 targets 需 agent 补全 */
  message: EngineClientMessage;
  /** 合法目标座次列表（无目标操作为空）；cardFilter/targetFilter 已跑过 */
  validTargets: number[];
  /** 操作类别，便于 agent 分流：主动出牌 / 回应 / 弃牌 / 选将 / 转化 / 分配 */
  category: 'play' | 'respond' | 'discard' | 'selectChar' | 'transform' | 'distribute';
}
```

### 3.4 getAvailableActions 实现流程

直接复用纯函数层。内部流程：

1. `view.pending` 存在 → `resolvePendingRespond()` 推导回应信息（出闪/出杀响应/弃牌/选将）
2. 出牌阶段（无阻塞型 pending 或非阻塞出牌窗口）→ 遍历 `getActionsForPlayer(seat)` 跑 `isActiveAction()` + `extractCardFilter()` 匹配手牌
3. 每个匹配产出 `AvailableAction`（预填 message + `derivePlayRules` 算 validTargets）
4. 弃牌/选将 pending 各自专门分支

这层逻辑已在 `usePlayInteraction` / `gameViewHelpers` 验证过，HGC 复用即可。

### 3.5 view 维护

照搬 `useDebugMultiConnection` 的 `viewReducer` 增量逻辑：

- `initialView` 消息 → 建立 baseline `view`，记录 `lastSeq`
- `event` 消息（`msg.view`）→ `viewReducer(view, event)` 原地增量更新
- `event` 消息（`msg.notify`）→ `pendingResolved` 时清除 `view.pending`（target 匹配本座次或广播型 target<0）
- `event` 消息（`msg.deadline`）→ 权威 deadline 覆盖（写入 `view.pending.deadline/totalMs` 或 `view.deadline`）
- `room_state` / `room_config` / `player_ready` / `room_joined` → 更新 RoomState
- `game_started` → phase 切到 playing
- `gameOver` → phase 切到 ended，触发 `onGameOver`
- `game_reset` → 清空 view 缓存，回到 lobby

**判定牌 processing 延迟移除等纯展示逻辑不搬**（无头客户端不渲染）。

---

## 四、MCP Server 与 Tools

### 4.1 进程模型

一个 MCP server 进程持**一个 HGC 实例**（= 一个座次）。agent 配置时启动该进程，通过 stdio 与之通信；多座次对局 = 每个 agent 各启动一个 MCP server 进程，连同一房间。server 生命周期绑定 agent 会话，进程退出即断开连接。

HGC 实例在 server 启动时按环境变量决定行为：
- `SGS_SERVER_URL`：服务端地址（默认 `ws://localhost:3930`）
- `SGS_ROOM_ID`：要加入的房间（不提供则由 `play` 工具首次调用时创建）
- `SGS_SEAT`：座次下标（默认 0）

### 4.2 核心工具：play（统一动作-观察循环）

`play` 是主工具，统一了 agent 的「动作→观察」循环：执行操作 → **阻塞等待直到「本座次 needsAction=true」或「游戏结束」** → 返回当前状态 + 可执行操作。agent 不需要写轮询/sleep/重试。

```ts
// play 工具入参
{
  action?: {
    // 要执行的操作；省略时语义为「等待」(首次调用 / 不知道做什么时)
    message: EngineClientMessage;   // 从上次 play 返回的 availableActions 取
  } | { startGame?: boolean };       // 首次调用：传入 startGame:true 触发 join+ready+start
  // 可选:本次等待的总超时(ms)，默认跟随当前 pending deadline 或 120000
  waitTimeoutMs?: number;
}

// play 工具返回
{
  phase: 'lobby' | 'playing' | 'ended';
  // 游戏是否结束
  gameOver: { winner: string } | null;
  // 是否轮到本座次操作
  needsAction: boolean;
  // 当前 view 快照（AI 友好投影，见 4.4）
  view: AiViewSnapshot | null;
  // 可执行操作枚举（needsAction=true 时非空）
  availableActions: AvailableAction[];
  // 自上次以来的新事件窗口
  recentEvents: ViewEvent[];
  // 上一次 action 的执行结果
  // 上一次 action 的执行结果:accepted=被服务端接受 / rejected=被拒(pending 已变) / timeout=决策慢被服务端超时 resolve / not-applicable=本次未执行 action(首次 startGame 调用或纯等待)
}
```

### 4.3 play 的阻塞语义（关键）

`play` 只在以下条件满足时 resolve：

1. **本座次 needsAction=true**（阻塞型 pending target===本座次，或广播型 pending 如无懈可击询问），**或**
2. **游戏结束**（phase=ended）。

否则持续阻塞，叠加一个**总超时**（默认跟随当前 pending deadline，或固定 120000ms；可由 `waitTimeoutMs` 覆盖）。超时后返回 `needsAction=false` 的当前状态，agent 可再次 `play` 继续等待。

**各分支处理**：

- **首次调用 `play({ startGame: true })`**：HGC `createDebugRoom` 或 `join` 房间 → 按房主身份分流（房主则 `sendReady`+`sendStartGame`，非房主则 `sendReady`）→ 阻塞等待。lobby 阶段（未开始游戏）`play` 在「游戏开始」或「总超时」时返回 `phase=lobby` + `roomState`，让 agent 感知在等开局。
- **游戏已开始但本座次无 pending**：阻塞等待直到轮到自己或总超时。
- **action 被服务端 rejected（`onActionRejected`）**：pending 多半已被超时 resolve。MCP **吞掉 rejected**，继续等下一个 needsAction 点，把最新状态返回，`lastActionResult='rejected'`。
- **agent 决策太慢，服务端已超时 resolve**：MCP 感知到状态变化（view 更新但 needsAction 未必 true），`lastActionResult='timeout'`，继续等下一个点。
- **游戏结束**：立即返回 `phase=ended` + `gameOver`，不再等待。

**实现机制**：用 HGC 的 `onView` 回调驱动——每次 view 更新后检查 `needsAction()`，满足则 resolve 当前 `play` 的 Promise；叠加 `setTimeout` 总超时。

### 4.4 view 的 AI 友好投影

原始 `GameView` 含大量引擎细节（settlementStack / distanceVars / zone 摘要）。MCP 层做一次精简投影 `AiViewSnapshot`，只保留决策所需字段，降低 token 占用、聚焦 agent 注意力。但 `availableActions` 是完整结构化数据，不省略。

```ts
interface AiViewSnapshot {
  viewer: number;                       // 本座次
  currentPlayerIndex: number;
  phase: TurnPhase;
  turn: { round: number };
  players: Array<{
    index: number;
    name: string;
    character: string;
    health: number;
    maxHealth: number;
    alive: boolean;
    handCount: number;
    hand?: Card[];                      // 仅本座次可见完整手牌
    equipment: Partial<Record<string, string>>;
    skills: string[];
    identity?: string;
  }>;
  pending: {                            // 精简后的 pending 描述
    target: number;
    isBlocking: boolean;
    promptTitle: string;                // 人类可读，如 "请出闪响应杀"
    requestType: string;
  } | null;
  zones: { deckCount: number; discardPileCount: number };
  log: { time: number; player: number; text: string }[];  // 截断最近 20 条
}
```

### 4.5 MCP 实现选型

用 `@modelcontextprotocol/sdk`（官方 TS SDK），stdio transport 为主。

- `McpServer` from `@modelcontextprotocol/server`
- `StdioServerTransport` from `@modelcontextprotocol/server/stdio`
- `server.registerTool('play', { description, inputSchema: z.object({...}) }, handler)` 注册工具
- handler 返回 `{ content: [{type:'text', text: JSON.stringify(...)}], structuredContent: output }`
- 日志走 `console.error`，绝不写 stdout（会污染 stdio 通信通道）

二期可加 HTTP transport（`createMcpHandler` + Node http server）。

---

## 五、实现范围与重构策略

### 5.1 重构策略（最小化前端回归风险）

方案 B 的核心是抽 `HeadlessGameClient`。现有 `useDebugMultiConnection`（440 行）是「单 hook 管 N 连接」，而 HGC 是单座次。重构分两步、各自可独立验证：

1. **抽 HGC**：把 `useDebugMultiConnection` 里 `handleMessage` 的纯逻辑（initialView/event/notify/deadline/room_state/gameOver 分发 + viewReducer 维护 + 可执行操作枚举）搬进 `HeadlessGameClient` 类。React 层只剩 `useState` 容器 + 订阅 HGC 回调。

2. **debug 前端迁移**：`useDebugMultiConnection` 改为「N 个 HGC 实例 + 协调器」，协调器管 N 个 `onView` 回调合并成一个 `views: Map`。这一步用现有 debug 多座次机制做回归保护（手动 debug 房验证；若 `tests/client/` 有连接测试则直接用）。

普通真人前端（`useWebSocket` + `GameView.tsx`）一期**不改**——它是单座次单连接，已是 HGC 的语义子集，但不强制迁移（避免无关回归）。留作二期。

### 5.2 一期交付范围

- ✅ `HeadlessGameClient`（`src/client/headless/`）+ view 维护 + 可执行操作枚举
- ✅ MCP server（`src/ai-mcp/`，`play` 为主工具）+ `@modelcontextprotocol/sdk` 依赖
- ✅ debug 多座次前端迁移到 HGC（回归保护）
- ✅ HGC 单元 + 集成测试
- ✅ MCP server 工具往返测试

### 5.3 二期（明确不在一期）

- 普通真人前端迁移到 HGC
- 断线重连（`reconnect` 消息、lastSeq 续传）
- CLI 宿主
- MCP 主动推送（`onView` 转 MCP 通知）
- MCP HTTP transport

---

## 六、测试策略

遵循项目规范：集成测试优先、不 mock 引擎、无快照。

| 层级 | 测什么 | 怎么测 |
|---|---|---|
| HGC 单元 | view 维护正确性 | 用内存事件流注入，验证 initialView baseline + 增量 event 后 view 与 `buildView` 收敛（复用 `engine-harness` 的 `assertViewConsistency` 思路） |
| HGC 集成 | 完整对局驱动 | 起真实服务端 `createDebugRoom`，多座次 HGC（其中 N-1 个用规则兜底如 `pass`）跑通开局→选将→出牌→结束 |
| MCP server | play 工具往返 | 单进程单座次，模拟 agent `play` 序列，断言阻塞/超时/rejected/lobby 过渡行为 |

**不引入真实 LLM 调用测试**——LLM 在外部 agent，测试只验证「给定 play 返回的状态，HGC/MCP 行为正确」。可参考现有 `scripts/multi-agent-player.mjs` 的多座次对局编排模式来构造测试场景。

---

## 七、关键技术依赖

| 依赖 | 用途 | 来源 |
|---|---|---|
| `viewReducer`（`src/client/view/reducer.ts`） | 增量 view 维护 | 已有，直接复用 |
| `gameViewHelpers`（`src/client/utils/`） | 可执行操作枚举、params 构造、合法目标推导 | 已有，直接复用 |
| `pendingRespond`（`src/client/utils/`） | pending → 回应信息推导 | 已有，直接复用 |
| `skillActionRegistry`（`src/client/`） | 前端技能 action 注册表 | 已有，直接复用 |
| WS 协议（`src/server/protocol.ts`） | 客户端/服务端消息类型 | 已有，直接复用 |
| `@modelcontextprotocol/sdk` | MCP server 实现 | 新增依赖（pnpm add） |

---

## 八、与现有自动出牌脚本的关系

项目已有 `scripts/auto-player.mjs` / `multi-agent-player.mjs`（Node + WS + 规则引擎自动出牌）。它们是**独立 Node 脚本**，决策走硬编码规则，不依赖前端代码。

本设计的 HGC 与它们的共同点是「连 WS 维护 view」，区别是：
- HGC 是**框架无关核心库**，view 维护逻辑从真实前端剥离、与前端单一真相。
- 决策权交给**外部 agent（LLM）**而非硬编码规则。
- 通过 MCP 暴露，而非脚本 `while` 循环。

一期不删除现有脚本（它们仍有调试价值），但 HGC 落地后，脚本可选择迁移到 HGC 之上以消除重复逻辑（二期评估）。
