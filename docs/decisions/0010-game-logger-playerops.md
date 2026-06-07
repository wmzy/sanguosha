# ADR 0010 - GameLogger + playerOps 视角隔离

**状态**: 已接受

**前置依赖**: ADR 0009（baseSeq CAS 版本控制）

**背景**: ADR 0009 第 5 点提出"前端不再乐观更新任何状态，actionLog 完全由服务端 events 派生"。但 `actionLog` 的实际生成仍在前端本地完成（`actionLogEntriesToOperations`），存在前后端不一致风险。同时调试模式需要完整日志视角、多人模式需要视角隔离，缺乏统一的日志产生和分发机制。`ReplayEngine` 需要从完整日志重建状态，需要可序列化的 GameLog 格式。

**决策**:

1. **GameLogger 工作在 ServerEvent 层而非 playerEvents 层**。`emitEvent()` 返回的 `EngineResult` 不含 `playerEvents`（仅 `dispatchAction` 路径通过 `broadcast()` 产生 `playerEvents`），导致 `engineResult.playerEvents` 不完整。替代方案——修改所有 engine handler 传播 `playerEvents`——侵入性过大。从 `ServerEvent.payload` 提取足够信息做视角裁剪更简单可靠。**延伸**：turnStart 等生命周期事件在 Phase 8（ADR 0011）已封装为 atom 进 serverLog。

2. **operations 附在 events 消息中，不单独建消息类型**。operations 与 events 同批产生、生命周期绑定。单独 operations 消息类型增加客户端处理复杂度和时序问题。events 消息的 `operations` 字段为可选，保持向后兼容。

3. **debug 模式发 serverOps，多人模式发 playerOps[myName]**。debug 用户是上帝视角需要完整信息；多人模式需视角隔离。debug 模式切换视角时 operations 不变（始终为 serverOps）。

4. **GameLog 文件包含 serverLog 用于 ReplayEngine 状态重建**。复用 `reduceGameState` 从原始 ServerEvent 序列逐步重建状态，避免重新实现 `applyOperation`。替代方案——从 serverOps 重建——需要实现 Operation→state 转换逻辑，与引擎逻辑重复。

5. **保留 src/engine/view/actionLog.ts 不删除**。纯函数无副作用，现有单元测试保持通过，作为 GameAction→Operation 的参考实现保留。

6. **description 中文手写模板**。13 种 OperationType + 4 种 GameAction 级别共约 17 个描述模板，总计 ~80 行 switch-case，集中在一个文件，可维护。替代方案 i18n 框架——过重，无多语言需求。

7. **视角裁剪规则：draw 事件按 playerName == drawer 区分**。drawer 的 playerOp 包含 cards 详情（牌名、花色、点数），其他玩家的 playerOp 只含 `{ player, count }`。其余事件类型（damage、heal、equip、discard 等）为公开信息，全员可见相同内容。

**后果**:
- **正面**:
  - 统一日志产生源头，消除前后端 actionLog 不一致风险。
  - events 消息附加 operations 是向后兼容的（可选字段）。
  - ReplayEngine 可从 GameLog 文件完整重建状态。
  - 视角隔离在日志层实现，不依赖 engine handler 修改。
- **负面**:
  - ServerEvent payload 提取信息依赖事件格式稳定性——事件格式变更需同步更新 logger。
  - GameLog 文件包含 serverLog 会增大文件体积（相比仅存 serverOps）。
  - `actionLog.ts` 保留但不再被主流程调用，有死代码嫌疑。

**参考**: `src/src/engine/logger.ts` (GameLogger)、`src/src/engine/replay.ts` (ReplayEngine)、`src/src/shared/log.ts` (GameLog 类型)、`src/src/server/protocol.ts` (events 消息 operations 字段)、`src/src/server/session.ts` (broadcastEvents 分发 playerOps)。
