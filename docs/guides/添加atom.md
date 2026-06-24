# 添加 Atom 指南

> Atom 是引擎最小的状态变更单元。每个 atom 做三件事:验证合法、变更状态、生成前端视图事件。
> 本文档是添加 atom 的规范和提示词。

## 一、Atom 的职责(必读)

### 1.1 一个 atom = 一个游戏事件

atom 不是"函数调用"——它是"发生了什么"(摸牌、造成伤害、询问闪)。前端需要为每个 atom 渲染动画/UI。因此:

- **每个 atom 对应前端可见的一个事件**(或至少是状态变更的因果单元)
- **不可再分**——atom 内部不包含"等待玩家输入"(那是 pending atom 的职责,见 §三)

### 1.2 AtomDefinition 四件套

```ts
interface AtomDefinition<A = Atom> {
  type: string;
  validate(state, atom): string | null;   // 数据级合法性检查
  apply(state, atom): void;                 // 原地突变 state(不返回新对象!)
  toViewEvents?(state, atom): ViewEventSplit | undefined;  // 信息分级(apply 前调用)
  applyView?(view, event): void;            // 前端增量更新
  effect?: AtomEffect;                      // 动画/音效(fallback,toViewEvents 未实现时用)
  pending?: { onTimeout: (state: GameState, atom: Atom) => Promise<void>; prompt: ActionPrompt; timeout: number };  // 等待型(可选)
}
```

### 1.3 关键约束

| 约束 | 说明 |
|---|---|
| **apply 必须原地突变** | `state.players[atom.target].health -= 1` ✓,不返回新对象 |
| **玩家用座次下标(number)** | `atom.target`/`atom.player`/`atom.source` 都是 `number`,`state.players[atom.target]` |
| **toViewEvents 在 apply 前调用** | 此时 state 未变更,可读取即将被消费的数据(如牌堆顶牌面) |
| **信息分级** | `ownerViews`(指定玩家看到专属内容) + `othersView`(其余人看到的通用内容);`null` = 该玩家看不到 |
| **pending 三件套都必填** | `onTimeout`(超时 async 函数)、`prompt`(前端 UI)、`timeout`(秒数) |

## 二、添加 atom 的步骤

### 步骤 1:定义 Atom 类型

在 `src/engine/types.ts` 的 `Atom` 联合类型中加一行:

```ts
export type Atom =
  | ...
  | { type: '陷入濒死'; target: number }   // ← 新增
  | ...;
```

### 步骤 2:创建 atom 文件

在 `src/engine/atoms/` 下创建 `${atom名}.ts`:

```ts
// src/engine/atoms/陷入濒死.ts
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 陷入濒死: AtomDefinition<{ target: number }> = {
  type: '陷入濒死',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply(state, atom) {
    // 原地突变——标记玩家进入濒死
    state.players[atom.target].health = 0;
    // 注意:alive 不在此设置——濒死是"可能被救"的中间态
  },
  effect: { sound: 'dying', animation: 'flash_red', duration: 600 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '陷入濒死',
      target: atom.target,
      effect: { sound: 'dying', animation: 'flash_red', duration: 600 },
    };
    return {
      ownerViews: new Map(),
      othersView: view,
    };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.target as number));
    if (pi >= 0) view.players[pi].health = 0;
  },
};

registerAtom(陷入濒死);
```

### 步骤 3:注册

在 `src/engine/atoms/index.ts` 加一行:

```ts
import './陷入濒死';
```

## 三、等待型 atom(pending)

等待型 atom 在 apply 完成后不立即 resolve——进入 pending 区等玩家操作或超时。

```ts
export const 求桃: AtomDefinition<{ target: number }> = {
  type: '求桃',
  validate(state, atom) { /* ... */ return null; },
  apply() { /* 等待型 atom——apply 不修改 state */ },
  pending: {
    onTimeout: async (state) => { await applyAtom(state, { type: '击杀', player: atom.target }); },  // 超时 = 死亡
    prompt: { type: 'confirm', title: '是否使用桃救援?' },
    timeout: 15,  // 秒
  },
  toViewEvents(_state, atom): ViewEventSplit {
    // target 看到带 prompt 的求桃请求
    const targetView: ViewEvent = { type: '求桃', target: atom.target, prompt: {...} };
    const othersView: ViewEvent = { type: '求桃', target: atom.target };
    return { ownerViews: new Map([[atom.target, targetView]]), othersView };
  },
};
```

**pending 核心规则**:
- 同时只有一个 pending——引擎不变量
- 等待型 atom 不可被取消——必走"响应到达"或"超时"之一
- `onTimeout` 是一个 async 函数 `(state, atom) => Promise<void>`,引擎在 slot 超时时调用(内部可自由编排 `applyAtom`,每个 applyAtom 走完整 pipeline)

## 四、toViewEvents 信息分级

toViewEvents 的返回值 `ViewEventSplit` 决定每个玩家看到什么:

```ts
return {
  // ownerViews: 指定玩家看到专属内容(如摸牌看到牌面)
  ownerViews: new Map<number, ViewEvent | null>([
    [atom.target, targetView],  // target 看到完整信息
  ]),
  // othersView: 其他人看到的通用内容(如摸牌只看到数量)
  othersView: othersView,
};
```

- `ownerViews.set(playerId, null)` = 该玩家看不到此事件
- `othersView = null` = 其他人看不到此事件
- 不实现 `toViewEvents` = fallback:所有人看到带 `effect` 的原始 atom

**常见模式**:
- 公开事件(造成伤害):`ownerViews: new Map(), othersView: view`(所有人一样)
- 私密事件(摸牌):`ownerViews: Map([[player, 牌面view]]), othersView: countView`(本人看牌面,他人看数量)
- 隐藏事件(扣牌):`ownerViews: Map([[player, 牌面view]]), othersView: null`(只有扣牌者看到)

## 五、Atom Checklist

- [ ] `type` 字符串与 Atom 联合类型中的成员一致
- [ ] `validate` 做数据级检查(target 存在、amount > 0 等),返回 `string | null`
- [ ] `apply` 原地突变 state,不返回新对象
- [ ] `apply` 不做"等待玩家输入"(那是 pending)
- [ ] `toViewEvents` 做信息分级(本人 vs 其他人)
- [ ] `toViewEvents` 在 apply 前调用(读未变更的 state)
- [ ] `applyView` 与 `apply` 对称(apply 改 GameState,applyView 改 GameView)
- [ ] 等待型 atom:`pending.onTimeout`(async 函数)/`prompt`/`timeout` 三件套齐全
- [ ] 在 `atoms/index.ts` 注册 import

## 六、AI 提示词

```
你是一个三国杀游戏引擎的 atom 开发者。请根据以下信息实现一个 atom。

## 事实依据(严格遵守)

1. atom 的语义基于三国杀规则。先确认规则来源(技能描述文档或基础规则)。
2. 不得臆造 atom 的效果——只实现描述中明确的状态变更。
3. 如果规则不明确,标注"待澄清"。

## Atom 信息

类型名:${atom类型名}
参数字段:${字段名:类型, ...}
语义:${这个 atom 表示什么游戏事件}
状态变更:${apply 具体改什么 state}
等待型:${是/否}(若是:onTimeout 做什么、prompt 是什么、timeout 多少秒)
信息分级:${谁看到什么}

## 引擎规范(必须遵守)

1. atom 文件路径:src/engine/atoms/${atom名}.ts
2. 在 src/engine/types.ts 的 Atom 联合类型中添加对应成员
3. 在 src/engine/atoms/index.ts 注册 import
4. apply 原地突变 state(state.players[atom.target].health -= 1),不返回新对象
5. 玩家用座次下标(number):atom.target/atom.player/atom.source
6. toViewEvents 在 apply 前调用,做信息分级(ownerViews/othersView)
7. applyView 与 apply 对称
8. 等待型 atom 的 pending 三件套(onTimeout async 函数/prompt/timeout)必填

## 要求

1. 导出 AtomDefinition 常量 + 调用 registerAtom
2. validate 严格检查
3. 不实现测试(atom 的测试通过技能测试间接覆盖)

请生成完整代码。
```

## 七、参考文档

- [ENGINE-DESIGN.md](../ENGINE-DESIGN.md) §5 Atom / §5.2 ViewEvent / §6.1 apply 流程
- [添加技能.md](./添加技能.md) 技能实现规范(技能是 atom 的消费者)
