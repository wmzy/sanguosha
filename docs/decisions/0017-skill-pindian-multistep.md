# ADR 0017 — pindian / multiStep SkillPhase 骨架

**状态**: 已接受

**前置依赖**: ADR 0012

## 背景

`docs/ENGINE.md` §3.1 列出 27 个未实现技能，按"缺失机制"分组：

- **拼点机制**（5 个）：驱虎 / 天义 / 制霸 / 烈刃 / 双雄
- **多步 prompt**（4 个）：固政 / 离间 / 乱武 / 蛊惑

两类技能都需要"跨多步的状态机"：

- **拼点**：双方同时揭示手牌比点数，平局用 seed RNG 决胜
- **多步 prompt**：第一个 prompt 完成后，第二个 prompt 基于第一个的选择

但当前 `SkillPhase` union（`engine/types.ts:345-353`）只有 7 种（sequence / loop / foreach / condition / respond / emit / prompt / atoms），无 pindian / multiStep。

## 决策

### 抽 `pindian` SkillPhase + `compareRank` atom

```ts
// engine/types.ts
| { type: 'pindian'; a: Expr<string>; b: Expr<string>;
    aCardId?: Expr<string>; bCardId?: Expr<string>;
    then: SkillPhase[]; else?: SkillPhase[] }
```

```ts
// engine/atoms/compareRank.ts
| { type: 'compareRank'; a, b, aCardId, bCardId }
```

`compareRank` atom apply：
1. 读 `state.cardMap[aCardId].rank` 与 `bCardId` 的 rank
2. 大者赢；若平局，用 `createRng(state.rngState).nextInt(2)` 决胜，`rngState` 推进 1
3. 双方各弃 1 张
4. `winner` 写入 `ctx.localVars.pindianWinner`
5. emit `compareRank` server event `{a, b, winner, aRank, bRank, tied?}`

`pindian` SkillPhase（`engine/phases/pindian.ts`）：
- 注册走 `registerPhase` 动态分发（与现有 phase 一致）
- 调 `compareRank` atom
- 读 `ctx.localVars.pindianWinner` 分发 then/else

### 抽 `multiStep` SkillPhase 骨架

```ts
// engine/types.ts
| { type: 'multiStep'; steps: SkillPhase[] }
```

```ts
// engine/phases/multiStep.ts
registerPhase({
  type: 'multiStep',
  execute(ctx, phase, state) {
    let s = state;
    for (const step of phase.steps) {
      const sub = executePlan(s, [step], ctx);
      s = sub.state;
      if (s.pending !== null) return { state: s, events: [...allEvents, ...sub.events] };
    }
    return { state: s, events: allEvents };
  },
});
```

### 骨架定位（明确边界）

两个 SkillPhase 都是**骨架**：

- **pindian**：双方选牌逻辑（pending 表达）留给 P1 阶段。骨架里 aCardId/bCardId 必须是 pre-resolved（来自 ctx.localVars 或 SkillPhase 字面量）。
- **multiStep**：step 级 resume（"用户响应 pending 后从断点继续"）留给 P2 阶段。骨架里如果产生 pending，pending 后重新进入 multiStep 会从头跑——这是已知限制（comment 标注）。

### RANK 顺序：K=13 高，A=1 低

三国杀规则：K > Q > J > 10 > ... > 2 > A。`engine/atoms/compareRank.ts` 复用 `engine/pile-compare.ts:getRankValue` 保持一致。

## 后果

**正面**:
- 5 拼点技能（驱虎/天义/制霸/烈刃/双雄）有清晰落地路径
- 4 多步 prompt 技能（固政/离间/乱武/蛊惑）有清晰落地路径
- 现有 `registerPhase` 模式复用，phase.ts 不变
- RANK 顺序与全引擎一致（`getRankValue`）

**负面**:
- **pindian 骨架不完整**：技能 handler 仍需在 pindian 之前用 pending 表达"双方选牌"
- **multiStep 骨架不完整**：跨 pending 的 step 级 resume 未实现——P1/P2 工作
- `pindian` SkillPhase 测试只在 atom 层面（7 测试），SkillPhase 端到端测试需要等 P1 完善

## 验证

### compareRank
- `tests/unit/pindian.test.ts`: 7 测试
  - A vs K → K 赢（点数大者赢，13 > 1）
  - 同点数 seed RNG 决胜，相同 seed 决定相同 winner
  - apply 与 getResult winner 一致（post-apply RNG rewind 正确）
  - pindian SkillPhase then/else 分发
  - 缺 cardId 返回 error
  - 2 个 aCardId/bCardId 来自 ctx.localVars 路径

### multiStep
- `tests/unit/multi-step.test.ts`: 1 测试
  - 顺序执行 prompt steps，第一个 prompt 产生 pending 后第二个未跑

- 全量测试：1306 pass
- `pnpm typecheck`: clean

## 改动文件

**新增**:
- `engine/atoms/compareRank.ts` (50 行)
- `engine/phases/pindian.ts` (50 行)
- `engine/phases/multiStep.ts` (47 行)
- `tests/unit/pindian.test.ts` (7 测试)
- `tests/unit/multi-step.test.ts` (1 测试)

**修改**:
- `engine/atoms/index.ts`: 注册 compareRank
- `engine/phases/index.ts`: 注册 pindian + multiStep
- `engine/types.ts`: Atom 联合 + compareRank；SkillPhase 联合 + pindian + multiStep
- `engine/phase.ts`: 微小错误转发（不破坏其他 phase）

## 跟进项（P1+）

- **P1**:
  - pindian 双方选牌 pending 表达
  - compareRank view reducer 处理
  - 5 拼点技能实现（驱虎/天义/制霸/烈刃/双雄）
- **P2**:
  - multiStep step 级 resume（pending 跨多回合）
  - 4 多步 prompt 技能实现（固政/离间/乱武/蛊惑）
  - forEachLiving / orderedChoice / multiRespond / counter / branch 等衍生 SkillPhase

## ADR 关系

- **依赖**: ADR 0012（applyAtoms + SkillPhase 体系）
- **被未来依赖**: 5 拼点 + 4 多步 prompt 技能 v3 实现
