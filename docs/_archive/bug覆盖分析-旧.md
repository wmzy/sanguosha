# Bug 覆盖分析：原有测试未捕获的问题

## 核心结论

原有测试套件（23 个文件、336 个测试）从未能捕获这 35 个 bug 的根本原因是：

**测试策略存在系统性漏斗：单元级测试验证了函数的注册和直接调用，但从未验证引擎内实际执行路径上事件是否被发出、技能是否被触发、以及边界条件是否被处理。**

---

## 具体原因

### 1. 技能测试通过 `emitEvent` 直接调用，绕过了引擎的实际执行路径

`skskills-exec.test.ts` 中所有技能测试都通过 `emitEvent(state, event)` **直接触发事件**，而不是通过引擎的实际操作流。

| 测试方式 | 实际游戏 | 测试做法 |
|---------|---------|---------|
| 触发 刚烈 | 出杀 → 命中 → `handleDamage` → `emitEvent(damageDealt)` | 直接 `emitEvent(damageReceived)` |
| 触发 闭月 | `handleEndTurn` → `emitEvent(turnEnd)` | 直接 `emitEvent(turnEnd)` |
| 触发 苦肉 | `phaseBegin` → `useSkill` → handler | 直接 `emitEvent(phaseBegin)` |

**后果**：如果引擎的某个路径没有 emit 事件（如 `resolveDiscardPhase` 缺少 `turnEnd`），技能测试仍然通过，因为它不依赖引擎发射事件——它自己构造事件。

**受影响的 bug**：Bug #29（刚烈）、#30（弃牌后 turnEnd 缺失）、#33（克己）、#34（苦肉）

### 2. 引擎测试只测基础操作，不测与技能系统的集成

`engine.test.ts` 的测试范围仅限于：
- 状态创建（初始状态、玩家属性、牌组）
- 基础操作（endTurn 切换玩家、错误处理）
- 序列化 round-trip

**从未测试**：
- `playCard` 后事件是否被发射
- 技能触发器是否在 `playCard` → `resolveKill` 链中被调用
- 弃牌阶段后的 `turnEnd` 事件

### 3. 序列化测试不验证有状态模块（atoms）

`serializer.test.ts` 验证 `serialize/deserialize` 能处理 GameState 的基本结构，但：
- 不测试 `atoms` 目录下的 handler 注册状态
- 不测试序列化后再恢复执行会不会丢失 handler 映射
- `atomToEvents` 这种副作用函数完全未测试

**受影响的 bug**：Bug #31（draw atom 的 toEvents 使用原始 state）

### 4. 延时锦囊的测试完全缺失

`cards.test.ts` 和 `validation.test.ts` 覆盖了：
- 基本牌的出牌/响应
- 非延时锦囊（无中生有、顺手牵羊、过河拆桥）
- 装备牌的使用和替换

但 **没有任何测试覆盖** 延时锦囊（乐不思蜀、兵粮寸断、闪电）：
- 它们的距离检查规则
- 目标选择验证
- 判定区放置逻辑
- 判定阶段的触发流程

**受影响的 bug**：Bug #32（三个延时锦囊全部未实现）

### 5. 现有测试缺少边界条件和异常路径

| 未覆盖的边界 | 涉及 bug |
|-------------|---------|
| 手牌数 > 体力上限时的 endTurn → 弃牌阶段 → 下一玩家 | Bug #29（刚烈）、#30（弃牌 turnEnd） |
| 4 人局的距离计算 | Bug #32（乐不思蜀距离检查） |
| 牌堆抽空后的 reshuffle | Bug #31（draw atom 事件） |
| 体力为 1 时使用苦肉 | Bug #34 |
| 死亡玩家的手牌处理 | Bug #28（skipDiscardForDeadPlayers） |

### 6. 技能 handler 的完整性检查不存在

`skills.test.ts` 验证了 **少数几个技能** 能注册触发器。但：
- 25 个角色各有 1-2 个技能，共约 35+ 个技能
- 只有 9 个技能有注册测试
- 只有 5 个技能有执行效果测试
- **没有任何测试检查技能 handler 是否为 stub/TODO**

直接检查技能定义文件就能发现大量 `handler: () => []（TODO）` 的实现，但测试从未验证。

**受影响的 bug**：Bug #35（超过 20 个技能为 stub）

---

## 改进建议

1. **增加集成测试**：至少一个从 `createTestGame` → `endTurn` → 完整回合的端到端测试，验证事件和技能确实被触发
2. **技能完整性测试**：遍历所有角色的所有技能，验证 handler 不是空实现
3. **事件审计测试**：在每个引擎 handler 执行后，检查预期的事件是否被发射
4. **边界条件覆盖**：补全手牌上限、神装、濒死、死亡等状态切换的测试
5. **延时锦囊全流程测试**：从使用到判定区放置到判定阶段触发
