# 三国杀引擎设计文档

> 最终设计，不含历史变更。

## 1. 架构总览

```
客户端 ──触发技能──→ SkillDef.validate + orchestrate ──返回 atom 序列──→ 栈驱动执行引擎 ──→ GameState
```

三层职责：

| 层 | 职责 | 知道什么 | 不知道什么 |
|---|---|---|---|
| 客户端 | 表达意图 | 用什么技能、用什么牌、对谁 | atom、state 内部结构 |
| 技能（SkillDef） | 验证合法性 + 编排 atom 序列 | 这件事合不合法、应该产生什么效果 | 其他技能的存在 |
| Atom | 最小状态变更 | 怎么改 state | 为什么被调用、谁在调用 |

核心不变量：**所有状态变更必经栈驱动执行引擎**。

## 2. 客户端协议

客户端发送 `ClientMessage`，只有三种：

```ts
type ClientMessage =
  | { type: '使用技能'; skillId: string; params: Record<string, Json>; baseSeq: number }
  | { type: '选择'; choice: Json; baseSeq: number }
  | { type: '开始' };
```

`params` 由各技能自行定义和消费，引擎不解释其内容：
- 杀：`{ cardId: 'c42', targets: ['P2'] }`
- 方天画戟杀：`{ cardId: 'c42', targets: ['P2', 'P3', 'P4'] }`
- 仁德：`{ cardIds: ['c12', 'c17'], target: 'P3' }`
- 制衡：`{ cardIds: ['c5', 'c9'] }`
- 装备：`{ cardId: 'c33' }`
- 结束回合：`{}`

"使用杀"、"使用桃"、"出闪响应"都是 `使用技能`。区别只是 `skillId` 和 `params` 内容。

"遗计选牌分配"、"弃牌阶段选牌"都是 `选择`。客户端在 pending 状态下收到可选项，做出选择后提交。

不存在 `GameAction` 类型。不存在 `打出一张牌`/`打出`/`弃置` 等离散 action。

## 3. 牌

牌是**令牌**（token），只有属性：

```ts
interface Card {
  id: string;
  name: string;         // '杀' | '闪' | '桃' | '无中生有' | ...
  suit: '♠' | '♥' | '♣' | '♦';
  rank: number;
  type: '基本牌' | '锦囊牌' | '装备牌';
  subtype?: string;     // 装备: '武器' | '防具' | '进攻马' | '防御马'; 基本: '火杀' | '雷杀'
}
```

牌不携带行为。"使用杀的效果是什么"属于技能定义，不属于牌。

## 4. 技能

### 4.1 API 设计——顶层函数 + tree-shaking

技能 API 分两层：
1. **顶层函数**：`createSkill`、`validate`、`onInit`、`orchestrate`——前后端都存在，按构建目标替换为真实实现或 no-op
2. **`onMount` 回调的 `api` 参数**：`onAtomView`/`showAction`/`hideAction`/`playEffect`/`onPendingChange`——仅前端有意义

```ts
// ── 顶层函数（前后端共享，构建时 tree-shaking） ──

/** 创建技能 token */
export function createSkill(id: string, ownerId: string): Skill;

/** 同步校验。直接调用，不注册。前后端同一个函数 */
export function validate(skill: Skill, view: GameView, params: Record<string, Json>): string | null;

/** 钩子初始化。后端实现，前端构建替换为 no-op → 回调体被 tree-shake */
export function onInit(skill: Skill, reg: HookRegister): () => void;

/** 编排函数。后端实现，前端构建替换为 no-op → 回调体被 tree-shake */
export function orchestrate(skill: Skill, ctx: SkillContext, state: GameState): SkillPhase[];

/** 前端挂载逻辑。前端实现，后端构建替换为 no-op → 回调体被 tree-shake */
export function onMount(skill: Skill, api: FrontendAPI): () => void;
```

```ts
/** 前端 API（传入 onMount 回调） */
interface FrontendAPI {
  /** 当前观察者 */
  viewer: string;

  /** 监听 atom，前端收到 atom log 时触发 */
  onAtomView(atomType: string, handler: (atom: Atom, view: GameView) => void): () => void;

  /** 在操作区显示操作按钮 */
  showAction(actionId: string, opts: {
    label: string;
    style?: 'primary' | 'danger' | 'default' | 'passive';
    prompt: ActionPrompt;
  }): void;

  /** 隐藏操作按钮 */
  hideAction(actionId: string): void;

  /** 播放动画/音效 */
  playEffect(effect: AtomEffect): void;

  /** 监听 pending 状态变化 */
  onPendingChange(handler: (pending: PendingView | null, view: GameView) => void): () => void;
}
```

```ts
interface Skill {
  ownerId: string
  name: string
  description: string
}
/** 后端钩子注册 API（传入 onInit 回调） */
interface HookRegister {
  onAtomBefore(atomType: string, handler: (ctx: HookContext) => HookResult | void): () => void;
  onAtomAfter(atomType: string, handler: (ctx: HookContext) => HookResult | void): () => void;
}

interface SkillContext {
  skillId: string;
  self: string;
  params: Record<string, Json>;
  localVars: Record<string, Json>;
  choice?: Json;
}
```

**tree-shaking 原理**：
- 前端构建：不引用 `onInit`/`orchestrate`, 成为死代码被 tree-shake
- 后端构建：不引用 `onMount`, 被 tree-shake
- `validate`/`createSkill` 前后端都保留

### 4.2 ActionPrompt——前端交互声明

`showAction` 的 `prompt` 参数声明前端需要的输入。前端按字段渲染：有 `cardSelection` 渲染可选牌，有 `targetSelection` 渲染可选角色，有 `options` 渲染按钮。

```ts
interface ActionPrompt {
  title: string;
  description?: string;
  cardSelection?: CardSelection;
  targetSelection?: {
    min: number;
    max: number;
    filter?: (view: GameView, target: string) => boolean;
  };
  options?: { label: string; value: Json; style?: 'primary' | 'danger' | 'default' }[];
  defaultChoice?: Json;
  timeout?: number;
}

interface CardSelection {
  filter?: (card: Card) => boolean;
  min: number;
  max: number;
}
```

### 4.3 前端工作流

前端不主动查询"该显示什么"。所有 UI 变化由 atom 驱动：

1. 前端收到新的 `AtomLogEntry`
2. 所有已注册的 `onAtomView` 监听器触发
3. 监听器根据 atom 内容和 GameView 状态调用 `showAction`/`hideAction`/`playEffect`
4. pending 变化时 `onPendingChange` 触发，更新等待输入的 UI
5. 玩家点击操作按钮 → 前端调 `validate(skill, view, params)` 校验 → 构造 `ClientMessage` 提交

`validate` 是**同步调用**（不注册），前后端同一个函数。前端在提交前本地校验，后端收到后再次校验。

**为什么不用声明式查询（getPrompt）**：
- 前端不知道何时该调用——被动技能触发、技能执行中的子步骤、规则强制行为，时机不是"技能按钮"能表达的
- 八卦阵的"是否发动"是钩子内部 pending，不是技能入口
- 遗计分配是执行过程中的交互，不是触发阶段
- 弃牌是规则强制，不是任何技能
- 响应式（atom 驱动 UI）统一覆盖所有场景

### 4.4 GameView——前后端共用的游戏视图

```ts
interface GameView {
  viewer: number;
  currentPlayerIndex: number;
  phase: TurnPhase;
  turn: { killsPlayed: number; skillsUsed: string[] };
  players: {
    health: number;
    maxHealth: number;
    alive: boolean;
    equipment: Partial<Record<EquipSlot, string>>;
    skills: string[];
    handCount: number;
    hand?: Card[];
  }[];
  cardMap: Record<string, Card>;
  stack: StackFrame[];
  pending: PendingView | null;
}
```

后端从 `GameState` 派生 `GameView`：公开信息直接映射；`viewer` 的手牌完整暴露，其他玩家只给 `handCount`；不含 `availableSkills`——前端 UI 由技能的 `onAtomView` 监听器驱动。

前后端共用 `validate` 的前提：技能发动条件只依赖公开信息 + 自身手牌，不依赖其他玩家的私有信息。三国杀满足此条件。

### 4.5 示例

```ts
// skills/杀。ts
// ── 杀——主动卡牌技能 ──
export function createSkill(id) {
  return {id, name: '杀', description: '...'}
};

export function validate() {}

export function orchestrate(杀, ctx, state) {
  return [
    { type: 'atoms', atoms: [{ type: '移动牌', cardId: ctx.params.cardId, from: { zone: '手牌', player: ctx.self }, to: { zone: '弃牌堆' } }] },
    { type: 'foreach', targets: ctx.params.targets, body: (target) => [
      { type: 'atoms', atoms: [{ type: '推入待定', action: 杀响应窗口(target) }] },
      { type: 'if', condition: (s) => !wasDodged(s), then: [
        { type: 'atoms', atoms: [{ type: '造成伤害', target, amount: 1, source: ctx.self }] },
      ]},
    ]},
    { type: 'atoms', atoms: [{ type: '累计出杀' }] },
  ]
}

export function onInit() {}

export function onMount(杀, api) {
  const off1 = api.onAtomView('阶段开始', (atom, view) => {
    if (atom.player === api.viewer && atom.phase === '出牌阶段') {
      const hand = view.players[api.viewer].hand;
      if (hand?.some(id => view.cardMap[id]?.name === '杀')) {
        api.showAction('杀', {
          label: '杀', style: 'primary',
          prompt: {
            title: '选择杀和目标',
            cardSelection: { filter: (c) => c.name === '杀', min: 1, max: 1 },
            targetSelection: { min: 1, max: 3, filter: (v, t) => isInAttackRange(v, api.viewer, t) },
          },
        });
      }
    }
  });

  const off2 = api.onAtomView('阶段结束', (atom, view) => {
    if (atom.player === api.viewer && atom.phase === '出牌阶段') {
      api.hideAction('杀');
    }
  });

  return () => {
    off1();
    off2();
  }
}

// skills/八卦阵.ts
// ── 八卦阵——被动武将技能 ──
export function createSkill(id) {
  return {id, name: '八卦阵 description: '...'}
};

export function validate() {}

export function orchestrate(八卦阵, ctx, state) {
  return [
  ]
}

export function onInit(八卦阵, reg) {
  const {currentPlayer} = 八卦阵;

  const off = reg.onAtomBefore('响应杀',
    (ctx) => {
      if (currentPlayer !== ctx.atom.target) return;

      const result = ctx.state.localVars['bagua:judgeResult'];
      if (!result) return { additionalAtoms: [{ type: '判定', player: currentPlayer }], resumeHook: true };
      if (result === 'red') return { cancel: true };
      return {};
    },
  );
  return off;
}

export function onMount(八卦阵, api) {
  const off1 = api.onAtomView('询问闪', (atom, view) => {
    if (atom.target === api.viewer && is杀(atom)) {
      api.showAction('八卦阵', {
        label: '发动八卦阵', style: 'passive',
        prompt: { title: '是否发动八卦阵？', options: [
          { label: '发动', value: true, style: 'primary' },
          { label: '不发动', value: false },
        ]},
      });
    }
  });

  const off2 = api.onAtomView('判定', () => {
    api.playEffect({ sound: 'judge', animation: 'flip', blockUntilDone: true, duration: 600 });
  });
}
```

`onInit`/`onMount` 返回的取消函数在技能销毁时调用，清理所有注册的钩子和监听。

### 4.6 引擎技能分类 vs 三国杀技能分类

三国杀规则中技能分为锁定技、主动技、被动技、觉醒技、限定技、主公技等，这些是规则层面的分类。引擎的 API 是实现层面的分类，两者正交：

| 三国杀规则分类 | 引擎实现 | API 调用 |
|---|---|---|
| **锁定技** | `onAtomBefore/After` 无条件执行 | `onInit(..., reg => reg.onAtomAfter(...))` |
| **主动技** | `showAction` + `validate` + `orchestrate` | `onMount(..., api => api.onAtomView(...))` + `orchestrate(...)` |
| **被动技** | `onAtomBefore` + pending + `showAction` | `onInit(...)` + `onMount(..., api => api.showAction(...))` |
| **限定技** | `validate` 检查次数 | `validate(...)` + Mark |
| **主公技** | `validate` 检查身份 | `validate(...)` |

- 锁定技 = 钩子 + 无 pending（自动执行）
- 被动技 = 钩子 + 有 pending + showAction（等待玩家选择）
- 觉醒技/限定技不是独立引擎类型，而是 validate + Mark 的语义约束

### 4.7 编排（SkillPhase）

`orchestrate` 返回 `SkillPhase[]`，引擎逐个执行：

```ts
type SkillPhase =
  | { type: 'atoms'; atoms: Atom[] }
  | { type: 'prompt'; text: string; options: PromptOption[]; defaultChoice?: Json; timeout?: number }
  | { type: 'if'; condition: (state: GameState) => boolean; then: SkillPhase[]; else?: SkillPhase[] }
  | { type: 'foreach'; targets: string[]; body: (target: string) => SkillPhase[] }
  | { type: 'multiStep'; steps: SkillPhase[][] }
  | { type: '拼点'; initiator: string; target: string; onSuccess: SkillPhase[]; onFailure: SkillPhase[] };
```

- `atoms`：直接产生 atom 序列
- `prompt`：暂停等待玩家选择，选择结果注入 `ctx.choice`
- `if`/`foreach`：控制流
- `multiStep`：多步交互（遗计：摸2张 → prompt分配 → giveCard）
- `拼点`：拼点（双方同时揭示）
- `delegate`：委托另一个技能的编排（见下）

### 4.8 技能委托

`orchestrate` 可以委托另一个技能的编排：

```ts
import * as 杀 from './杀.ts'
// 武圣：红色牌当杀使用
const 武圣 = createSkill('武圣', { name: '武圣', description: '...' });

orchestrate(武圣, (ctx, state) => 杀.orchestrate(武圣, { ...ctx, skillId: '杀', params: ctx.params }, state));
```

委托时跳过被委托技能的 `validate`——`validate` 只在入口处调用一次。委托链中只有第一个技能的 `validate` 生效。约束：不能委托自身，实际不超过 2 层（武圣→杀、龙胆→闪）。委托是编排复用，不是技能嵌套。

## 5. Atom

Atom 是最小的状态变更单元。不可再分。

```ts
type Atom =
  // 卡牌/资源
  | { type: '摸牌'; player: string; count: number }
  | { type: '弃牌'; player: string; cardId: string }
  | { type: '移动牌'; cardId: string; from: CardLocation; to: CardLocation }
  | { type: '获得'; player: string; cardId: string; from?: string }
  | { type: '给予'; cardId: string; from: string; to: string }
  | { type: '抽牌'; player: string; cardId: string }
  | { type: '装备'; player: string; cardId: string }
  | { type: '卸下'; player: string; slot: EquipSlot }
  | { type: '洗牌' }
  | { type: '重洗' }
  | { type: '整理牌堆'; cards: string[] }
  // 角色状态
  | { type: '造成伤害'; target: string; amount: number; source: string; damageType?: DamageType }
  | { type: '回复体力'; target: string; amount: number; source: string }
  | { type: '失去体力'; target: string; amount: number }
  | { type: '击杀'; player: string }
  | { type: '设上限'; player: string; amount: number }
  // 标记/状态
  | { type: '加标记'; player: string; mark: Mark }
  | { type: '去标记'; player: string; markId: string }
  | { type: '清过期标记'; player: string }
  | { type: '设横置'; player: string; chained: boolean }
  | { type: '加标签'; player: string; tag: string }
  | { type: '去标签'; player: string; tag: string }
  // 技能
  | { type: '加技能'; player: string; skillId: string }
  | { type: '去技能'; player: string; skillId: string }
  // 流程
  | { type: '回合开始'; player: string }
  | { type: '回合结束'; player: string }
  | { type: '阶段开始'; player: string; phase: string }
  | { type: '阶段结束'; player: string; phase: string }
  | { type: '设阶段'; phase: string }
  | { type: '下一玩家' }
  | { type: '累计出杀' }
  // 变量
  | { type: '设置变量'; key: string; value: Json }
  | { type: '增加变量'; key: string; delta: number }
  | { type: '清空变量' }
  | { type: '设置上下文变量'; key: string; value: Json }
  // 目标/响应
  | { type: '指定目标'; player: string; cardId: string; target: string }
  | { type: '成为目标'; player: string; cardId: string; target: string }
  | { type: '解决'; player: string; cardId: string; target?: string }
  | { type: '出牌'; player: string; cardId: string; target?: string }
  | { type: '杀命中'; attacker: string; defender: string; cardId: string }
  | { type: '杀被闪避'; attacker: string; defender: string }
  // 判定
  | { type: '判定'; player: string; judgeType: string }
  | { type: '添加延时锦囊'; player: string; trick: PendingTrick }
  | { type: '移除延时锦囊'; player: string; trickName: string }
  // 拼点/比较
  | { type: '拼点'; initiator: string; target: string; initiatorCard: string; targetCard: string }
  // 待定
  | { type: '推入待定'; action: PendingAction }
  | { type: '弹出待定' }
interface AtomDefinition<A = unknown> {
  type: string;

  // ── 后端 ──

  /** 验证：这个 atom 在当前 state 下合法吗？返回 null = 合法 */
  validate(state: GameState, atom: A): string | null;

  /** 执行：修改 state，返回新 state（纯函数） */
  apply(state: GameState, atom: A): GameState;

  /** 可选：apply 后提取结果，注入编排上下文 */
  getResult?(state: GameState, atom: A): Record<string, Json>;

  // ── 前后端共用 ──

  /** 可选：per-player 可见性分叉。不实现 = 所有人看到同一个 atom */
  toPlayerViews?(state: GameState, atom: A): AtomPlayerViews | undefined;

  // ── 前端 ──

  /** 可选：视觉/音效反馈声明。前端按 atom type 查表播放 */
  effect?: AtomEffect;
}
```

```ts
/** 动画/音效——前后端定义放一起，方便维护和扩展 */
interface AtomEffect {
  /** 播放的音效 ID */
  sound?: string;             // 'slash_hit' | 'dodge' | 'damage_fire' | 'heal' | ...
  /** 角色动画 */
  animation?: string;         // 'shake' | 'flash' | 'flip' | 'slide' | ...
  /** 全屏效果 */
  screenEffect?: string;      // 'shake' | 'flash_red' | 'lightning' | ...
  /** 粒子效果 */
  particles?: string;         // 'fire' | 'thunder' | 'ice' | 'blood' | ...
  /** 动画时长（毫秒），0 = 无动画 */
  duration?: number;
  /** 音量（0-1） */
  volume?: number;
  /** 是否等待动画结束再继续处理（前端阻塞） */
  blockUntilDone?: boolean;
}
```

前端工作流：
1. 收到新的 `AtomLogEntry`，按 `atom.type` 查 `AtomDefinition.effect`
2. 按 effect 声明播放动画/音效
3. 如果 `blockUntilDone` = true，等待动画结束再更新 UI 状态

示例：
- **造成伤害**：`{ sound: 'damage_physical', animation: 'shake', particles: 'blood', duration: 400 }`
- **造成伤害（火）**：`{ sound: 'damage_fire', animation: 'shake', particles: 'fire', duration: 500 }`
- **摸牌**：`{ sound: 'draw', animation: 'slide', duration: 200 }`
- **杀命中**：`{ sound: 'slash_hit', screenEffect: 'flash_red', duration: 300, blockUntilDone: true }`
- **杀被闪避**：`{ sound: 'dodge', animation: 'flip', duration: 200 }`
- **判定**：`{ sound: 'judge', animation: 'flip', blockUntilDone: true }`
- **回复体力**：`{ sound: 'heal', particles: 'ice', duration: 300 }`

Atom 不知道为什么被调用、谁在调用。`validate` 做数据级检查（"target 存不存在"），`apply` 做状态变更（"扣血"），`effect` 声明前端反馈（"扣血动画"）。三者同文件定义，修改 atom 时不会忘改效果。

```ts
/** 可见性分叉（元组） */
type AtomPlayerViews = readonly [
  ownerViews: ReadonlyMap<string, Atom>,
  defaultView: Atom | null,
];
```

## 6. 栈驱动执行引擎

### 6.1 执行栈

```ts
interface StackFrame {
  /** 当前处理的 atom */
  atom: Atom;
  /** 执行阶段 */
  phase: 'validate' | 'apply' | 'hooks' | 'done';
  /** hooks 阶段：当前处理到第几个钩子 */
  hookIndex: number;
  /** 缓存的钩子列表 */
  hooks: AtomHook[];
  /** 来源技能（调试用） */
  sourceSkillId?: string;
}

/** 编排帧：跟踪 orchestrate 返回的 SkillPhase[] 执行进度 */
interface OrchestrationFrame {
  /** 所属技能 ID */
  skillId: string;
  /** 完整的 phase 序列 */
  phases: SkillPhase[];
  /** 当前执行到第几个 phase */
  phaseIndex: number;
  /** foreach 迭代器状态 */
  foreachState?: { targets: string[]; targetIndex: number; bodyPhases: SkillPhase[]; bodyIndex: number };
  /** 技能上下文 */
  ctx: SkillContext;
}
```

`GameState.stack` 存储执行栈。栈顶 = 当前正在处理的 atom。

`GameState.orchestrationStack` 存储编排栈，跟踪每个技能编排的执行进度。prompt 暂停时，编排帧记录当前 phaseIndex，resume 后从下一个 phase 继续。

### 6.2 执行循环

```
while (stack 非空) {
  frame = stack.top

  switch (frame.phase) {
    case 'validate':
      error = atomDef.validate(state, frame.atom)
      if (error) → 标记取消，弹出
      else → phase = 'apply'

    case 'apply':
      state = atomDef.apply(state, frame.atom)
      写 AtomLogEntry 到 serverLog, seq++
      phase = 'hooks'

    case 'hooks':
      查下一个钩子
      if 无剩余 → phase = 'done'
      if cancel → 标记取消，弹出
      if additionalAtoms → 保存现场，additionalAtoms 逆序压栈（最后一个先处理）
      if pending → 栈暂停，等客户端 resume
      if replace(state, atom) → 更新 frame.atom，phase 回到 'validate'（重新校验替换后的 atom）

    case 'done':
      弹出栈顶
      检查编排帧：如果当前 atom 是编排产生的最后一个，推进 phaseIndex
      如果编排帧还有剩余 phase → 继续展开下一个 phase
}
```

### 6.3 编排执行

技能的 `orchestrate` 返回 `SkillPhase[]`，引擎逐个展开为 atom 压入执行栈：

- `atoms`：直接将 atom 序列逆序压栈
- `prompt`：构造一个特殊的 `推入待定` atom 压栈，pending 暂停；resume 时 choice 注入 `ctx.choice`，编排帧推进到下一个 phase
- `if`：求值 condition，选择 then/else 分支的 phase 序列，继续展开
- `foreach`：展开第一个 target 的 body phases，推进迭代器；第一个 target 的 atoms 全部 done 后展开第二个 target
- `multiStep`：展开第一步，done 后展开第二步
- `拼点`：展开拼点 atom，done 后根据结果选择 then/else
- `delegate`：委托另一个技能的 `orchestrate`，将其返回的 phases 接入当前编排帧

编排帧通过 `orchestrationStack` 管理。prompt 暂停时帧的 `phaseIndex` 保持，resume 后继续。

### 6.4 栈与 Pending 的统一

Pending 不是独立的 pending 状态机，而是**栈暂停**：

- `推入待定` atom 的 apply → 在栈顶设置"等待输入"标记
- 客户端发 `选择` → resume 栈顶，注入选择结果，继续循环
- onTimeout → 自动注入默认选择，resume 栈

### 6.5 钩子（被动技能）

```ts
interface AtomHook {
  id: string;
  atomType: string;
  player?: string;
  filter?: (state: GameState, atom: Atom, self: string) => boolean;
  onBefore?: (ctx: HookContext) => HookResult | void;
  onAfter?: (ctx: HookContext, localVars?: Record<string, Json>) => HookResult | void;
}

interface HookContext {
  state: GameState;
  atom: Atom;
  self: string;
  logEntry: AtomLogEntry;
}

type HookResult =
  | { cancel: true }
  | { atom: Atom }                         // 替换当前 atom
  | { state: GameState }                   // 修改 state
  | { redirect: string }                   // 重定向目标
  | { additionalAtoms: Atom[] }            // 产生子 atom 序列
  | { additionalAtoms: Atom[]; resumeHook: true }  // 子 atom 完成后重入此钩子
  | { pending: true };                     // 栈暂停，等外部输入
```

钩子执行规则：
- 同 `atomType` 下按注册顺序触发
- `filter` 不通过 → 跳过
- 第一个 `onBefore` 返回 `cancel: true` → 整个 atom 取消
- `onAfter` 返回 `additionalAtoms` → 逆序压栈，按栈机制逐个处理
- 钩子产生的 atom 不再触发同级钩子（防无限递归）

### 6.6 钩子重入

有些被动技能需要"先执行子操作，再根据结果决定行为"——如八卦阵需要先判定，再根据判定结果 cancel。

钩子返回 `{ additionalAtoms: [...], resumeHook: true }` 时，引擎在子 atom 序列全部执行完毕后，**重新调用同一个钩子的 `onBefore`/`onAfter`**。钩子通过 `localVars` 读取子操作的结果。

```
// 八卦阵 onBefore（第一次调用）
onBefore(ctx) {
  const result = ctx.state.localVars['bagua:judgeResult'];
  if (!result) {
    // 还没判定，请求判定并挂起重入
    return { additionalAtoms: [{ type: '判定', player: ctx.self }], resumeHook: true };
  }
  // 第二次调用：有判定结果了
  if (result === 'red') return { cancel: true };
  return {};  // 黑色，不 cancel
}
```

重入约束：
- 钩子最多重入 1 次（防止无限循环）
- 第二次调用时 `localVars` 包含子操作产生的数据
- 重入时 `HookContext.localVars` 参数传入子操作的 `getResult` 汇总

## 7. GameState

```ts
interface GameState {
  /** 玩家数组，索引 = 座次。players[0] = 主公座位 */
  players: PlayerState[];
  /** 当前行动玩家索引 */
  currentPlayerIndex: number;
  /** 当前阶段 */
  phase: TurnPhase;
  /** 回合状态（切换回合/阶段时自动清理，见 §7.3） */
  turn: TurnState;

  /** 牌区 */
  zones: {
    /** 牌堆（牌 ID 列表，末尾 = 堆顶） */
    deck: string[];
    /** 弃牌堆 */
    discardPile: string[];
  };
  /**
   * 牌定义查找表。key = cardId，贯穿整局游戏不变。
   * 手牌/装备/弃牌堆等位置只存 ID，需要属性（名称/花色/点数）时通过 cardMap 查。
   */
  cardMap: Record<string, Card>;
  /** RNG 种子（确定性随机） */
  rngSeed: number;

  /** 服务端完整 atom 日志 */
  serverLog: AtomLogEntry[];
  /** 每个玩家可见的 log entry ID */
  playerLogs: Record<number, string[]>;  // key = 玩家索引

  /** 执行栈 */
  stack: StackFrame[];
  /** 待定状态（栈暂停时的上下文） */
  pending: PendingAction | null;

  /** Mark 体系：所有持续状态 */
  marks: Mark[];
  /**
   * 全局上下文变量。跨 atom 共享的中间状态（如判定结果 baguaJudgeResult）。
   * 钩子之间通过 localVars 传递数据，用 `hookId:key` 做 namespace 避免冲突。
   */
  localVars: Record<string, Json>;
  /** 元信息 */
  meta: GameMeta;
  /** CAS 序列号，详见 §7.6 */
  seq: number;
  /** 游戏开始时刻（毫秒偏移），所有 timestamp 相对于此 */
  startedAt: number;
}
```

### 7.1 玩家

```ts
interface PlayerState {
  /** 座位索引（= 数组下标，不可变） */
  index: number;
  /** 玩家名称 */
  name: string;
  /** 角色名（如 '曹操'） */
  character: string;
  health: number;
  maxHealth: number;
  alive: boolean;

  /** 手牌 ID 列表 */
  hand: string[];
  /** 装备区 */
  equipment: Partial<Record<EquipSlot, string>>;
  /** 判定区的延时锦囊 */
  pendingTricks: PendingTrick[];
  /** 已拥有的技能 ID 列表 */
  skills: string[];

  /**
   * 玩家私有变量。按 scope 命名：
   * - '裸衣/active'：技能开关
   * - '马术/距离修正'：距离修正
   * - 'xxx/usedThisTurn'：每回合自动清理
   */
  vars: Record<string, Json>;
}
```

`players` 是数组，索引即座次。计算距离 = `min(|i - j|, N - |i - j|)`。不再需要 `playerOrder`。

### 7.2 变量作用域

| 变量 | 位置 | 生命周期 | 用途 |
|---|---|---|---|
| `state.localVars` | GameState | 跨 atom 持久，回合结束可清理 | 钩子间传递中间状态（判定结果） |
| `player.vars` | PlayerState | 跨 atom 持久，按 key 后缀自动清理 | 玩家私有状态（技能开关、距离修正） |
| `ctx.localVars` | SkillContext | 单次技能编排内 | 编排阶段间传递（拼点结果、选牌 ID） |
| `ctx.params` | SkillContext | 单次技能编排内 | 客户端传入的参数 |

### 7.3 自动清理

回合/阶段切换时自动清理过期变量，避免手动管理：

```ts
interface TurnState {
  /** 当前回合数（从1开始） */
  round: number;
  /** 本回合已使用杀的次数 */
  killsPlayed: number;
  /** 本回合已使用的技能 */
  skillsUsed: string[];
}
```

自动清理规则：
- **回合结束**：清空 `killsPlayed`、`skillsUsed`；清理所有玩家 `vars` 中 key 以 `/usedThisTurn` 结尾的变量；清理 `localVars` 中钩子 namespace 下的临时数据
- **阶段切换**：按需清理（如弃牌阶段结束清理弃牌相关临时数据）
- **Mark 过期**：检查 `duration` 字段，`'turn'` = 回合结束过期，`'round'` = 一轮结束过期，`number` = N 个回合后过期

### 7.4 Mark 体系

所有"持续状态"都是 Mark，不走 PlayerState 独立字段：

```ts
interface Mark {
  id: string;       // 'chained' | 'faceDown' | 'cannotDodge' | ...
  scope: number;    // 玩家索引（-1 = 全局）
  payload?: Json;
  duration?: 'turn' | 'round' | number;
}
```

### 7.5 相对时间

所有时间戳使用**相对于游戏开始的偏移量**（毫秒），不存绝对时间：

- `startedAt`：游戏开始时的 `Date.now()`，存一次
- `AtomLogEntry.timestamp`：`Date.now() - state.startedAt`
- `pending.deadline`：相对于 `startedAt` 的偏移

好处：重放时不受系统时钟影响，可加速/暂停；存档跨时区一致；测试可完全确定性。

### 7.6 CAS 序列号

`seq` 是全局单调递增计数器，每次 atom 写入 serverLog 时 +1。用于解决多人并发操作的状态同步问题。

**问题**：多个玩家可能在同一响应窗口并发响应（如无懈可击链）。客户端发操作时看到的是某个 serverLog 快照；请求到达服务端前，服务端可能已因别的玩家操作而推进。基于旧快照的决策在新状态下可能不合法。

**机制**：

```
客户端                                      服务端
  │                                          │
  │  ClientMessage { baseSeq: 5, ... }  ──→  │
  │                                          │  CAS: state.seq === 5 ? ✓ : ✗
  │                                          │  ✓ → 处理操作，seq 推进到 6
  │  ←──  events [{ seq: 6, ... }]          │
  │                                          │
  │  ClientMessage { baseSeq: 3, ... }  ──→  │
  │                                          │  CAS: state.seq === 3 ? ✗ (当前是 6)
  │                                          │  静默丢弃，不返回错误
  │  ←──  events [其他玩家操作导致的更新]      │
```

1. `ClientMessage` 携带 `baseSeq`：客户端发出操作时附上当前看到的 `seq` 值
2. 服务端 CAS 校验：`baseSeq !== state.seq` 时**静默丢弃**，不发 error
3. 客户端通过后续 `events` 推送自动看到最新状态，旧操作自然"消失"
4. `validate` 是第二道关卡：CAS 通过后仍会拦截"操作本身非法"

**为什么静默丢弃**：CAS 失败的本质是"状态已推进，旧操作无意义"，不是错误。前端不需要弹错提示。

**seq 推进时机**：每次 atom apply 完成并写入 serverLog 时 `seq++`。包括：
- 玩家主动操作的 atom
- 钩子产生的 additionalAtoms
- pending 推进（换 responder、关闭窗口）

**断线重连**：重连后服务端发送 `lastSeq` 之后的所有 events，客户端回放到最新状态，后续操作自然带上正确的 `baseSeq`。

## 8. 日志

```ts
interface AtomLogEntry {
  /** 全局单调递增 ID */
  id: string;        // evt-N
  /** 相对时间戳（毫秒，相对于 startedAt） */
  timestamp: number;
  /** resolved atom（Expr 已求值） */
  atom: Atom;
}
```

serverLog 存 `AtomLogEntry[]`。重放直接循环 `applyAtom`，不需要第二个实现。

per-player 可见性通过 `toPlayerViews` 分叉。不分叉的 atom 所有人看到同一个。

## 9. 文件结构

```
src/engine/
  atom.ts              # 栈驱动执行引擎
  atom-registry.ts     # atom 注册表
  skill.ts             # 技能注册表
  skill-hook.ts        # HookRegistry
  validate.ts          # 阶段级守卫（薄层）
  event.ts             # makeLogEntry
  types.ts             # 所有类型定义
  create-engine.ts     # createEngine 工厂

  atoms/               # atom 定义（每个文件一个 atom）
    damage.ts
    draw.ts
    heal.ts
    ...

  skills/              # 技能定义（每个文件一个技能）
    杀.ts              # 卡牌技能
    桃.ts
    无中生有.ts
    遗计.ts            # 武将技能
    反馈.ts
    八卦阵.ts          # 被动技能（registerHooks）
    ...

  equipment/           # 装备被动技能
    bagua.ts
    wansha.ts
    ...

  phases/              # SkillPhase 执行器
    prompt.ts
    multiStep.ts
    拼点.ts
    ...

  view/
    reducer.ts          # 客户端视图 reducer（atom 驱动）

src/server/
  session.ts            # 网络会话，栈暂停/resume
  protocol.ts           # ClientMessage 定义
```

## 10. 不存在的东西

以下概念在新设计中**不存在**：

| 已删除 | 原因 |
|---|---|
| `GameAction` | 统一为 `ClientMessage` |
| `ServerEvent` / `PlayerEvent` | 统一为 `AtomLogEntry` + `AtomPlayerViews` |
| `card-handlers.ts` | 卡牌使用是技能，逻辑在 `SkillDef.orchestrate` |
| `validateAction`（数据级） | 下放到 `SkillDef.validate` 和 `AtomDefinition.validate` |
| `emitEvent` / `registerCharacterTriggers` | v2 已清除 |
| `applyAtomsAsync` / `AsyncEngine` | 栈暂停取代异步 hook |
| `MAX_HOOK_RECURSION` | 栈深度由 `stack.length` 限制 |
| `skipHooks` 参数 | 通过规则控制（钩子产生的 atom 不触发同级钩子） |
| `PendingResponseWindow` 等独立 pending 类型 | 统一为栈暂停 + `ClientMessage.选择` |


## 11. 场景推演

### 场景 A：杀 → 八卦阵判定 → cancel

```
编排帧: 杀.orchestrate → [移动牌, 推入待定(杀响应), 累计出杀]

栈执行:
  1. 移动牌 → validate ✓ → apply → hooks(无) → done → 编排帧推进
  2. 推入待定(杀响应窗口, target=P2) → apply → 栈暂停
     → 客户端 P2 收到提示：出闪或不出
     → P2 不出闪
     → resume → 推入待定 done → 编排帧推进
  3. 累计出杀 → done → 编排帧推进
  4. 编排帧推进到 damage 阶段（杀命中编排产生 [造成伤害]）

  造成伤害 → validate → apply → hooks
    八卦阵钩子 onBefore（第1次）:
      localVars 无判定结果 → 返回 { additionalAtoms: [判定atom], resumeHook: true }
      判定压栈 → apply（翻牌堆顶）→ getResult 写入 localVars.bagua:judgeResult → done → 弹出
    八卦阵钩子 onBefore（重入，第2次）:
      localVars 有结果 → 红色 → 返回 { cancel: true }
    造成伤害取消
```

钩子重入解决了"判定 → 拿结果 → 决定 cancel"的需求。

### 场景 B：南蛮入侵 → 逐个响应

```
编排帧: 南蛮入侵.orchestrate → [移动牌, foreach([P2, P3, P4], t => [推入待定(AOE杀响应, t)])]

栈执行:
  1. 移动牌 → done → 编排帧推进到 foreach
  2. foreach 展开 target=P2 → [推入待定(AOE杀响应, P2)] 压栈
     推入待定 apply → 栈暂停
     → P2 出杀 → resume → done → 编排帧 foreach 推进到 target=P3
  3. foreach 展开 target=P3 → [推入待定(AOE杀响应, P3)] 压栈
     → P3 没有杀 → resume(choice=不出) → done → 编排帧 foreach 推进到 target=P4
  4. foreach 展开 target=P4 → 同上
  5. foreach 所有 target 处理完 → 编排帧推进
  6. 后续：对没出杀的目标 [造成伤害] 逐个压栈
```

编排帧的 `foreachState` 追踪当前 target 索引。每个 target 的 atoms 全部 done 后才展开下一个 target。

### 场景 C：无懈可击链（嵌套 pending）

```
栈: [推入待定(决斗响应窗口, P2)]
  → 栈暂停，等 P2 响应
  → P3 持有无懈可击，决定发动
  → 客户端 P3 发 { type: '使用技能', skillId: '无懈可击', baseSeq }
  → CAS ✓ → 无懈可击.orchestrate → [推入待定(无懈可击响应窗口)]
    压栈: [推入待定(决斗), 推入待定(无懈响应)]
    推入待定(无懈响应) → apply → 栈暂停
    → 等 P4 是否无懈可击（嵌套）
    → P4 不发动 → resume → done → 弹出
  → 回到决斗响应窗口
    无懈可击生效 → 决斗响应窗口取消（被无懈）
```

嵌套 pending 自然工作。栈深度 = 嵌套层数，每层 resume 后继续。

### 场景 D：伤害 → 遗计（摸2张 → 分配）→ 反馈（拿牌）

```
栈: [造成伤害{hooks}]
  遗计 onAfter → additionalAtoms: [摸牌{count:2}]
    摸牌压栈 → apply → done → 弹出
  遗计 onAfter（重入）→ localVars 有摸牌结果
    → 返回 additionalAtoms: [prompt分配]
    prompt 压栈 → pending → 栈暂停
    → 郭嘉玩家选择分配方案 → resume
    → 返回 additionalAtoms: [giveCard×N]
    giveCard 逐个压栈 → done → 弹出
  遗计处理完毕

  反馈 onAfter → additionalAtoms: [获得牌]
    压栈 → done → 弹出
  所有钩子处理完 → 造成伤害 done → 弹出
```

同一 atom 的多个钩子按注册顺序处理。第一个钩子的 additionalAtoms 全部完成后才处理第二个钩子。

### 场景 E：状态变更后替换 atom

```
栈: [成为目标{hooks}]
  大乔 onBefore → 返回 { atom: { type: '成为目标', ...redirected } }
  → frame.atom 更新，phase 回到 'validate'
  → validate 新 atom → apply → hooks(无) → done
```

`redirect` 变体：某些技能不 cancel，而是替换 atom 或重定向目标。替换后重新 validate 确保新 atom 合法。