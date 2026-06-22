# 事件流传输链路根治设计

> 日期:2026-06-22
> 状态:待评审
> 关联:`2026-06-21-event-playback-design.md`(事件流初版,本设计修正其落地缺陷)

## 一、问题陈述

`src/engine/event-stream.ts` 的模块级单例 `events: GameEvent[]` 是事件流传输链路的根因,引发四个 P0/P1 缺陷:

### P0-A:跨 session 事件污染 + 信息泄露

- `event-stream.ts:6` 模块级 `events[]`,`app.ts:37` 同进程多 session 共存
- 房间 A 的 `broadcastNewState` 读到 A+B 混合事件,投影后发给 A 的玩家;A 的 `clearEvents()` 清掉 B 未广播的事件
- 后果:跨房间信息泄露 + 事件丢失
- `0027-create-engine-top-level-functions.md:123` 的前提"进程内一次只跑一局游戏"在多 session 架构下不成立

### P0-B:缓冲即时清空 → 断线重连完全失效

- `session.ts:273` `broadcastNewState` 后立即 `clearEvents()`
- `getEventsSince(fromSeq)`(`event-stream.ts:20`)是死代码——在空数组上 filter 永远返回 `[]`
- `reconnectPlayer`(`session.ts:333`)只发 initialView 快照,从不补推差量
- 设计意图(`2026-06-21-event-playback-design.md:41-46`)与实现不符

### P0-C:全局 CAS 在无锈窗口误拒合法 respond

- `state.seq` 在每次合法 dispatch `+= 1`(`create-engine.ts:311`),包括 respond
- 无锈广播窗口内:B 响应推进 seq,C 基于 seq=旧值 的合法 respond 被 `session.ts:179` 误拒
- 注:跨玩家主动 action 的并发误拒**不存在**——三国杀严格回合制,validate 拒绝非当前回合玩家的主动 action。全局 CAS 的唯一误拒场景就在无锈窗口,而这正是 pending-scoped 版本(§5.6)要精确替代的

**全局 CAS 还在破坏无锈可击链**:无锈广播 slot key=-2 不匹配 `ownerId`,故 `hasOwnSlot=false` → CAS 强制执行 → B 响应后 seq+1 → C 的反无锈(旧 seq)被误拒。

### P1-A:pending 倒计时客户端硬编码 30s,与服务端脱钩

- `请求回应.ts:6` `DEFAULT_TIMEOUT_MS = 30_000`
- `applyView` 恒用此值(`请求回应.ts:60`),忽略 atom 携带的自定义 `timeout`
- 服务端 `createAndAwaitSlot`(`create-engine.ts:619`)用 `(atom.timeout ?? def.pending.timeout ?? 30) * 1000`
- 前端进度条与实际超时偏差,`session-turn-deadline.test.ts` 只修了 turnDeadline,pending 同类问题未修

### P1-B:`notifyStateChange` 同步触发,广播发生在 state 半变更态

- `applyAtom` 内部同步调 `notifyStateChange`(`create-engine.ts:473`)
- 此时 atomStack 未 pop、pending slot 未创建;`createAndAwaitSlot` 又触发一次广播(空 buffer,白跑)

---

## 二、设计依据

### 关键事实:`toViewEvents` 依赖 apply 前的 state

以下 atom 在 `toViewEvents(state, atom)` 中读 **pre-mutation state**:

| atom | 读取的 pre-mutation state |
|---|---|
| `摸牌` | `state.zones.deck` + `rngSeed`(经 `planDraw` 计算将摸的牌) |
| `重洗` | `state.zones.deck.length + discardPile.length` |
| `卸下` | `state.players[player].equipment[slot]`(被卸装备的 cardId) |
| `移动牌` | `state.cardMap[cardId]`(牌面信息) |
| `移除延时锦囊` | `state.players[player].pendingTricks`(被移除的 trick) |

`create-engine.ts:467` 在 `applyAtomImpl` 之前调 `resolveViewEvents`,这是有意设计。因此**派生型架构必须在 apply 时机缓存 ViewEventSplit,不能事后从 atom 重算**。

---

## 三、架构决策(fork 已确认)

| 决策点 | 结论 | 理由 |
|---|---|---|
| 事件缓冲归属 | `GameState.atomHistory` | 引擎自洽,多 session 天然隔离 |
| 派生时机 | apply 时缓存 split | `toViewEvents` 依赖 pre-mutation state |
| 重连 | 全量保留历史 + seq 差量推 | 每局几百 atom,<1MB,内存可忽略 |
| CAS | **删除全局 CAS** | 三国杀严格回合制,跨玩家合法主动 action 的并发不存在(validate 已拒非法)。全局 CAS 的唯一作用在无锈广播窗口——但这正是 pending-scoped 版本要精确替代的,且全局 CAS 会误拒'窗口未变但 seq 被 respond 推进'的合法 respond,与 pending-scoped 冲突,必须删 |
| pending 窗口版本 | **新增**:respond 携带 `pendingSeq`(响应哪个窗口);服务端按 slot 创建 seq 校验 | 精确解决无锈意图问题(C 的在途 respond 不 counter B),只拒绝过期窗口的 respond,不影响主动 action |
| dispatch 返回值 | `Promise<boolean>` | 替代静默丢弃,session 回 ACK/NAK |
| pending 倒计时 | events 消息携带 deadline | 对齐已验证的 turnDeadline 模式 |
| 无锈 in-flight 重解读 | **修复**:pending-scoped 版本控制 | 用户明确要求对齐官方三国杀OL 行为(C 的在途 respond 应被拒并重新询问) |

---

## 四、核心数据模型

### 4.1 `atomHistory` 替代事件缓冲

**删除** `src/engine/event-stream.ts` 整个文件。

`GameState` 新增:

```ts
interface GameState {
  // ...既有字段
  atomHistory: AppliedAtomEntry[];   // 引擎唯一权威事件源
}

type AppliedAtomEntry =
  | { kind: 'atom'; seq: number; atom: Atom; viewEvents: ViewEventSplit }
  | { kind: 'notify'; seq: number; skillId: string; eventType: string;
      data: Json; views?: ReadonlyMap<string, Json> };
```

- `applyAtom`(`create-engine.ts:472`)的 `pushEvent(...)` 改为 `state.atomHistory.push(entry)`
- `pushNotify`(`create-engine.ts:420`)同理
- `notifyPendingResolved`(`create-engine.ts:101`)改为推入 `atomHistory`
- `createGameState` 初始化 `atomHistory: []`

### 4.2 派生视图(纯函数)

```ts
/** 从 atomHistory 派生某 viewer 可见的事件序列(供广播/重连) */
function eventsForViewer(
  state: GameState,
  viewer: number,
  sinceSeq = 0,
): GameEventEnvelope[]
```

- 投影规则(`projectEventsForViewer`)逻辑不变,数据源从 `getEvents(index)` 换成 `state.atomHistory.filter(e => e.seq > sinceSeq)`
- 放在 session 层或 engine/view/ 下(实现时定)

### 4.3 `resetForTest`

`resetForTest`(`create-engine.ts:372`)删除 `clearEvents()` 调用。`atomHistory` 随 state 生命周期——新 `create()` 自然为空,测试间无串扰。

---

## 五、传输协议层

### 5.1 广播(`broadcastNewState` 重写)

```js
private broadcastNewState(): void {
  const state = this.state;
  for (const [playerId, viewer] of this.playerNames) {
    if (viewer < 0 || viewer >= state.players.length) continue;
    if (!this.baselineSent.has(playerId)) {
      const view = buildView(state, viewer);
      this.sendToPlayer(playerId, { type: 'initialView', viewer, state: view, lastSeq: state.seq });
      this.baselineSent.add(playerId);
    }
    const envelopes = eventsForViewer(state, viewer, this.lastBroadcastSeq);
    if (envelopes.length > 0) {
      this.sendToPlayer(playerId, {
        type: 'events', viewer,
        fromSeq: this.lastBroadcastSeq,
        events: envelopes,
        pending: this.pendingForViewer(state, viewer),       // §5.3
        turnDeadline: this.turnDeadlineForViewer(state, viewer),
        turnTotalMs: this.turnTotalMsForViewer(state, viewer),
      });
    }
  }
  this.lastBroadcastSeq = state.seq;
  // 不再 clearEvents —— atomHistory 永久保留
}
```

- `lastEventIndex`(数组下标)→ `lastBroadcastSeq`(真正的 seq)
- 不再 `clearEvents()`,只前移 `lastBroadcastSeq`

### 5.2 重连差量推送

```js
reconnectPlayer(playerId, ws, lastSeq = 0): boolean {
  // ...既有重连逻辑
  this.sendInitialViewToPlayer(playerId);   // baseline 快照
  this.baselineSent.add(playerId);
  // 补推差量(当前缺失)
  const viewer = this.playerNames.get(playerId);
  if (viewer !== undefined) {
    const diff = eventsForViewer(this.state, viewer, lastSeq);
    if (diff.length > 0) {
      this.sendToPlayer(playerId, {
        type: 'events', viewer, fromSeq: lastSeq, events: diff,
        pending: this.pendingForViewer(this.state, viewer),
      });
    }
  }
  this.lastBroadcastSeq = Math.max(this.lastBroadcastSeq, lastSeq);
  return true;
}
```

### 5.3 CAS 删除 + dispatch ACK

`session.ts:120-128` 的 CAS 块**整段删除**。

```ts
// create-engine.ts
export async function dispatch(state: GameState, message: ClientMessage): Promise<boolean>
```

- `true`:通过 validate + 找到 entry(主动)/ 找到 slot(respond)
- `false`:validate 失败 / 无 entry / 无 slot

session 层:

```js
const accepted = await dispatch(this.state, action);
if (!accepted) {
  this.sendToPlayer(playerId, { type: 'actionRejected' });
}
```

`ClientMessage.baseSeq` 字段保留(向后兼容),不再校验。

### 5.4 pending 倒计时权威下发

```ts
// protocol.ts — 'events' 消息扩展
| { type: 'events'; viewer: number; fromSeq: EventSeq; events: GameEventEnvelope[];
    pending?: { target: number; deadline: number; totalMs: number } | null;
    turnDeadline?: number | null; turnTotalMs?: number }
```

session 从 `state.pendingSlots` 读取该 viewer 可见 slot 的 `deadline/totalMs`。

atom 的 `applyView` 不再设置 deadline:
- `请求回应.ts` / `并行回应.ts` 删除 `DEFAULT_TIMEOUT_MS` 常量
- applyView 只设 `view.pending = { type:'awaits', atom, prompt, target }`,deadline/totalMs 由 events 消息下发后由客户端填入

### 5.6 pending 窗口版本控制(根治无锈意图问题)

**问题**:A 打锦囊 → 开无锈窗口 W1。B、C 同时想无锈 A 的锦囊。B 先到服务端 → 应关闭 W1、开新窗口 W2(反无锈)。C 的在途 respond 意图是 W1(响应 A),不应被错误解释为 counter B(响应 W2)。官方三国杀OL 行为:C 的过期 respond 被拒,C 看到新窗口重新决定。

**错误机制**:当前 `无锈可击.ts:88` 用 `slot.resume()` 保持同一 slot 开着,C 的 respond 自动打到同一 slot → 被解释为 counter B。这是 bug。

**解法:pending-scoped 版本**(不是全局 CAS):

1. **PendingSlot 加 `createdSeq` 字段**:创建时赋 `state.seq`
2. **respond action 携带 `pendingSeq`**:客户端发 respond 时带当前 view.pending 对应的 seq(即客户端看到的询问窗口)
3. **服务端校验**:respond 路径里检查 `slot.createdSeq === action.pendingSeq`
   - 匹配 → accept,正常结算
   - 不匹配(slot 已被新窗口替换)→ **拒绝** + `actionRejected`
4. **无锈 close-reopen**:respond execute 不再调 `slot.resume()` 复用旧 slot;改为 `slot.resolve()` 关闭旧窗口 + 创建新 PendingSlot(新 createdSeq)

```ts
// PendingSlot 扩展
interface PendingSlot {
  // ...既有字段
  createdSeq: number;   // 创建时的 state.seq,作为窗口版本号
}

// dispatch respond 路径(只影响 respond,不碰主动 action)
if (oldSlot && action.pendingSeq !== undefined && oldSlot.createdSeq !== action.pendingSeq) {
  return false;   // 拒绝过期窗口的 respond
}
```

**与全局 CAS 的本质区别**:

| | 全局 CAS | pending-scoped 版本 |
|---|---|---|
| 校验对象 | 所有 action | 只校验 respond |
| 版本来源 | `state.seq`(全局,所有操作推进) | `slot.createdSeq`(局部,只随该 pending 窗口变化) |
| 主动 action | 被误拒 | **不受影响** |
| respond 过期窗口 | 误拒或误接受(看 seq 时机) | **精确拒绝** |

**客户端侧**:view.pending 被设置时记下 seq(来自 events 消息的 fromSeq 或 envelope seq);发 respond 时带上。pending 为空时不带 pendingSeq。

**无锈技能改动**(`无锈可击.ts` execute):`slot.resume()` 调用改为触发 close-reopen——旧 slot resolve、父 execute 创建新 请求回应 atom 带新窗口。具体实现细节实施时定,本 spec 约定语义:respond 后必关旧窗口、开新窗口。

### 5.7 广播合并

**engine 层**(`resolveViewEvents` 调用顺序)不变——仍在 `applyAtomImpl` 之前调,保证读 pre-mutation state(见约束 2)。

**session 层**(`onStateChange` 回调)做合并:一次 dispatch 产生的 N 个 atomHistory 条目,合并为**一次 `eventsForViewer` 推送全部**。当前实现是每个 `applyAtom` 末尾同步触发一次独立广播(含 clearEvents),改为在 dispatch 边界统一 flush。

实现方式:session 在 `handleAction` 调 dispatch 前置 `dispatching=true`,dispatch 的 `.then/.finally` 里复位并 flush;或更简单——直接在 dispatch 返回后调用一次 `broadcastNewState`(此时 atomHistory 已含全部新条目)。实施时选后者(更简单,无标志位)。

---

## 六、改动清单

### engine

| 文件 | 改动 |
|---|---|
| `event-stream.ts` | **删除整个文件** |
| `create-engine.ts` | `pushEvent`→`state.atomHistory.push`;`notifyPendingResolved` 推 atomHistory;`dispatch` 返回 `Promise<boolean>` + respond 路径 pending-scoped 版本校验;`createAndAwaitSlot` 设 `createdSeq`;`resetForTest` 删 `clearEvents`;`notifyStateChange` 合并语义 |
| `types.ts` | `GameState` 加 `atomHistory`;定义 `AppliedAtomEntry` 判别联合;`PendingSlot` 加 `createdSeq`;`ClientMessage` 加可选 `pendingSeq`;`GameEvent` 类型对齐或删除(由 AppliedAtomEntry 替代) |
| `atoms/请求回应.ts` | 删 `DEFAULT_TIMEOUT_MS`;applyView 不设 deadline |
| `atoms/并行回应.ts` | 同上 |
| `skills/无锈可击.ts` | execute 的 `slot.resume()` 改为 close-reopen(旧 slot resolve + 新 slot 带新 createdSeq) |

### server

| 文件 | 改动 |
|---|---|
| `session.ts` | 删全局 CAS 块;respond 路径保留 pending-scoped 校验(转发给 dispatch);`broadcastNewState` 用 `lastBroadcastSeq`+`eventsForViewer`;`reconnectPlayer` 补差量;events 消息携带 pending/turnDeadline;dispatch ACK;`lastEventIndex`→`lastBroadcastSeq`;`pendingForViewer` helper |
| `protocol.ts` | `events` 加 `pending`/`turnDeadline`/`turnTotalMs`;加 `actionRejected` 消息类型;`ClientMessage` 的 action 加可选 `pendingSeq` |

### client

| 文件 | 改动 |
|---|---|
| `useDebugMultiConnection.ts` | 处理 `actionRejected`;events 消息读 `pending`/`turnDeadline` 填 view;发 respond 时携带 `pendingSeq`(当前 view.pending 对应的 seq) |
| `useWebSocket.ts`(正式模式路径) | 同上 |

### test

| 文件 | 改动 |
|---|---|
| `tests/server/session-turn-deadline.test.ts` | 适配新协议(pending 改由 events 消息下发) |
| `tests/engine-harness.ts` | `getEvents`→读 `state.atomHistory`;`lastEventIndex`→seq |
| **新增** `tests/server/event-stream.test.ts` | 多 session 隔离;重连差量;全局 CAS 删除后合法 action 不被拒;dispatch ACK |
| **新增** `tests/engine/pending-version.test.ts` | pending-scoped 版本:过期窗口 respond 被拒;新窗口 respond 被接受;主动 action 不受 pendingSeq 影响;无锈 close-reopen 后 C 的在途 respond 被拒 |

### 不动的

- `atom.toViewEvents` / `resolveViewEvents` 逻辑(数据源换,投影规则不变)
- `pendingSlots` 机制 + slot 路由逻辑
- skill 系统 / hook 机制
- `buildView` viewer 隔离规则

---

## 七、关键约束

1. **atomHistory 是唯一权威源**:不再有独立的事件缓冲。广播、重连、测试断言都从 atomHistory 派生
2. **apply 时缓存 split**:`toViewEvents` 读 pre-mutation state,必须在 `applyAtomImpl` 之前调 `resolveViewEvents` 并写入 atomHistory(现有顺序保持)
3. **atomHistory 不清空**:内存代价可忽略(每局 <1MB),换取重连差量推送的正确性
4. **dispatch 返回值必须传递到 session 层**:静默丢弃改为显式 ACK/NAK
5. **CAS 删除后路由保证**:respond 靠 `ownerId + pendingSlots` 结构匹配(`create-engine.ts:285-291` 已有);主动 action 靠 `validate`;竞态靠 `oldSlot.isTimeout`(`create-engine.ts:296`)

---

## 八、验证

### 单测

- **engine**:`atomHistory` apply 时写入、seq 单调、split 是 pre-mutation 快照
- **server**:多 session 隔离(两 session 并发 applyAtom,事件不串);重连差量(initialView + events 续推);dispatch ACK(合法 action true / 非法 false);CAS 删除后 seq 滞后的 action 仍被接受
- **client**:events 消息 pending/turnDeadline 正确填入 view;actionRejected 处理

### 集成

- e2e:WS 消息含 events;两 viewer 独立分叉;重连后状态一致
- debug 模式:视角切换各 viewer 独立,pending 各 viewer 正确

### 回归

- `session-turn-deadline.test.ts` 适配后通过
- 既有 skill 测试全绿(harness 适配 atomHistory 后)

---

## 九、实施顺序

1. **engine 核心**:`atomHistory` 数据模型 + `pushEvent` 改写 + `event-stream.ts` 删除 + `resetForTest`
2. **dispatch 返回 boolean** + 引擎层调用点适配
3. **pending-scoped 版本**:`PendingSlot.createdSeq` + `ClientMessage.pendingSeq` + dispatch respond 路径校验
4. **无锈 close-reopen**:`无锈可击.ts` execute 改 resolve+重建,删 `slot.resume()` 复用
5. **session**:`broadcastNewState` 重写(`lastBroadcastSeq` + `eventsForViewer`)+ 全局 CAS 删除 + dispatch ACK
6. **session 重连**:`reconnectPlayer` 差量推送
7. **protocol**:`events` 消息扩展(pending/turnDeadline)+ `actionRejected`
8. **pending 倒计时**:atom applyView 删硬编码 + session 下发 + 客户端读取
9. **客户端**:`useDebugMultiConnection` / `useWebSocket` 适配(含 respond 携带 pendingSeq)
10. **测试**:新增(event-stream / pending-version)+ 适配既有;全绿

---

## 十、未纳入(后续独立修复)

- **dispatch 并发 mutation 竞态**:极端并发下两个 execute 读同一 `localVars` 再翻转,净效果可能为零。需要 dispatch 序列化(互斥锁),独立问题。pending-scoped 版本控制解决了无锈意图问题(C 的在途 respond 被拒),但两个 respond 在同一 tick 进入 execute 的竞态仍需 future 的 dispatch 序列化。
- **`events` 消息的 `operations` 字段**:`protocol.ts:32` 死字段,本次不清理。
