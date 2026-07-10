# 录像下载与回放 设计文档

> 日期: 2026-07-09
> 状态: 待评审
> 关联: `docs/design/日志与重播设计.md`(已过时,本 spec 替代其回放部分)

## 1. 背景与现状

"日志下载和回放"目前处于**半基础设施**状态:

| 已有 | 说明 |
|---|---|
| `src/client/view/reducer.ts` `viewReducer` | 前端从 GameView 逐步 `applyView`(与后端 apply 对称)。**回放核心能力已具备** |
| `src/client/utils/logFile.ts` | `saveLog/loadLog/saveState/loadState` 纯前端 Blob/File I/O(有单测) |
| `src/client/components/GameLog.tsx` | 游戏内实时日志面板 |
| `useDebugMultiConnection` | debug 模式维护 `views: Map<number, GameView>`,每座次独立事件流 |

| 缺失 | |
|---|---|
| 录像数据导出 | 无 |
| 下载/回放 UI 入口 | 无 |
| `ReplayControls` / 回放引擎 / 回放页 | 无(旧 `replay.ts`/`ReplayEngine`/`reduceGameState` 引擎重写后已归档删除) |

设计文档 `日志与重播设计.md` 的 Operation 模型、`GameLogger`、`ReplayEngine` 均**过时未实现**,实际引擎用 `state.atomHistory: AppliedAtomEntry[]`(含 `atom` + `viewEvents: ViewEventSplit`)作为权威事件源。

## 2. 决策(用户已确认)

- **数据来源**: 客户端实时录制。前端把 WS 收到的 `ViewEvent` 边收边存,游戏结束即可离线下载。无需 server API。
  - debug 模式:浏览器持有所有座次连接,录全部座次 → 回放支持视角切换。
  - 多人模式:只录当前座次 → 回放仅当前视角。
- **粒度**: 逐 atom 事件。每个 atom 的 `ViewEvent` 为一步,与 `viewReducer` 天然对齐。

### 不做(YAGNI)

- ❌ server 录像 API / `/api/.../replay`(用户选客户端录制)
- ❌ `GameLogger`/Operation 模型(已废弃,atomHistory 才是权威)
- ❌ 从 atom 重建完整 GameState(回放只需重建视图,applyView 足够)
- ❌ 录像持久化到 server 磁盘(data/rooms 已存 state,不在本功能范围)

## 3. 录像格式

```ts
// src/client/replay/types.ts
import type { GameView, ViewEvent } from '../../engine/types';

export const REPLAY_FORMAT = 'sanguosha-replay' as const;
export const REPLAY_VERSION = 1;

export interface ReplayMeta {
  createdAt: number;
  playerCount: number;
  /** 按座次顺序的武将名 */
  characters: string[];
  roomName?: string;
}

/** 单座次录像:独立的事件流 */
export interface SeatRecording {
  seatIndex: number;
  playerName: string;
  /** 游戏开始后第一个完整 GameView 的深拷贝(可 JSON 序列化,作为回放起点) */
  initialView: GameView;
  /** 该座次收到的 ViewEvent 序列(逐 atom,seq 升序) */
  events: Array<{ seq: number; time: number; event: ViewEvent }>;
}

export interface ReplayFile {
  format: typeof REPLAY_FORMAT;
  version: typeof REPLAY_VERSION;
  meta: ReplayMeta;
  /** 座次下标 → 录像。debug 模式含全部座次;多人模式只含当前座次 */
  seats: Record<number, SeatRecording>;
}
```

**为什么 initialView 而非从空 view 起步**: 第一个 GameView 出现时(选将完成、首次发牌后)已是完整状态。从它起步避免重放选将/发牌的前置事件,且保证任意步的 view 与实时一致。

**深拷贝要求**: `initialView` 必须可 JSON 序列化(无函数/Map)。`GameView` 的 `pending` 含 `atom: Atom`(纯数据)和 `prompt`(纯数据 ActionPrompt),`settlementStack` 纯数据,均可序列化。需在录制时 `structuredClone` 或 `JSON.parse(JSON.stringify())`。

## 4. 录制机制

### 4.1 录制点

在事件流经 `viewReducer` 的统一层记录。两个连接 hook 都通过 `HeadlessGameClient` → `viewMaintainer.applyServerMessage` 得到 `newEvents: ViewEvent[]`。

**接入方式**: 新增 `useReplayRecorder` hook,由连接层在每个座次收到 `newEvents` 后调用 `recorder.record(seatIndex, events)`。具体:
- `useDebugMultiConnection`: 已持有各座次 HGC,在处理消息时把 `newEvents` 喂给 recorder(所有座次)。
- `useMultiplayerRoom`: 单座次,把 `newEvents` 喂给 recorder(仅当前座次)。

### 4.2 initialView 捕获

recorder 在某座次**首次**产生非空 GameView 时,深拷贝存为该座次 `initialView`。之后只追加 events。

### 4.3 meta 填充

游戏结束时(收到 `gameOver`),从当前 view 提取 `playerCount`、按座次的 `characters`、`roomName`。

### 4.4 录制器接口

```ts
// src/client/replay/recorder.ts
export class ReplayRecorder {
  private seats: Map<number, SeatRecording> = new Map();
  record(seat: number, view: GameView | null, events: ViewEvent[], now = Date.now()): void;
  /** 游戏结束时调用,组装 ReplayFile */
  finalize(meta: ReplayMeta): ReplayFile;
  reset(): void;
}
```

`record` 逻辑:
1. 座次不存在 → 创建,若 `view` 非空则深拷贝为 `initialView`。
2. `events` 逐条 push `{ seq:递增, time, event }`。

## 5. 下载

### 5.1 I/O 函数

复用 `logFile.ts` 模式,新增:
```ts
// src/client/replay/replayFile.ts
export function saveReplay(file: ReplayFile): void;  // Blob 下载,sanguosha-replay-{createdAt}.json
export function loadReplay(file: File): Promise<ReplayFile>;  // 校验 format/version/seats 结构
```

### 5.2 入口

- **游戏结束** `GameResultOverlay`: 新增"⬇ 下载录像"按钮,调用 `recorder.finalize()` + `saveReplay()`。
- 录像数据由 `useReplayRecorder` 通过 React context / props 传到 overlay。

## 6. 回放

### 6.1 回放引擎(纯函数)

```ts
// src/client/replay/replayEngine.ts
export interface ReplayState {
  file: ReplayFile;
  seat: number;          // 当前视角座次
  step: number;          // [0, totalSteps]
}

/** 取某座次第 step 步的 GameView:深拷贝 initialView,applyView 前 step 个 events */
export function getViewAt(rs: ReplayState): GameView;
export function totalSteps(rec: SeatRecording): number;
export function next(rs): ReplayState;
export function prev(rs): ReplayState;
export function goTo(rs, step): ReplayState;
```

`getViewAt`: `structuredClone(initialView)` → 循环 `viewReducer(view, event, time)` 前 `step` 条。
性能:每局几百步,每步 applyView 是 O(view) 轻量 mutation,导航重建 < 5ms。无需中间快照缓存。

### 6.2 回放 hook

```ts
// src/client/hooks/useReplay.ts
export function useReplay(file: ReplayFile) {
  // state: seat, step, playing, speed(0.5/1/2/4x)
  // 自动播放:setInterval 按 speed 推进 step,到末尾停止
  // 返回: view, step, totalSteps, seat, playing, next, prev, goTo, setSeat, togglePlay, setSpeed, exit
}
```

### 6.3 回放页与控制条

- **路由**: `/replay`,新 `ReplayPage.tsx`。首页加"📂 加载录像回放"按钮 → 文件选择 → `loadReplay` → 跳转 `/replay?file=内存`。
- **ReplayControls.tsx**: 步数 `step/total`、上一步、下一步、播放/暂停、进度条(拖拽 goTo)、速度选择、视角 select(座次切换,仅多座次录像显示)、退出回放(回首页)。
- **渲染**: 复用 `GameView.tsx` 渲染 `getViewAt` 返回的 GameView(只读模式,禁用交互/倒计时)。

### 6.4 视角切换

- 录像 `seats` 含多个座次时,视角 select 列出所有座次,切换 = 改 `seat` 并把 `step` clamp 到该座次 `[0, total]`。
- 仅一个座次时不显示 select。

## 7. 文件清单

### 新增
| 文件 | 职责 |
|---|---|
| `src/client/replay/types.ts` | 录像格式类型 |
| `src/client/replay/recorder.ts` | `ReplayRecorder` 录制器 |
| `src/client/replay/replayFile.ts` | `saveReplay/loadReplay` I/O |
| `src/client/replay/replayEngine.ts` | 回放引擎纯函数 |
| `src/client/hooks/useReplayRecorder.ts` | 录制 hook(接入连接层) |
| `src/client/hooks/useReplay.ts` | 回放状态 hook |
| `src/client/components/ReplayControls.tsx` | 回放控制条 |
| `src/client/pages/ReplayPage.tsx` | 回放页(`/replay`) |

### 修改
| 文件 | 改动 |
|---|---|
| `src/client/App.tsx` | 加 `/replay` 路由 |
| `src/client/pages/HomePage.tsx` | 加"加载录像回放"入口 |
| `src/client/components/GameResultOverlay.tsx` | 加"下载录像"按钮 |
| `src/client/hooks/useDebugMultiConnection.ts` | 接入录制(各座次 newEvents) |
| `src/client/hooks/useMultiplayerRoom.ts` | 接入录制(单座次) |

### 复用(不改)
- `src/client/view/reducer.ts` `viewReducer`
- `src/client/components/GameView.tsx`

## 8. 测试

### 单元
- `tests/unit/replay-recorder.test.ts`: record 累积 events、initialView 首次捕获、finalize meta、reset。
- `tests/unit/replay-file.test.ts`: saveReplay/loadReplay round-trip、非法格式拒绝、version 校验。
- `tests/unit/replay-engine.test.ts`: getViewAt 第 N 步正确、next/prev/goTo 边界、多座次切换、从 initialView apply 与实时一致。

### 集成
- `tests/integration/`: debug 模式跑一局 → finalize → saveReplay → loadReplay → getViewAt(末步)与实时末 view 深相等。

### E2E
- 更新 `tests/e2e/game.spec.ts` 的"回放功能"组:加载录像进入回放模式、步进 X/Y、视角切换、播放/暂停、退出。对齐已定义契约。

## 9. 风险

| 风险 | 缓解 |
|---|---|
| `initialView` 含不可序列化字段(函数/Map) | 录制时 `JSON.parse(JSON.stringify())` 或 `structuredClone` 后断言无函数;`pending.atom` 是纯数据联合类型 |
| 某 atom 未实现 `applyView` → 回放 view 缺字段 | viewReducer 已处理(no-op);与实时行为一致(实时也丢)。可接受 |
| 自动播放性能 | setInterval 推进,每步重建 < 5ms;速度档控制间隔 |
| 多人模式只录单视角 | 设计已接受;UI 仅在该录像单座次时不显示视角切换 |
| 重连导致事件断层(seq 回退) | 录制只追加;重连前的 events 保留,重连后继续追加。回放从 initialView 连续 apply,断点处 view 可能短暂不一致(可接受,与 e2e debug 场景无关) |

## 10. 验收标准

1. debug 模式打完一局,游戏结束界面有"下载录像"按钮,点击下载 `.json`。
2. 首页"加载录像回放"选择该文件,进入回放模式。
3. 控制条:步数 `N/total`、上一步/下一步/播放/暂停/进度拖拽均工作。
4. 视角 select 切换座次,view 正确切换。
5. 回放末步 view 与实时游戏结束 view 一致(手牌/血量/装备)。
6. 单元 + e2e 测试通过。
