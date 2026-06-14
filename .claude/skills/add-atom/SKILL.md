---
name: add-atom
description: 添加三国杀引擎的原子操作(atom)。实现 AtomDefinition(validate/apply/toViewEvents/applyView),处理信息分级和等待型 pending。当用户要求添加/创建新的 atom 时使用。
argument-hint: [atom类型名]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git *)
---

## 事实依据(严格遵守)

1. **atom 的语义基于三国杀规则**。先确认规则来源(技能描述文档 `docs/research/` 或基础规则)。
2. **不得臆造 atom 的效果**——只实现描述中明确的状态变更。
3. **如果规则不明确,标注"待澄清"并提问,不要自行补全**。

## 实现步骤

### 1. 定义 Atom 类型

在 `src/engine/types.ts` 的 `Atom` 联合类型中添加成员:
```ts
| { type: '$ARGUMENTS'; target: number; ... }
```

### 2. 创建 atom 文件

在 `src/engine/atoms/` 下创建 `${atom名}.ts`,导出 `AtomDefinition` + 调用 `registerAtom`。

**引擎规范(必须遵守)**:
1. `validate(state, atom)`:数据级检查(target 存在、amount > 0 等),返回 `string | null`
2. `apply(state, atom)`:**原地突变 state**(`state.players[atom.target].health -= 1`),不返回新对象
3. 玩家用座次下标(`number`):`atom.target`/`atom.player`/`atom.source`
4. `toViewEvents(state, atom)`:在 apply 前调用(读未变更的 state),做信息分级:
   - `ownerViews: Map<number, ViewEvent | null>` — 指定玩家看到专属内容(如摸牌看牌面)
   - `othersView: ViewEvent | null` — 其他人看到的通用内容(如摸牌看数量)
   - `null` = 该玩家看不到此事件
5. `applyView(view, event)`:与 `apply` 对称(apply 改 GameState,applyView 改 GameView)
6. 等待型 atom 的 `pending` 三件套必填:`onTimeout`(超时 atom)、`prompt`(前端 UI)、`timeout`(秒数)

### 3. 注册

在 `src/engine/atoms/index.ts` 添加 `import './${atom名}';`

## 详细规范和模板

完整 AtomDefinition 规范、等待型 atom 示例、信息分级模式、Atom Checklist 详见:
`docs/guides/添加atom.md`
