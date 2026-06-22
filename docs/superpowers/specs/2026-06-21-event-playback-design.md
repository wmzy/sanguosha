# 延时展示 + debug 真 viewer 隔离 设计

> 日期:2026-06-21(定稿)
> 目标:
> 1. 按 ENGINE-DESIGN §8.2 接通事件流传输,前端基于 ViewEvent[] + effect 播放延时动画
> 2. debug 模式改为真 viewer 隔离,消除 buildView(debug=true) 的全量暴露偏离
> 两个目标一起做(走法 A),不留技术债。

## 一、设计依据

### 1.1 ENGINE-DESIGN §8.2 已定但未接通

```
后端 atom → toViewEvents 生成 ViewEventSplit → pushEvent({seq, atom, viewEvents})
session: per-player 分叉 → 发 {type:'events', fromSeq, events: ViewEvent[]}
前端: viewReducer(view, event) → applyView 增量 + playEffect(effect)
```

现状断裂点:
- `session.broadcastNewState` 只发全量快照,从不发 events
- 前端无 viewReducer,靠 `useAnimationState` diff 快照猜动画
- 仅 4 个 atom 实现 applyView
- effect 字段前端完全未消费

### 1.2 debug 全量暴露是历史偏离

`buildView(debug=true)` 暴露所有人手牌+身份,客户端持单份 view,切视角靠 perspective 本地字段。注释(protocol.ts:4)声称"事件流取消,轮询 state.seq"——这是实现者放弃事件流的标记。

**用户决策:debug 改为真 viewer 隔离**。每个座次是独立 viewer,客户端持 `view[viewer]` 数组按 perspective 选一份。debug 不再是特例,与正式模式同一套 viewer 隔离逻辑。

## 二、架构

### 2.1 事件流传输(正式 + debug 统一)

```
后端 applyAtom
  → resolveViewEvents → ViewEventSplit
  → pushEvent({kind:'atom', seq: state.seq, atom, viewEvents})
  → notifyStateChange → broadcastNewState
broadcastNewState:
  allEvents = getEventsSince(lastBroadcastSeq)
  for each connected viewer (正式:1 个;debug:N 个座次):
    playerEvents = projectEventsForViewer(allEvents, viewer)  // 按可见性分叉
    send {type:'events', fromSeq: lastBroadcastSeq, events: playerEvents, viewer}
  lastBroadcastSeq = state.seq
  clearEvents()
```

`projectEventsForViewer` 规则:
- atom.viewEvents.ownerViews.get(viewer) 非 null → 用 ownerView(专属,如摸牌看牌面)
- ownerViews.get(viewer) === null → 跳过(隐藏)
- othersView 非 null → 用 othersView(通用)
- othersView === null 且未命中 ownerViews → 跳过

### 2.2 debug 客户端数据模型

客户端持 `views: Map<viewer, GameView>`,按 perspective 取 `views.get(perspective)`。
- 收到 `{type:'events', viewer, events}` → 对 `views.get(viewer)` 跑 viewReducer
- 首次/重连:服务端为每个座次发 `{type:'initialView', viewer, state}` 建立 baseline
- 正式模式:views 只有 1 项(viewer 固定)

### 2.3 延时展示(useEventPlayback + EventOverlay)

- 每收到一批 events,按 seq 入播放队列
- 逐个播放:duration = `event.effect?.duration ?? 400`,min 400ms
- 非阻塞 overlay(pointer-events: none)
- 过时事件(旧回合)跳过
- 退役 `useAnimationState`(events 通路验证后删除)

## 三、改动清单

### 3.1 后端

| 文件 | 改动 |
|---|---|
| `engine/types.ts` | `GameEvent` 加 `seq: number` |
| `engine/event-stream.ts` | 加 `getEventsSince(fromSeq)` |
| `engine/create-engine.ts` | `pushEvent`/`pushNotify` 传 `state.seq` |
| `engine/view/buildView.ts` | **删除 debug 全量暴露**:hand/identity 一律按 viewer 隔离;`allCharSelectSlots` 删除(debug 靠 per-viewer 的 pending) |
| `server/protocol.ts` | 删"事件流取消"错误注释;`GameEventEnvelope` 改携带 `viewEvent: ViewEvent`;events/initialView 消息加 `viewer: number` 字段 |
| `server/session.ts` | broadcastNewState 改发 events(per-player 分叉);保留 initialView 作首次/重连 baseline;去掉 debug 特例分支 |

### 3.2 前端

| 文件 | 改动 |
|---|---|
| `client/view/reducer.ts` | 新建:viewReducer 调 applyView |
| `client/hooks/useEventStream.ts` | 新建:接 events → viewReducer;持 views: Map<viewer, GameView> |
| `client/hooks/useEventPlayback.ts` | 新建:事件播放队列,暴露 current 给 overlay |
| `client/components/EventOverlay.tsx` | 新建:按 event.type 渲染非阻塞延时展示 |
| `client/hooks/useDebugLobbyController.ts` | 持 views Map;按 perspective 取;处理 events/initialView 多 viewer |
| `client/hooks/useDebugPerspective.ts` | 不变(已基于 perspective) |
| `client/hooks/useCharSelect.ts` | 删除 allCharSelectSlots 分支;debug 下代打靠切到目标 viewer 的 pending |
| `client/components/DebugInfo.tsx` | 不变(只用公开信息) |
| `client/hooks/useAnimationState.ts` | **删除**(events 接通后) |
| 各 atom 文件 | 补全延时范围内 applyView;调大 effect.duration |

### 3.3 applyView 补全清单(延时范围内)

需补:判定、阶段开始/结束、回合开始/结束、回复体力、失去体力、拼点、添加延时锦囊、移除延时锦囊、指定目标、成为目标、弃置、装备、卸下、获得、给予、设横置、加/去标记、加/去标签、添加/移除技能、回合相关。

已有:击杀、摸牌、移动牌、造成伤害。

### 3.4 effect duration 调整

| atom | 现值 | 新值 |
|---|---|---|
| 判定 | 600 | 1800 |
| 阶段开始 | 150 | 1000 |
| 阶段结束 | 150 | 600 |
| 回合开始 | 200 | 1500 |
| 回合结束 | 200 | 800 |
| 造成伤害 | 400 | 1000 |
| 回复体力 | 300 | 800 |
| 失去体力 | 300 | 800 |
| 击杀 | 1000 | 1500 |
| 摸牌 | 200 | 600 |
| 弃置 | 200 | 600 |
| 移动牌(打出) | 200 | 800 |
| 拼点 | 800 | 1500 |
| 指定/成为目标 | 200 | 400 |
| 添加延时锦囊 | - | 800 |

## 四、关键约束

1. **clearEvents 必须在所有 viewer project 后**(循环外)
2. **debug 代打选将**:真 viewer 隔离后,切到目标 viewer 即可看到其 pending(该 viewer 的 view 含自己的选将 slot),无需 allCharSelectSlots
3. **信息隔离正确性**:ownerViews=null 必须严格跳过,否则信息泄露
4. **events 与快照一致性**:重连拉 initialView 后,后续 events 从 lastSeq 续上

## 五、验证

- 后端单测:event-stream seq/getEventsSince、buildView viewer 隔离、projectEventsForViewer 可见性
- 前端单测:viewReducer、useEventPlayback 队列/seq 回退
- 集成:e2e 脚本验证 WS 消息含 events;debug 模式视角切换各 viewer 独立
- 视觉:摸牌/判定/伤害/阶段切换可见延时

## 六、实施顺序

1. 后端事件流(seq + getEventsSince + pushEvent 传 seq)
2. buildView 去 debug 全量暴露(真 viewer 隔离)
3. session broadcastNewState 改 events 分叉 + protocol 调整
4. 前端 view/reducer + useEventStream(views Map)
5. 前端 useEventPlayback + EventOverlay
6. 补全 applyView + 调 duration
7. 删 useAnimationState、清 allCharSelectSlots 相关
8. 测试 + 视觉验证
