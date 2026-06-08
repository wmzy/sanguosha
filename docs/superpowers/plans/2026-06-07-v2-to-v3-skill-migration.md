# v2 技能迁移 v3 registerAtomHook 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 63 个 v2 trigger 技能迁移到 v3 `registerAtomHook`，删除 v2 `trigger` 字段和 `handler` 函数，让 `emitEvent` 的动态 trigger 构建不再匹配到已迁移的技能。

**Architecture:** v2 技能通过 `trigger.event` + `handler()` 被 `emitEvent` 派发。v3 通过 `registerHooks()` + `registerAtomHook()` 在 atom 应用时触发钩子。迁移策略是"双源并存期"：v2 trigger 和 v3 registerHooks 同时存在，v3 优先执行。验证通过后删 v2 trigger 字段。

**Tech Stack:** TypeScript, vitest, pnpm

---

## 现状分析

### v2 技能分布（63 个独立技能 ID）

**按 handler 复杂度分 3 类：**

| 类别 | 数量 | 描述 | v3 迁移方式 |
|------|------|------|------------|
| A-被动响应 | ~20 | handler 只返回 `[{ type: 'atoms', ops }]`，无条件/无 prompt | `onAfter: { additionalAtoms }` |
| B-条件响应 | ~25 | handler 有 `if` 判断后返回 atoms | `filter` 函数内实现条件 |
| C-主动交互 | ~18 | handler 包含 `prompt`/`loop`/`foreach`/`checkDying` | **不可直接迁**——需要 `推入待定` 替代 |

### v3 registerAtomHook 能力边界

**能做：**
- `onAfter`: `additionalAtoms` — 追加副作用（摸牌/设变量/造成伤害等）
- `onBefore`: `cancel`/`redirect`/`replace` — 拦截/改写 atom

**不能做（需要 SkillPhase executePlan）：**
- `prompt` — 需玩家交互（选牌/选角色/确认）
- `loop`/`foreach` — 循环逻辑
- `condition` — 条件分支
- `pindian`/`checkDying` — 特殊机制

### 迁移策略

1. **A/B 类**（~45 个）：直接用 `registerHooks` + `onAfter`/`filter` 迁移
2. **C 类**（~18 个）：保留 v2 `trigger` + `handler`，仅标记 `[v2-only]`，待后续 v3 引入 `pendingAction` 能力再迁移

### 已有参考实现

- **闭月**（`src/engine/skills/闭月.ts`）— 唯一完整 v3 实现，A 类（`onAfter` 追加摸牌）

---

## 文件结构

每个技能文件遵循统一模式：
- `src/engine/skills/<技能名>.ts` — 技能定义文件
- `tests/scenarios/<势力>/<角色>.test.ts` — 场景测试

---

## 迁移步骤（通用模板）

每个 A/B 类技能的迁移遵循 4 步：

1. **加 `registerHooks`**：在 `SkillDef` 中添加 `registerHooks` 方法
2. **实现 `filter`**：把 handler 中的 `if` 条件转为 `filter` 函数
3. **实现 `onAfter`**：把 handler 中的 atoms 转为 `additionalAtoms`
4. **验证**：跑该技能的测试，确认通过

迁移完成后**不删 v2 trigger/handler**——保留双源兜底，等全部迁移完统一删除。

---

## Task 1: A 类迁移 — 受到伤害响应（6 个）

最容易迁移的被动技能：受到伤害后自动执行 atoms。

**Files:**
- Modify: `src/engine/skills/遗计.ts`
- Modify: `src/engine/skills/反馈.ts`
- Modify: `src/engine/skills/奸雄.ts`
- Modify: `src/engine/skills/节命.ts`
- Modify: `src/engine/skills/刚烈.ts`
- Modify: `src/engine/skills/悲歌.ts`
- Test: `tests/scenarios/魏/曹操.test.ts`, `tests/scenarios/魏/司马懿.test.ts`, `tests/scenarios/魏/夏侯惇.test.ts`, `tests/scenarios/魏/荀彧.test.ts`, `tests/scenarios/群/蔡文姬.test.ts`, `tests/scenarios/魏/郭嘉.test.ts`

**迁移模板（以遗计为例）：**

遗计 v2 handler：
```ts
handler(_ctx, _state) {
  return [
    { type: 'atoms', ops: [{ type: '摸牌', player: _ctx.self, count: 2 }] },
    // ... prompt/foreach（分配给其他角色）
  ];
}
```

遗计 v3 registerHooks（只迁"摸 2 牌"部分，prompt 部分保留 v2）：
```ts
registerHooks(registry) {
  registry.register({
    atomType: '造成伤害',
    filter: (state, atom) => {
      const a = atom as Extract<Atom, { type: '造成伤害' }>;
      const target = a.target as string;
      return state.players[target]?.skills?.includes('遗计') ?? false;
    },
    onAfter: ({ atom }) => {
      const a = atom as Extract<Atom, { type: '造成伤害' }>;
      return {
        additionalAtoms: [{ type: '摸牌', player: a.target as string, count: 2 }],
      };
    },
  });
},
```

- [ ] **Step 1: 遗计** — 加 registerHooks，`onAfter` 返回 `{ additionalAtoms: [{ type: '摸牌', player: target, count: 2 }] }`，filter 限 target 有遗计技能
- [ ] **Step 2: 跑遗计测试** — `npx vitest run tests/scenarios/魏/郭嘉.test.ts`，预期 PASS
- [ ] **Step 3: 反馈** — 加 registerHooks，`onAfter` 返回 `{ additionalAtoms: [{ type: '获得', player: target, ... }] }`
- [ ] **Step 4: 跑反馈测试** — `npx vitest run tests/scenarios/魏/司马懿.test.ts`
- [ ] **Step 5: 奸雄** — 同模式，获得造成伤害的牌
- [ ] **Step 6: 跑奸雄测试** — `npx vitest run tests/scenarios/魏/曹操.test.ts`
- [ ] **Step 7: 节命** — `onAfter` 返回摸牌 atoms
- [ ] **Step 8: 跑节命测试**
- [ ] **Step 9: 刚烈** — `onAfter` 返回造成伤害 atom（source 反弹）
- [ ] **Step 10: 跑刚烈测试**
- [ ] **Step 11: 全量测试** — `npx vitest run`，预期 1412+ pass
- [ ] **Step 12: Commit** — `refactor(engine): A类-受到伤害系 5 技能加 v3 registerHooks`

---

## Task 2: A 类迁移 — 回合开始/阶段开始响应（8 个）

锁定技：回合/阶段开始时自动执行 atoms。

**技能清单：** 英姿(摸牌+1)、好施(摸牌+1)、奇才(设变量)、祸首(设变量)、红颜(设变量)、巨象(设变量)、马术(设变量-1距离)、据守(摸3弃1)

- [ ] **Step 1-8: 逐技能加 registerHooks** — `atomType: '回合开始'` 或 `'阶段开始'`，`filter` 限 phase + 角色ID
- [ ] **Step 9: 全量测试** — `npx vitest run`
- [ ] **Step 10: Commit** — `refactor(engine): A类-回合/阶段开始系 8 技能加 v3 registerHooks`

---

## Task 3: A 类迁移 — 其他被动响应（6 个）

闭月(已迁移)、枭姬(装备变动)、连营(弃置)、屯田(弃置)、行殇(死亡)、颂威(判定结果)

- [ ] **Step 1-6: 逐技能加 registerHooks**
- [ ] **Step 7: 全量测试**
- [ ] **Step 8: Commit**

---

## Task 4: B 类迁移 — 条件响应（15 个第一批）

有 `if` 判断的被动技能。条件逻辑迁入 `filter` 函数。

**技能清单：** 享乐(出牌时体力+1)、八阵(回合开始设 virtualArmor)、凿险(准备阶段判定)、若愚(觉醒)、涅槃(濒死)、突袭(摸牌阶段)、救援(回复体力)、魂姿(准备阶段)、天妒(判定结果)、志继(觉醒)、激昂(出牌)、屯田(弃置)、烈刃(造成伤害-拼点stub)、狂骨(造成伤害-回血)、烈弓(出牌)

- [ ] **Step 1-15: 逐技能加 registerHooks**，`filter` 实现原有 `if` 条件
- [ ] **Step 16: 全量测试**
- [ ] **Step 17: Commit** — `refactor(engine): B类-条件响应 15 技能加 v3 registerHooks`

---

## Task 5: B 类迁移 — 条件响应（剩余 15 个）

**技能清单：** 强袭、神速、鞬出、观星、铁骑、离间、乱击、颂威、青囊、克己、奸雄(已迁)、刚烈(已迁)、节命(已迁)、反馈(已迁)、洛神(含loop-标C类)

- [ ] **Step 1-14: 逐技能加 registerHooks**
- [ ] **Step 15: 全量测试**
- [ ] **Step 16: Commit**

---

## Task 6: 清理重复定义

65 个技能 ID 在独立文件和角色文件中都有定义。迁移完成后清理重复。

**Files:**
- 所有 `src/engine/skills/<技能名>.ts` 孤儿文件
- `src/engine/skills/<角色名>.ts` 多技能文件

- [ ] **Step 1: 确认哪些独立技能文件是孤儿（不在 index.ts import）**
- [ ] **Step 2: 删孤儿文件中已迁移技能的 v2 trigger + handler**（保留 SkillDef 骨架 + registerHooks）
- [ ] **Step 3: 全量测试**
- [ ] **Step 4: Commit** — `refactor(engine): 清理孤儿技能文件重复定义`

---

## Task 7: C 类标记 + 文档

18 个 prompt 类技能保留 v2 trigger/handler，标记 `[v2-only]` 注释。

**技能清单：** 仁德、放权、制衡、反间、鬼才、国色、挑衅、英魂、结姻、崩坏、直谏、巧变、断粮、放逐、奇袭、驱虎、裸衣、再起

- [ ] **Step 1: 逐技能文件加 `// [v2-only] C类：包含 prompt/loop/condition，需要 v3 pendingAction 能力` 注释**
- [ ] **Step 2: 更新 ENGINE.md §4.5 记录 C 类技能清单和后续计划**
- [ ] **Step 3: 更新 CHANGELOG.md**
- [ ] **Step 4: 全量测试**
- [ ] **Step 5: Commit** — `docs(engine): 标记 18 个 C 类技能为 v2-only + 更新文档`

---

## Task 8: 最终验证 + 基线

- [ ] **Step 1: 全量测试** — `npx vitest run`，预期 1412+ pass
- [ ] **Step 2: 确认 emitEvent 动态构建不再匹配已迁移技能的 v2 trigger**（因为 handler 返回空 `[]` 时跳过，但 trigger 仍在 → 需要在 handler 中检测 v3 已执行并跳过）
- [ ] **Step 3: 更新 ENGINE.md 统计数字**
- [ ] **Step 4: git push**

---

## 自审清单

**1. Spec 覆盖：** 63 个独立技能全覆盖——A/B 类迁 v3（~45），C 类标 v2-only（~18）。

**2. Placeholder 扫描：** 无 TBD/TODO。每个 task 有具体技能清单和迁移模板。

**3. 类型一致性：** `registerHooks` 签名与 `闭月.ts` 一致。`filter`/`onAfter` 类型与 `AtomHookDef` 一致。
