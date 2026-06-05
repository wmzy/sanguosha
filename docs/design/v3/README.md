# v3 重构索引

> 三份文档，**仅设计，未修改任何代码**。

## 文档列表

| 文档 | 内容 | 何时读 |
|---|---|---|
| [0000-gap-archive.md](./0000-gap-archive.md) | v2 所有已知缺口（原子 / SkillPhase / 触发器 / 技能 / 卡牌 / 状态 / Prompt / 序列化）| 想看"为什么改"时 |
| [0001-v3-redesign.md](./0001-v3-redesign.md) | v3 设计原则 + 操作分类与统一抽象（Mark / Transaction / Pindian / Judge / CardDef / Damage / Expr）| 想看"改成什么"时 |
| [0002-todo-decisions.md](./0002-todo-decisions.md) | 24 个待决策项 T-01 ~ T-24，明天逐条过 | 明天讨论时 |

## 核心决策一览（先看这 10 条）

1. **三层原子性模型**：状态原子 ∧ 事件原子 ∧ 时序原子
2. **四象限操作分类**：同步/异步 × 单点/多点
3. **Mark 统一抽象**：翻面 / 铁索 / 创牌 / 化身 / 护甲 都走 `Mark<T>`，区别在 `scope` 和 `duration`
4. **Transaction 抽象**：swapHands / 天香 / 借刀 / 激将 / 反间 都走 `TransactionDef`，保证"中间状态不可见"
5. **Pindian SkillPhase**：5 个拼点技能统一驱动
6. **Judge 重做**：判定牌在 reveal 前是隐藏的、可被 hook 拦截 / 替换 / 重排
7. **CardDef 单一真源**：v2 三处真源（CardDef / card-handlers / response-handlers）合并到 CardDef.effect 树
8. **Damage 类型化**：`normal` / `fire` / `thunder`，`loseHealth` 是独立操作不混用
9. **多接收者视图**：观星暗看 / 火攻展示 / 反间展示 用 `ViewSpec` 替代 v2 ownerMap 单 key
10. **删 v2 双源**：CharacterConfig.abilities 只剩元信息，效果全在 skill registry

## 明日讨论议程

**4 轮，每轮 1 小时，**按 0002-todo-decisions.md 的 TODO 编号顺序：

| 轮次 | 主题 | TODO 编号 | 决策点 |
|---|---|---|---|
| 第 1 轮 | 原子性原则 | T-01 ~ T-06 | 冻结 / 回滚 / 揭示 / 差值 / 读点 / 不能成为目标 |
| 第 2 轮 | Mark / Transaction / Pindian | T-07 ~ T-13 | 翻面持续 / 创牌 / 化身 / 判定统一 / Damage 类型 / 仁德 / 借刀 |
| 第 3 轮 | 状态模型 / Expr / 触发器 | T-14 ~ T-20 | RNG / 时间 / priority / timeout / 视图 / vars 迁移 / 双源 |
| 第 4 轮 | 兼容与迁移 | T-21 ~ T-24 | 共存 / 删除触发 / 性能 / 测试覆盖 |

**准备工作**：每人（不只我）**先读 0001 第二章**（操作分类与统一抽象），这章是 v3 骨架。其他两章按需查。

## 决策落档规则

明天每条 TODO 决策后，**立即更新 0001 对应章节**或**追加 0003-decision-log.md** 记录结论与理由。**不在脑内记**。

## 修改了什么

**只新增了 4 个 markdown 文件**：
- `docs/design/v3/README.md`（本文件）
- `docs/design/v3/0000-gap-archive.md`
- `docs/design/v3/0001-v3-redesign.md`
- `docs/design/v3/0002-todo-decisions.md`

**未修改任何代码 / 配置 / 测试**。
