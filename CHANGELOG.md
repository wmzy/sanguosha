# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
