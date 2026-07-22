---
name: add-skill
description: 添加三国杀技能。读取技能描述文档,分解原子操作和钩子时机,产出契约清单,实现技能代码并独立编写触发测试。当用户要求添加/实现某个武将技能时使用。
argument-hint: [技能名]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git *), Bash(npx tsc *), Bash(npx vitest *)
metadata:
  internal: true
---

## 事实依据(严格遵守)

1. **技能描述是唯一事实来源**。先读取 `docs/research/武将技能/` 下对应武将的 `.md` 文件,找到 `$ARGUMENTS` 相关技能描述。
2. **不得臆造规则、效果、数值**。描述里没写的不要加,描述里有的必须实现。
3. **如果描述模糊或缺失,标注"待澄清"并提问,不要自行补全**。

## 三步流程(每步独立交付)

### 步骤 1:分析(输出分析报告,不写代码)

阅读技能描述后输出:
1. **基本信息**:名称、类型、触发时机、限制条件
2. **原子操作分解**:逐条列出需要 apply 的 atom(类型+参数+顺序)
3. **钩子挂载时机**:需要注册的 before/after hook,挂在哪个 atomType,触发条件
4. **缺失 atom 检查**:对比 `src/engine/atoms/index.ts`,缺失的标注"需要先添加 atom"
5. **契约清单(关键!)**:列出本技能读/写的所有跨 atom 通信通道(标签/localVars/turn.vars),标注**生产者和消费者**,以及对端是否已实现。对端未实现的标注"需要协调"。
6. **是否涉及通用机制**:出杀次数→用 `turn.vars['杀/quota']`;装备技能→确认加载/卸载已由装备通用处理;横切规则(防具穿透等)→报给主 agent

### 步骤 2:实现(基于分析报告写代码)

**引擎规范**:文件 `src/engine/skills/${技能名}.ts`;ownerId 是座次下标(number);状态变更通过 applyAtom;跨 atom 通信通过 localVars/turn.vars/marks(tags),不用 frame.params;before hook 返回 HookResult;在 skills/index.ts 注册。

**钩子类型收窄**:`registerBeforeHook/AfterHook` 已泛型化——`atomType` 参数自动收窄 `ctx.atom` 到对应形状,无需 `ctx.atom as {…}` 强转。复用多 atomType 的 handler 需标注联合类型:`ctx: AtomBeforeContext<AtomOfName<'询问闪' | '询问杀'>>`。

**通用机制(优先复用,不要自造)**:
- 出杀次数限制/突破:读写 `state.turn.vars['杀/quota']`(详见 docs/guides/添加技能.md §1.6.1)
- 装备技能加载/卸载:装备通用已处理,不要重复
- 横切规则:用标签(`tag:技能名/效果`),所有相关技能统一检查

**编辑安全(防中断损坏)**:
- 先读完整文件再编辑。用 write 覆盖整个文件,或 edit 小范围
- **编辑后立即运行 `npx tsc --noEmit`** 自检,有错误立即修复
- 缺失 atom 先实现(参考 docs/guides/添加atom.md)

### 步骤 3:测试(独立编写)

1. 文件:`tests/skill-tests/${技能名}.test.ts`,用 SkillTestHarness
2. **必须包含触发测试**:实际 dispatch 技能 action,验证效果确实生效
3. 覆盖:happy path / 触发条件不满足 / 边界
4. **生成后运行 `npx vitest run tests/skill-tests/${技能名}.test.ts`**,附上结果

## 详细模板和通用机制

四类技能模板、通用机制设计(出杀次数/装备加载卸载/横切规则/身份势力)、完整 Checklist、SkillTestHarness API 详见:
`docs/guides/添加技能.md`
