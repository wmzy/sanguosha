# ADR 0009 - 用 baseSeq 做客户端操作的 CAS 版本控制

**状态**: 已接受

**背景**: 三国杀是回合制多人卡牌游戏，多个玩家可能在同一响应窗口并发响应（如无懈可击链）。客户端发操作时，它看到的是某个 serverLog 快照；如果在请求到达服务端之前，服务端已因别的玩家操作而推进，那么"基于旧快照的决策"在新状态下可能不再合法（不是不行，而是语义错位）。当前实现依赖引擎 `validateAction` 兜底，但这是"碰巧能拦住"而非设计保证，错误信息也无法区分"操作本身非法"与"状态已过期"。

**决策**:

1. `ClientMessage.action` 增加 `baseSeq: EventSeq` 必填字段。
2. `ClientMessage.response` 改为 `{ baseSeq: EventSeq; choice: unknown }`，删除 `promptId`（baseSeq 取代它的版本控制角色）。
3. 服务端 `session.handleAction(playerId, action, baseSeq)` 在分发引擎前做 CAS 校验：`baseSeq !== this.nextSeq` 则**静默丢弃**，不发 error 消息。前端会通过后续 `events` 推送自动看到最新状态，旧操作自然"消失"。
4. 前端发操作时使用 `lastAppliedSeqRef.current` 作为 baseSeq；不维护独立的"上次发的 baseSeq"，因为 lastAppliedSeq 本身就是已应用最新事件的标识。
5. 前端**不再乐观更新任何状态**。actionLog（右侧操作流水）改为完全由服务端 `events` 派生，不在本地追加。这消除了"乐观回退"的复杂路径——所有可见状态都是服务端权威事件的投影。
6. UI 操作后的 `setSelectedCardId(null)` 等本地清理动作保留，但接受几百毫秒的"诚实延迟"（等服务端 events 回来后 UI 自动更新）。如有体验问题，后续单独优化。

**为什么不发 error**:
- CAS 失败的本质是"状态已推进，旧操作无意义"，不是错误。前端不需要弹错提示。
- 状态刷新由后续 `events` 推送完成，前端自然会看到新状态，旧操作自然"消失"，体验上等于"点了但没反应"——这正是正确行为。
- 减少协议层 noise：error 通道只保留"真正的协议/引擎错误"。

**为什么 baseSeq 可以取代 promptId**:
- `promptId` 只能识别"pending 是不是同一个"，不能识别"在我看到这个 pending 之后有没有别人动过"。
- `baseSeq` 是 serverLog 末尾的 seq。pending 推进（换 responder、关闭）都会产生新 serverLog 事件，seq 变化。`baseSeq !== currentSeq` 隐含了"全局状态已经移动过"，自然覆盖了 promptId 的语义。
- 实际仍然有两道关：CAS 是第一道，`validateAction` 是第二道。CAS 通过后 `validateAction` 仍会拦截"操作本身非法"（如不是当前 responder）。

**后果**:
- **正面**:
  - 协议层有明确的版本控制语义，前后端对"操作基于哪个状态"有共同理解。
  - 静默丢弃让前端逻辑更简单——不需要写"收到 error 时的回退路径"。
  - 不乐观更新消除了 actionLog 与服务端事件的同步问题。
  - 删除 promptId 减少协议字段。
- **负面**:
  - 前端操作到 UI 更新有数百毫秒延迟（要等服务端 events 回来），可能影响操作流畅感。需要的话后续加 UI 层的 "in-flight" 视觉反馈。
  - 断线重连期间（前端 lastAppliedSeq 还在旧值时）所有操作都会被服务端静默丢弃。连接恢复后会话重放会自动解决。
**后续实现**: ADR 0010 解决了本 ADR 第 5 点提到的"actionLog 完全由服务端 events 派生"——通过在 events 消息中附加 `operations` 字段实现。客户端不再本地追加 actionLog，改为接收服务端生成的 operations。ADR 0011 进一步修复 turnStart 事件不进 serverLog 的设计漏洞——封装为 atom 后，ReplayEngine 重建状态完整。

**参考**: `server/protocol.ts` (ClientMessage/ServerMessage)、`server/session.ts:handleAction` (CAS 校验)、`src/hooks/useDebugLobbyController.ts:sendGameAction` (携带 baseSeq)、`engine/atoms/pending.ts` (pending 创建/推进产生新事件 → seq 推进)。
