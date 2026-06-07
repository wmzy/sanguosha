# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-06-07
### Engine v3 ATOM_GAME_EVENTS 自动派发 — emitEvent 调用点从 11 处降至 4 处

将 `ATOM_GAME_EVENTS` 自动 emitEvent 管道集成到 `applyAtoms` 主入口，消除手工 `emitEvent` 调用。

### Added

- `engine/atom-game-events.ts` — 扩展映射：新增 `阶段开始`/`阶段结束`/`回合开始` 三种 atom→event 映射
- `engine/atom.ts` — `applyAtoms` 在 onAfter 钩子之后自动检查 `ATOM_GAME_EVENTS`，匹配时调 `emitEvent`；新增 `aborted` 标志位处理 pending 中断
- `engine/phases/atoms.ts` — 新增 `hadPending` 检查，避免在已有 pending 的技能执行中误中断

### Removed

- `engine/phase-advance.ts` — 删除 `processPhaseStep` 中 phaseBegin/phaseEnd 和 `advanceToInteractivePhase` 中 turnStart 的手工 `emitEvent` 调用（3 处）
- `engine/handlers/engine-utils.ts` — 删除 `applyDamage` 中手工 `emitEvent(受到伤害)` 调用（1 处）
- `engine/phases/atoms.ts` — 删除 ATOM_GAME_EVENTS 手工调用代码块（3 处）


### Engine v3 阶段 D 准备 — 58 个 v2 stub 技能去 trigger + hasWushuang 改 v3 真相源

为阶段 D（删 v2 基础设施：`state.triggers` / `emitEvent` / `registerSkill` / 全局 registry）做前置安全清理——所有空 handler 的占位 stub 技能去 v2 trigger 字段。

### Changed

* `engine/handlers/card-handlers.ts` — `handleKillCard` 中 `hasWushuang` 判定从 `state.triggers.some(...)` 改用 `hasSkill(state, player, '无双')`（[P5-T2] v3 真相源：`PlayerState.skills`）
* `tests/scenarios/蜀/卧龙诸葛.test.ts` — 火计/看破 注册检查从 `state.triggers` 断言改 `ctx.player('P1').skills`（v3 真相源）
* `tests/scenarios/蜀/庞统.test.ts` — 连环 注册检查同上

### Removed

* 58 个 v2 stub 技能（handler 是空 `[]`，v2 派发本就无效）删 `trigger` 字段：
  * 5 个孤儿 stub 文件（无双/不屈/周泰/化身/新生）
  * 22 个孤儿 stub 文件（乱武/倾国/制霸/双雄/咆哮/固政/天义/天香/急救/断肠/暴虐/武圣/流离/激将/缔盟/肉林/蛊惑/谦逊/酒池/鬼道/黄天/龙胆）
  * 24 个多技能文件中的 stub 技能（华佗急救、董卓酒池肉林暴虐乱武、蔡文姬断肠、左慈化身新生、颜良文丑双雄、张角鬼道黄天、甄姬倾国、小乔天香、孙策制霸、陆逊谦逊、张飞咆哮、大乔流离、鲁肃缔盟、太史慈天义、张昭张纮固政、赵云龙胆、卧龙诸葛火计看破、庞统连环、吕布无双、火计/看破/连环/急救 4 个独立 stub 文件）
  * 3 个孤儿 stub 文件（火计/看破/连环 完整清理）

### Verified

* `npx vitest run`: **1413 passed**, 40 skipped, 0 failed
* v2 路径未破坏：剩余 109 个 v2 trigger 兜底技能继续工作（全是真实 handler）
* `hasWushuang` 计算路径（吕布杀需 2 闪）行为不变

### Engine v3 P5 T1 — chained 迁移 Mark 体系

将 `chained`（铁索连环）状态从 `PlayerState.chained` 字段迁移到 Mark 体系。

### Changed

- `engine/mark.ts` — 新增 `hasMark` / `hasChained` / `CHAINED_MARK` 导出；`clearExpiredMarksByPhase` 中文 phase 名
- `engine/atoms/setChained.ts` — `设横置` atom 改写为 `addMark` / `removeMark` 入口
- `engine/equipment/chained-propagation.ts` — 伤害传导读取 `hasChained` 替代 `PlayerState.chained`
- `engine/view/reducer.ts` — `设横置` server event 处理走 Mark
- `engine/types.ts` — 移除 `PlayerState.chained` 字段
- `engine/state.ts` — 移除 `chained: false` 初始值
- `client/components/debug/DebugPlayerList.tsx` — 移除 `chained: false` 默认值

### Tests

- `tests/atoms/player-chained.test.ts` — 适配 Mark 体系断言
- `tests/atoms/set-chained.test.ts` — 新增幂等性测试 + Mark 断言适配
- `tests/integration/p1-event-handlers.test.ts` — 设横置走 Mark 断言
- `tests/scenarios/设备/大雾-真规则.test.ts` — 用 `addMarkToPlayer` 替代手动构造 chained
- `tests/scenarios/设备/铁索连环.test.ts` — 用 `addMarkToPlayer` 替代手动构造 chained
- `tests/scenarios/设备/雷电-连环.test.ts` — 用 `addMarkToPlayer` 替代手动构造 chained

### Documentation

- `docs/ENGINE.md` — §4.8 更新为"持续状态走 Mark 体系"；§6 P5 表格 chained 行标 ✅

---

## [Unreleased] — 2026-06-05

### Engine v3 P0 — 引擎核心扩展

按 `docs/ENGINE.md` §6 P0 表格落地 6 项改进，**12 commits** 跨 6 Task。

### Added

- `engine/atoms/reshuffle.ts` — 抽 `reshuffle` atom（修 §4.7 重洗不写 serverLog）
- `engine/atoms/giveCard.ts` / `takeCard.ts` — 13+ 技能语义统一（仁德/突袭/反间/好施/黄天/集智/借刀失败/归心/反馈/烈刃/雷击/顺手牵羊/过河拆桥）
- `engine/atoms/specifyTarget.ts` / `becomeTarget.ts` / `resolveCard.ts` — useCard 三阶段原子
- `engine/atoms/compareRank.ts` — 拼点比较原子（5 拼点技能基础设施）
- `engine/phases/pindian.ts` — pindian SkillPhase 骨架
- `engine/phases/multiStep.ts` — multiStep SkillPhase 骨架
- `engine/skills/wansha.ts` / `kongcheng.ts` / `weimu.ts` — 用 `registerAtomHook` 实现演示技能
- ADR 0014-0017 文档

### Changed

- `engine/atoms/draw.ts` — `reshuffleIfNeeded` 替换为 onBefore 钩子调用
- `engine/view/reducer.ts` — `applyGameStateEvent` 加 `case 'reshuffle'` no-op
- `engine/atom.ts` — 导出 `clearAtomRegistry`；re-export `registerAtomHook` / `clearAtomHooks`
- `engine/skills/qun.ts` — 移除 v2 `完杀` / `帷幕` stub（避免与 v3 重复 registerSkill）
- `engine/skills/shu.ts` — 移除 v2 `空城` stub
- `engine/types.ts` — Atom 联合 +5 变体（reshuffle / giveCard / takeCard / specifyTarget / becomeTarget / resolveCard / compareRank）；SkillPhase 联合 +2 变体（pindian / multiStep）；`cardPlayed` GameEvent 加 `@deprecated`
- `engine/phase.ts` — 转发 `result.error`
- `engine/phases/index.ts` — 注册 pindian + multiStep
- `tests/scenario-runner.ts` — `applyAtoms` 辅助方法
- `tests/engine-helpers.ts` — `TestGameOptions` 加 hand / deck 选项

### Tests

新增 25+ 单元/场景测试：

- `tests/atoms/reshuffle.test.ts` (4 测试)
- `tests/atoms/give-take-move.test.ts` (5 测试)
- `tests/atoms/use-card-lifecycle.test.ts` (4 测试)
- `tests/unit/pindian.test.ts` (7 测试)
- `tests/unit/multi-step.test.ts` (1 测试)
- `tests/scenarios/群/完杀.test.ts` (3 场景)
- `tests/scenarios/蜀/空城.test.ts` (5 场景)
- `tests/scenarios/群/帷幕.test.ts` (3 场景)

### Verified

- `pnpm test`: **1306 passed**, 38 skipped, 1 pre-existing flake (`tests/unit/memo.test.tsx` timing)
- `pnpm typecheck`: clean
- v2 路径未破坏（38+ 老 `trigger.event` 技能继续工作）
- v2 → v3 迁移的 3 个演示技能（完杀/空城/帷幕）通过 `registerAtomHook` 实现，作为 [T-25] 渐进迁移模板

### Known Issues / P1 Follow-ups

- `engine/view/reducer.ts` 缺 `giveCard` / `takeCard` case（13+ 技能 v3 迁移时必须修）
- 引擎 entry 未在 card handler 关键点 emit 3 个 useCard atom（借刀/五谷/桃园 v3 实现时补）
- 38+ `trigger.event` 技能未迁移到 `registerAtomHook`（[T-25] 渐进迁移 + [T-22] 2 周稳定期后删 v2）
- pindian 双方选牌 pending 表达留 P1
- multiStep step 级 resume 留 P2
- `damage.type` 字段 / `chained` 状态 / 4 武器 stub / 八卦阵 var 不读 等 P1 改进未触及

### Documentation

- `docs/ENGINE.md` §0.3 §4.7 标 ✅ 已修
- `docs/ENGINE.md` §6 P0 全部标 ✅ 完成
- 4 条新 ADR（0014-0017）

---

## 历史

早期版本变更见 git log（`b047166` 之前的 commit 历史）。
