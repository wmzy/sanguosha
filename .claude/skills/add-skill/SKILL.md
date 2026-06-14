---
name: add-skill
description: 添加三国杀技能。读取技能描述文档,分解原子操作和钩子时机,实现技能代码并独立编写测试。当用户要求添加/实现某个武将技能时使用。
argument-hint: [技能名]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git *)
---

## 事实依据(严格遵守)

1. **技能描述是唯一事实来源**。先读取 `docs/research/武将技能/` 下对应武将的 `.md` 文件,找到 `$ARGUMENTS` 相关技能描述。
2. **不得臆造规则、效果、数值**。描述里没写的不要加,描述里有的必须实现。
3. **如果描述模糊或缺失,标注"待澄清"并提问,不要自行补全**。

## 三步流程(每步独立交付)

### 步骤 1:分析(输出分析报告,不写代码)

阅读技能描述后输出:
1. **基本信息**:名称、类型(锁定技/主动技/转化技/限定技/主公技)、触发时机、限制条件
2. **原子操作分解**:逐条列出需要 apply 的 atom(类型+参数+顺序)
3. **钩子挂载时机**:需要注册的 before/after hook,挂在哪个 atomType,触发条件
4. **缺失 atom 检查**:对比 `src/engine/atoms/index.ts` 已注册的 atom,列出技能需要但引擎尚不存在的。如有缺失,标注"需要先添加 atom"(参考 `docs/guides/添加atom.md`)。
5. **状态通信**:跨 atom 通信需要的 `state.localVars` key 和读写时机

### 步骤 2:实现(基于分析报告写代码)

**引擎规范(必须遵守)**:
1. 技能文件:`src/engine/skills/${技能名}.ts`,导出 `createSkill`/`onInit`/`onMount`/`default`(SkillModule)
2. `ownerId` 是座次下标(`number`),不是玩家名。玩家引用用 `state.players[ownerId]`,比较 `atom.target === ownerId`
3. **所有状态变更通过 `applyAtom(state, atom)`**,不直接 mutate state(影子卡创建除外)
4. **跨 atom 通信通过 `state.localVars`**,不通过 `frame.params`
5. import 路径:`applyAtom`/`pushFrame`/`popFrame` ← `'../create-engine'`;`registerAction`/`registerBeforeHook`/`registerAfterHook` ← `'../skill'`;类型 ← `'../types'`
6. before hook 返回 `HookResult`(`pass`/`modify`/`cancel`),类型从 `'../types'` 导入
7. 转化技用 `preceding`(组合 action)+ 影子卡,不 mutate `cardMap`
8. 在 `src/engine/skills/index.ts` 的 `skillLoaders` 注册

如果分析报告标注了缺失 atom,**先实现 atom**(参考 `docs/guides/添加atom.md`),再实现技能。

### 步骤 3:测试(独立编写)

1. 文件:`tests/skill-tests/${技能名}.test.ts`
2. 用 `SkillTestHarness`(`tests/engine-harness.ts`),`beforeEach` 里 `resetForTest()` + `await setup(...)`
3. 至少覆盖:happy path / 触发条件不满足 / 边界(次数限制、距离、手牌不足)
4. 断言可观察状态(health/hand/zone),不断言内部 atom 序列
5. **不得为让测试通过而修改实现逻辑**——测试失败说明实现或测试有一方有 bug

## 详细模板和 Checklist

四类技能模板(锁定技/主动技/转化技/防具武器)、完整 Checklist、SkillTestHarness API 详见:
`docs/guides/添加技能.md`
