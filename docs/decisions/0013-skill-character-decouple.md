# 武将/技能/装备解耦重构计划

## 现状分析

### 当前架构（三层缠绕）

```
shared/characters/          engine/skills/
├── wei.ts                  ├── 曹操.ts          ← 武将技能
├── shu.ts                  ├── 孙权.ts          ← 武将技能
├── wu.ts                   ├── equipment.ts     ← 装备技能（也用 SkillDef）
├── qun.ts                  ├── bagua.ts         ← 装备技能（v3 钩子）
└── index.ts                ├── wansha.ts        ← 武将技能（v3 钩子）
                            └── index.ts         ← 全部塞进 allSkills: SkillDef[]
```

**核心问题：武将技能和装备技能用同一个 `SkillDef` 类型、同一个 `registry`、同一个 `allSkills[]`。**

### 绑定关系

1. **角色声明**：`CharacterConfig`（`shared/characters/`）定义角色名、血量、性别、势力、`abilities[]`
2. **技能实现**：`SkillDef`（`engine/skills/`）定义 `handler()`、`trigger`、`registerHooks`
3. **关联方式**：`AbilityConfig.name === SkillDef.id`（字符串匹配）
4. **注册时机**：
   - `startGame` → 遍历 `character.abilities` → `registerCharacterTriggers()` → 把 `SkillDef.trigger` 转成 `TriggerRule` 写入 `state.triggers[]`
   - 装备牌挂载 → `registerEquipmentTriggers()` → 同理写 `state.triggers[]`，`source: '装备'`
5. **执行**：`emitEvent()` 遍历 `state.triggers[]`，按 `skillId` 查 `registry` 调 `handler()`

### 问题清单

| # | 问题 | 影响 |
|---|------|------|
| P1 | 装备技能和武将技能同处 `allSkills[]`，靠 `trigger.source` 字符串区分 | 无法独立演进生命周期 |
| P2 | `CharacterConfig.abilities` 是声明式配置，`SkillDef` 是命令式实现，同一技能定义了两次 | 信息重复，改一处忘改另一处 |
| P3 | 角色文件（`曹操.ts`）按角色组织，但一个角色的多个技能之间无共享状态 | 文件级粒度不对应职责 |
| P4 | `registerCharacterTriggers()` 需要外部传入 `characterMap` 做字符串查找 | 耦合贯穿 shared→engine |
| P5 | 装备技能（如八卦阵）内部硬编码 `p.equipment.防具 === '八卦阵'` 检查 | 重复了装备绑定逻辑 |
| P6 | `SkillDef` 既承担"注册表条目"又承担"运行时执行计划"两个职责 | 类型膨胀 |

---

## 目标架构

```
engine/
├── skills/                      ← 纯技能实现（按技能名组织）
│   ├── 奸雄.ts                  ← 单个技能
│   ├── 反馈.ts
│   ├── 仁德.ts
│   ├── 八卦阵.ts                ← 装备技能也在同一目录
│   ├── 诸葛连弩.ts
│   └── index.ts                 ← 聚合导出
├── characters/                  ← 角色声明 + 技能绑定
│   ├── 曹操.ts                  ← CharacterConfig + 技能列表
│   ├── 刘备.ts
│   └── index.ts
├── equipment/                   ← 装备声明 + 装备-技能绑定
│   ├── defs.ts                  ← 装备牌定义（武器/防具/马）
│   ├── skills.ts                ← 装备→技能映射
│   └── index.ts
```

### 关键设计决策

#### D1: 按技能名组织文件，不按角色名

**理由**：
- `SkillDef.id` 就是技能名（'奸雄'、'反馈'），不是角色名
- 一个角色可能有多个技能，而某些技能可能被多个角色共享（如主公技）
- 与测试目录 `tests/scenarios/魏/奸雄.test.ts` 对齐——测试按技能名写，不按角色名

**变化**：`engine/skills/曹操.ts`（含奸雄）→ `engine/skills/奸雄.ts`

#### D2: 角色文件移到 engine/characters/，去掉 shared/characters/

**理由**：
- `CharacterConfig` 中的 `abilities[]` 声明式配置和 `SkillDef` 命令式实现是**同一概念的两个投影**
- 合并到一处：角色文件直接引用技能实现，不需要字符串匹配
- `shared/` 目录只剩下 `types.ts`、`cards/`、`deck.ts`、`rng.ts`——真正的共享代码

**变化**：
```
// 旧
shared/characters/wei.ts → CharacterConfig { abilities: [{ name: '奸雄', ... }] }
engine/skills/曹操.ts    → SkillDef { id: '奸雄', handler() {...} }
// 关联：AbilityConfig.name === SkillDef.id

// 新
engine/characters/曹操.ts → { config: CharacterConfig, skills: [奸雄Def] }
engine/skills/奸雄.ts     → SkillDef { id: '奸雄', handler() {...} }
// 关联：直接 import，编译时绑定
```

#### D3: 装备技能独立注册表

**理由**：
- 装备技能的生命周期 = 装备牌挂载/卸载，与角色技能的生命周期（角色存活）完全不同
- 当前 `registerEquipmentTriggers()` 和 `registerCharacterTriggers()` 已经是两个函数，但都写入同一个 `state.triggers[]`
- 装备技能应该有自己的注册表和查询方式

**变化**：
```ts
// 旧
allSkills: SkillDef[]  // 武将技能 + 装备技能混在一起
registry: Map<string, SkillDef>  // 全局单一注册表

// 新
characterSkills: Map<string, SkillDef>   // 按技能名索引
equipmentSkills: Map<string, SkillDef>   // 按装备名索引（'八卦阵'、'诸葛连弩' 等）
```

#### D4: 去掉 CharacterConfig.abilities 中的声明式 effect

**理由**：
- `AbilityConfig.effect`（`{ type: '获得', source: 'damageSourceCard' }`）是 DSL 格式的技能效果描述
- 实际执行全靠 `SkillDef.handler()`，声明式 `effect` 从未被引擎直接执行
- 它唯一的作用是**给人类看的文档**——这个需求用 `SkillDef.description` 就够了

**变化**：`CharacterConfig.abilities` 简化为 `{ skillId: string; passive?: boolean; modifiers?: string[] }`

---

## 实施阶段

### Phase 1: 按技能名拆分文件（低风险，纯文件操作）

**目标**：`engine/skills/曹操.ts`（含奸雄）→ `engine/skills/奸雄.ts`

**步骤**：
1. 读取每个角色文件，识别其中包含的 `SkillDef[]` 条目
2. 每个条目拆成独立文件（`engine/skills/奸雄.ts`），导出 `export const def: SkillDef`
3. 更新 `index.ts` 从技能名文件导入
4. 保留角色名文件作为 re-export（向后兼容过渡期）

**验证**：全量测试无回归

### Phase 2: 角色文件迁移（中等风险）

**目标**：`shared/characters/` → `engine/characters/`

**步骤**：
1. 创建 `engine/characters/` 目录
2. 每个角色一个文件：`engine/characters/曹操.ts`
3. 角色文件同时导出 `CharacterConfig` 和 `skillIds: string[]`
4. 去掉 `AbilityConfig.effect`/`AbilityConfig.condition`（只保留 `skillId`、`passive`、`modifiers`）
5. `engine/characters/index.ts` 聚合导出 `allCharacters`
6. 全局替换 `@shared/characters` → `@engine/characters`
7. 删除 `shared/characters/`

**验证**：全量测试 + 角色数量断言

### Phase 3: 装备技能独立（中等风险）

**目标**：装备技能有自己的注册表和生命周期

**步骤**：
1. 创建 `engine/equipment/` 目录
2. 把 `equipment.ts` + v3 钩子装备技能（`bagua.ts`、`qinggang.ts` 等）移入
3. `index.ts` 导出 `equipmentSkills: Map<string, SkillDef>`
4. `createEngine` 接收 `{ characterSkills, equipmentSkills }` 而非 `{ skills }`
5. `registerEquipmentTriggers` 从 `equipmentSkills` 查找
6. `registerCharacterTriggers` 从 `characterSkills` 查找
7. 去掉 `TriggerRule.source === '装备'` 字符串约定

**验证**：装备相关场景测试 + 全量回归

### Phase 4: 去掉声明式 effect（低风险，清理）

**目标**：`AbilityConfig` 简化

**步骤**：
1. `AbilityConfig` 改为 `{ skillId: string; passive?: boolean; modifiers?: string[] }`
2. 删除 `Effect`、`EffectPrimitive`、`Condition`（旧 DSL）类型
3. 更新 `shared/types.ts` 移除相关定义
4. 更新所有引用 `AbilityConfig` 的代码

**验证**：TypeScript 编译通过 + 全量测试

### Phase 5: 统一注册表（低风险，收尾）

**目标**：去掉全局 `registry` 单例，全部走 `createEngine` 闭包

**步骤**：
1. `createEngine` 闭包内的 `skillsMap` 成为唯一注册表
2. `emitEvent`/`validateAction` 等函数接收 `skillsMap` 参数
3. 删除 `skill.ts` 中的全局 `registry`、`registerSkill()`、`clearSkillRegistry()`
4. 删除 `skill-hook.ts` 中的全局 `defaultRegistry`、`registerAtomHook()`
5. 所有测试改用 `createEngine` 实例而非全局注册表

**验证**：全量测试 + 多实例隔离测试

---

## 风险与约束

| 风险 | 缓解 |
|------|------|
| Phase 2 影响面广（所有引用 `@shared/characters` 的文件） | LSP rename_file + references 确保零遗漏 |
| Phase 3 装备生命周期变化可能影响 save/load | persistence 测试覆盖 |
| Phase 4 去掉 `Effect` 类型可能破坏前端展示 | 前端已不读 `AbilityConfig.effect`，用 `SkillDef.description` |
| Phase 5 去掉全局注册表影响测试 fixture | 提供测试辅助函数 `createTestEngine()` |

## 预估工作量

| Phase | 文件数 | 测试影响 | 预估复杂度 |
|-------|--------|----------|------------|
| Phase 1 | ~56 技能文件 | 低（只改导入） | ★★☆ |
| Phase 2 | ~60 角色+引用文件 | 中（导入路径变化） | ★★★ |
| Phase 3 | ~15 装备文件 | 中（注册表 API 变化） | ★★★ |
| Phase 4 | ~10 类型+引用文件 | 低（纯删除） | ★☆☆ |
| Phase 5 | ~30 测试+引擎文件 | 高（API 变化） | ★★★ |
