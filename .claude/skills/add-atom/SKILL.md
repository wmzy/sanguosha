---
name: add-atom
description: 添加三国杀引擎的原子操作(atom)。实现 AtomDefinition(validate/apply/toViewEvents/applyView),处理信息分级和等待型 pending。当用户要求添加/创建新的 atom 时使用。
argument-hint: [atom类型名]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git *), Bash(npx tsc *)
---

## 事实依据(严格遵守)

1. **atom 的语义基于三国杀规则**。先确认规则来源(技能描述文档 `docs/research/` 或基础规则)。
2. **不得臆造 atom 的效果**——只实现描述中明确的状态变更。
3. **如果规则不明确,标注"待澄清"并提问,不要自行补全**。

## 实现步骤

### 1. 定义 Atom 类型
在 `src/engine/types.ts` 的 `Atom` 联合类型中添加成员。

### 2. 创建 atom 文件
在 `src/engine/atoms/` 下创建 `${atom名}.ts`,导出 `AtomDefinition` + 调用 `registerAtom`。

**引擎规范**:
1. `validate`:数据级检查,返回 `string | null`
2. `apply`:**原地突变 state**,不返回新对象
3. 玩家用座次下标(number)
4. `toViewEvents`:在 apply 前调用,做信息分级(ownerViews/othersView/null=看不到)
5. `applyView`:与 apply 对称
6. 等待型 atom:`pending` 三件套(onTimeout/prompt/timeout)必填

### 3. 注册
在 `src/engine/atoms/index.ts` 添加 `import './${atom名}';`

### 4. 编辑安全
- 先读完整文件再编辑
- **编辑后立即运行 `npx tsc --noEmit`** 自检,有错误立即修复

## 详细规范

完整 AtomDefinition 规范、等待型 atom 示例、信息分级模式、Atom Checklist 详见:
`docs/guides/添加atom.md`
