# CLAUDE.md

## 项目概述

三国杀数字卡牌游戏。React + TypeScript + Hono + Vite。

## 命名规则

> **判断口诀**：先看是不是"业务概念"（玩家/技能/卡牌/装备/状态/游戏事件/业务操作动词）—— 是 → 中文；再看是不是"真正的实现层协议"（仅用于 wire 格式 / 前端 UI 派发 / 通用工具抽象）—— 是 → 保留英文；其余（函数名、变量名、常量名）→ 英文。

### 1. 文件名

- **英文**：`src/engine/skill.ts`、`src/engine/atoms/damage.ts`、`src/server/room.ts`
- **中文允许**（无法翻译的专有名词，或业务概念是中文本身）：
  - 国家（引擎目录用英文）：`src/engine/characters/wei.ts`
  - 人名/技能名/卡牌名：`src/engine/skills/雷击.ts`、`src/engine/skills/八卦阵.ts`、`tests/fixtures/诸葛连弩.ts`
  - 文件聚合：`tests/scenarios/装备/八卦阵.test.ts`

**反例**：`src/engine/skills/leiji.ts`（拼音）、`src/engine/skills/bagua.ts`（拼音）、`src/server/protocol-adapter/pendingToAction.ts`（业务协议适配器用拼音）→ 应为 `雷击.ts` / `八卦阵.ts` / `等待转动作.ts`。
另：`src/shared/characters/魏.ts` 也不应使用——`shared/characters/` 目录已迁到 `src/engine/characters/`，且目录按势力（wei/shu/wu/qun）组织而非汉字。

### 2. 函数名 / 变量名 / 常量名 → 英文

实现层标识符一律英文。**注意**：函数名是英文，不代表它 dispatch 的**业务操作字面量**（如 `Atom.type`）也得是英文——`{ type: '摸牌' }` 中 `type` 字段值才是业务操作字面量，遵循 §3 业务概念 → 中文。

**正例**：
```ts
function drawCards(state: GameState, player: string, count: number) { ... }
const initialHandSize = 4;
const MAX_DAMAGE = 3;
const at: Atom = { type: '摸牌', player, count: 2 };   // 函数英文，type 字面量中文
```

**反例**：
```ts
function 摸牌(state, player) { ... }                // 函数名应是英文
const 初始手牌 = 4;                                  // 变量名应是英文
const at: Atom = { type: 'draw', player, count: 2 }; // 字面量应是业务术语中文
```

### 3. 业务概念（业务标识符）→ 中文

覆盖范围：**角色名、技能名、卡牌名、装备名、装备效果名、游戏事件名、状态名、核心操作动词**。这是项目核心数据，参与逻辑判断、UI 展示、存档 key 检索——必须用中文以便玩家识别。"摸牌"/"弃置"/"重铸"/"拼点"/"判定"等三国杀术语翻译成英文泛词会丢失精确度，玩家和技能文案反而看不懂。

**正例**：
```ts
// SkillDef.id 与 name 一致（中文）
registerSkill({ id: '奸雄', name: '奸雄', ... });
registerSkill({ id: '诸葛连弩', name: '诸葛连弩', ... });
registerSkill({ id: '八卦阵', name: '八卦阵', ... });

// 装备效果类型
type WeaponEffect =
  | { type: '诸葛连弩'; range: number }   // id === 卡名
  | { type: '青釭剑'; ... };

// 业务操作字面量（与玩家熟悉的术语对齐）
const at: Atom = { type: '摸牌', player: ctx.self, count: 2 };
const at2: Atom = { type: '重铸', player: ctx.self, cardIds };
trigger: { event: '受到伤害', source: '角色' };
```

**反例**（已发现的历史违规）：
```ts
// 装备 skill id 全部蹩脚英文
registerSkill({ id: 'unlimitedKills', name: '诸葛连弩', ... });
registerSkill({ id: 'judgeDodge',    name: '八卦阵',   ... });
registerSkill({ id: 'blockBlackKill', name: '仁王盾',  ... });
// 违反"业务概念→中文"。同时去掉 EQUIPMENT_SKILL_MAP 反向映射表，让 id === card.name。

// 武器/防具效果用蹩脚英文
type WeaponEffect =
  | { type: 'unlimitedKills' | 'ignoreArmor' | 'chaseDodge' | 'forceHit' | 'dualWeapon' };
// 应直接用卡名作 type。

// 原子操作 opcode 用英文泛词
{ type: 'draw' | 'damage' | 'heal' | 'discard' | 'moveCard' | 'equip' | 'judge' }
// 应为 '摸牌' | '造成伤害' | '回复体力' | '弃置' | '移动牌' | '装备' | '判定'

// 内部 vars 通用 key
vars['distanceBonus']     // 应为 '马术/距离修正'
vars['skipDraw']          // 应为 '突袭/跳过摸牌'
vars['unlimitedKills']    // 应为 '诸葛连弩/active'
// 通用约定：所有业务 vars 走 "技能名/属性" 命名空间
```

### 4. 类型接口中"游戏相关字段" → 中文

针对的是**字段名**（不是字段值）。类型本身的名字保留英文（避免破坏面过大），但承载游戏语义的字段名用中文。

**正例**：
```ts
export interface EquipmentSlots {     // 类型名保留英文
  武器: string | null;
  防具: string | null;
  防御马: string | null;
  进攻马: string | null;
}

export interface PlayerState {
  体力: number;
  最大体力: number;
  手牌: string[];
  装备: EquipmentSlots;     // 字段名中文
  技能: SkillDef[];
}

interface ZoneRef {
  zone: '手牌' | '牌堆' | '弃牌堆' | '装备' | '延时锦囊';  // 字段名 zone 保留（结构 key），
                                                           // 字段值全部中文
  player?: string;
}
```

**反例**：
```ts
interface EquipmentSlots {     // 字段名英文
  weapon: string | null;
  armor: string | null;
  horsePlus: string | null;
  horseMinus: string | null;
}
```

### 5. 真正的实现层协议字段 → 保留英文

只有**纯协议层 / 纯 UI 派发层**才保留英文。判别标准：这个字面量**不对应玩家/技能/卡牌/游戏操作中的任何业务概念**，仅作为底层调度 key 或 CSS 钩子。

**保留英文**：

- **服务端 wire 协议 message type**：`ServerMessage.type = 'initialView' | 'events' | 'error' | 'room_joined' | 'gameOver' | 'room_list' | 'player_joined' | 'player_left' | 'player_disconnected' | 'player_reconnected' | 'game_started'`
- **客户端 wire 协议 message type**：`ClientMessage.type = 'action' | 'response' | 'ready' | 'join_room' | 'create_room' | 'create_debug_room' | 'join_debug_room' | 'reconnect' | 'list_rooms' | 'delete_room' | 'start_game' | 'leave_room'`
- **客户端 UI 动画分类 type**：`Animation.type = 'cardMove' | 'cardFlip' | 'damagePopup' | 'healGlow' | 'drawCards' | 'discardCards' | 'equipItem' | 'unequipItem' | 'death' | 'skillActivate' | 'pendingPrompt' | 'trickReveal' | 'nextPlayer'`（CSS 钩子 + 纯前端派发 key，不进入引擎逻辑）
- **抽象工具类型名 / 抽象工具文件名**：`EquipmentSlots`、`PlayerState`、`GameState`、`_armorDamageBlock.ts`、`_fireKillDamageBonus.ts`（这些是工具型抽象，不是具体技能概念）
- **结构化数据的字段 key**（如 `ZoneRef.zone` 字段名）—— 字段**值**按 §4 走中文，字段名本身是结构 key，保留英文

**业务操作字面量 → 中文**（与 §3 业务概念联动）：

- **原子操作 opcode**：`Atom.type = '摸牌' | '弃置' | '重铸' | '造成伤害' | '回复体力' | '失去体力' | '失去牌' | '获得牌' | '交给' | '获得' | '移动牌' | '使用牌' | '指定目标' | '成为目标' | '判定' | '解决' | '拼点' | '整理牌堆' | '加标记' | '去标记' | '加技能' | '去技能' | '设状态' | '增加状态' | '清除状态' | '设横置' | '设上限' | '设阶段' | '设置变量' | '增量变量' | '清空变量' | '推入待定' | '弹出待定' | '添加延时锦囊' | '移除延时锦囊' | '加标签' | '去标签' | '装备' | '卸下' | '击杀' | '下一玩家' | '回合开始' | '回合结束' | '阶段开始' | '阶段结束' | '洗牌' | '重洗'`
- **玩家动作类型**：`GameAction.type = '打出一张牌' | '打出' | '结束回合' | '弃置' | '使用技能' | '技能选择' | '开始' | '切换自动跳过无懈可击'`
- **服务端事件 type**（与原子操作同步）：`'造成伤害' | '回复体力' | '摸牌' | '弃置' | '出牌' | '击杀' | '判定' | ...`
- **pending 状态 type**：`PendingAction.type = 'playPhase' | 'responseWindow' | 'skillPrompt' | 'discardPhase' | 'dyingWindow' | 'selectCard' | 'harvestSelection'`
- **trigger 来源**：`TriggerRule.source = '角色' | '装备'`
- **目标过滤 type**：`TargetFilter.type = '射程内' | '自己' | '其他角色' | '无目标'`

> **正反例**：
> ```ts
> // 业务操作字面量：中文（与玩家熟悉的术语对齐）
> const at: Atom = { type: '摸牌', player: ctx.self, count: 2 };
> const at2: Atom = { type: '重铸', player: ctx.self, cardIds: [...] };
> trigger: { event: '受到伤害', source: '角色' };
>
> // 客户端 CSS 钩子 / UI 派发：英文
> animationQueue.push({ type: 'damagePopup', target, amount });
>
> // wire 协议：英文（不属于任何业务概念）
> ws.send(serialize({ type: 'join_room', roomId }));
> ```

### 6. 业务 vars 命名空间

`PlayerState.vars` 内的业务键统一走 `技能名/属性` 命名空间，禁止裸英文通用 key：

**正例**：
```ts
vars['裸衣/active']
vars['裸衣/usedThisTurn']
vars['离间/usedThisTurn']
vars['青囊/usedThisTurn']
vars['仁德/healedThisPhase']
vars['杀/usedThisTurn']
vars['洛神/judgeResult']
vars['据守/flipped']
vars['志继/awakened']
vars['若愚/awakened']
vars['魂姿/awakened']
vars['凿险/awakened']
vars['涅槃/used']
vars['再起/skipNormalDraw']
vars['屯田/count']
vars['马术/距离修正']     // 取代裸 'distanceBonus'
vars['突袭/跳过摸牌']     // 取代裸 'skipDraw'
vars['诸葛连弩/active']   // 取代裸 'unlimitedKills'
```

**反例**（裸英文 key）：
```ts
vars['distanceBonus']   // 应改为 '马术/距离修正'
vars['skipDraw']        // 应改为 '突袭/跳过摸牌'
vars['unlimitedKills']  // 应改为 '诸葛连弩/active'
```

### 总结决策表

| 类别 | 命名 | 示例 |
|---|---|---|
| 文件名（具体技能/卡牌）| 中文 | `src/engine/skills/雷击.ts`、`tests/fixtures/诸葛连弩.ts` |
| 文件名（聚合/工具/协议）| 英文 | `src/engine/skill.ts`、`src/server/room.ts`、`_armorDamageBlock.ts` |
| 函数名 / 变量名 / 常量名 | 英文 | `drawCards`、`initialHandSize`、`count` |
| 业务标识符（角色/技能/卡牌/装备/装备效果）| **中文** | `'奸雄'`、`'诸葛连弩'`、`'八卦阵'` |
| 业务操作字面量（Atom.type / GameAction.type / ServerEvent.type / TriggerRule.source / TargetFilter.type / PendingAction.type）| **中文** | `'摸牌'`、`'重铸'`、`'造成伤害'`、`'角色'`、`'射程内'`、`'responseWindow'` |
| 业务 vars key | `技能名/属性` 命名空间 | `'裸衣/active'`、`'马术/距离修正'` |
| 类型接口的"游戏相关字段"（字段名）| **中文** | `装备.武器`、`玩家.体力`、`PlayerState.手牌` |
| 类型接口的"游戏相关字段"（字段值）| **中文** | `zone: '手牌' \| '弃牌堆'` |
| 类型名（承载业务字段的容器）| 英文 | `EquipmentSlots`、`PlayerState` |
| wire 协议 message type | 英文 | `ServerMessage.type: 'join_room'`、`ClientMessage.type: 'action'` |
| 前端 UI 动画 type（CSS 钩子）| 英文 | `Animation.type: 'damagePopup'` |
| 抽象工具 / 通用 hook 文件名 | 英文 | `_armorDamageBlock.ts`、`src/engine/skill.ts` |
| 结构化数据字段 key（如 `zone`）| 英文（值按 §4 改中文）| `ZoneRef.zone: '手牌'` |

## 开发规范

- 测试驱动开发（TDD）：先写测试，再写实现
- 每次提交前运行 `pnpm typecheck` 和 `pnpm test`
- 使用 `pnpm lint --fix` 修复代码风格
- 组件使用 named export（不用 default export）
- 服务端状态管理使用 plain object + event emitter，不用状态管理库
- **引擎分层**：`src/engine/{core,atoms,flows,rules,skills,view,data,util}/`——武将技能与装备技能统一在 `skills/`（装备技能在根、卡牌效果在 `skills/cards/`），角色声明在 `data/characters/`。引擎入口是 `src/engine/index.ts`（纯门面 re-export `core/` 的 `create`/`dispatch`/`restore` 等）。详细 ADR：`docs/decisions/0013-skill-character-decouple.md`。

## 关键架构决策

- **服务器权威架构**：游戏状态在服务端维护，客户端只接收公开信息
- **数据驱动的技能系统**：角色技能定义为配置对象，引擎运行时解释执行
- **种子化随机数**：使用 Mulberry32 PRNG，相同种子产生相同序列，支持确定性重播
- **Command Log 日志**：记录操作而非状态快照，服务端日志 + 每个玩家视角日志
- **牌堆方向唯一约定**：`zones.deck` **末尾 = 牌堆顶**（`docs/architecture/引擎架构.md`）。
  取牌/翻牌/看顶一律走末尾：`摸牌` 取 `slice(-count)`、`置创牌` 用 `pop()`、
  `判定`/`红颜`/`五谷丰登` 也取末尾；`整理牌堆` 的 `cards` 按 `[底 … 顶]` 构造。
  曾出现 4 处按 `deck[0]` 当顶（判定/红颜/界红颜/五谷丰登）→ 观星/恂恂 置顶的牌对判定无效、
  判定牌与下一张摸牌不同源。新增取牌代码务必与 `摸牌` 同向。
- **判定区延时锦囊的实体牌归属**：延时锦囊（乐不思蜀/兵粮寸断/闪电）在**使用时**实体牌就已入
  弃牌堆（`use-card.ts` 的 delayed 分支），`pendingTricks` 只持牌面快照 `{ name, source, card }`。
  任何「清空判定区」路径（顺手牵羊/过河拆桥选判定区、死亡 `系统处理牌`、涅槃/界涅槃、行殇）
  都**不得**再把这张实体牌 push/获得——否则弃牌堆同一张牌出现两次（重洗后同牌两个实例），
  或同时存在于弃牌堆与手牌（牌唯一归属不变量）。统一走 `src/engine/core/judge-zone.ts` 的
  `locateCard` / `discardJudgeZoneCard` / `obtainJudgeZoneCard`。
- **view 放宽投影契约**：view 层（`viewSlashMax`/`viewCanSlash`/`viewEffectiveDistance`/
  `viewCanAttack`）是浏览器按钮、选目标置灰与无头/AI 枚举的唯一判据。技能放宽了引擎侧限制
  （出杀次数 / 距离 / 攻击范围）就必须同步投影到 `view.turnUsage`：出杀族用
  `'杀/extra/<技能>'`、`'杀/unlimited/<技能>'` 前缀键，距离族用具名键（见 `vars-keys.ts` 的
  `TURN_SCOPED_VIEW_KEYS`），经「回合用量」atom 投影；该 atom 的 apply 还会镜像到
  `turn.vars['__view/<key>']`，供 `buildView`（初始/重连视图）重建。漏投影 = 引擎放行但
  客户端发不出动作（按钮消失 / 目标选不中），整类效果在客户端不可用。
- **判定流程的牌移动必须经 atom**：判定牌从牌堆顶翻入结算帧后，离开处理区只有两条合法路径，
  都必须走 atom 才有 view 投影（否则增量视图与 `buildView` 永久漂移：弃牌堆计数虚高、
  收走方手牌数多 1）：
  - 入弃牌堆 / 被天妒·双雄·界落英 拿走 / 被鬼才·鬼道 改判替换 → `移动牌`（收尾见
    `flows/judge.ts` 的 `cleanupJudgeCard`，改判见 `replaceJudgeCard`）；
  - 被屯田·界屯田 收作"田"（移出游戏，只存 `marks[].payload.cardId`）→ `收取判定牌`。
  `判定.applyView` 只做 `deckCount-1` + 判定牌进 `processing`，**不得**预支
  `discardPileCount+1`（判定牌被收走时它根本没进弃牌堆）。
- **影子卡 id 后缀 = 技能 id**：客户端（浏览器 `usePlayInteraction`、无头 `availableActions`）
  构造主 action 的 cardId 为 `${选中牌 id 以 # 连接}#${skillId}`。引擎转化技创建影子卡时必须
  用**同一个 skillId** 作后缀——写成技能名（界武圣 `#武圣`、界疠火 `#疠火`、界父魂 `#父魂`）
  会让主 action 读不到 `cardMap[影子 id]` → validate 恒失败，该转化技在客户端整类不可用。
  另：同一技能可有多个转化 action（界父魂 = `transform` 两张牌 + `武圣transform` granted 单张），
  客户端枚举按 `action.transform` 存在判定（非 `actionType === 'transform'`），preceding 回填
  action 自身的 actionType。
- **被拒动作不得改变玩家可见的有序数组**：`dispatch` 在跑 preceding 之前快照各玩家的
  `hand`/`marks`，任一 reject 路径回滚后按快照还原（内容 + 顺序）。手牌/标记顺序是客户端
  可见状态（UI 排列 + `pickTargetCard` 盲选的 `handIndex` 按位置取值），技能各自的 rollback
  回调把原牌 push 回末尾会让在线客户端与权威 `buildView` 顺序错位、玩家选到的牌不是点击的那张。
- **客户端枚举的每个动作/目标都必须能被引擎接受**（最高频 bug 类：引擎支持但客户端发不出/发了被拒）：
  - 目标合法性由引擎 validate 权威判定，客户端 `targetFilter`/`choosePlayer.filter` 是**同一判据的投影**。
    写成占位 `return true` 或漏写 → 枚举出必拒目标（挑衅 范围、激将 势力，玩家点了没反应 / AI 确定性
    挑选反复撞同一非法目标空转）。距离族用 `viewCanAttack`（与后端 `inAttackRange` 同源）。
  - 替代出法（`enumerateAltActions`）与转化技一样要按自身 prompt 派生目标（义绝 弃牌+选目标）。
  - 多卡转化的组合约束用 `CardFilter.comboFilter` 声明（乱击/界乱击 两张同花色）——单卡 filter
    表达不了「两张牌之间」的约束；无头枚举据此过滤组合、浏览器据此拦提交。
  - 客户端声明的参数取值必须与引擎 validate 同源（`paramVariants` 的 cost：界强袭是 `'damage'`
    不是标版的 `'hp'`）。
- **目标形状归一（dispatch 边界）**：客户端对目标有两种 wire 形状——普通牌/技能代价牌发
  `targets:[idx]`，延时锦囊发 `target:idx`（`buildPlayParams`）；回应 `useCardAndTarget` 型 pending
  固定发 `targets`（`handleRespond`）。`使用牌` skill 自带 target→targets 兼容，但**自带
  use/respond action 的技能拿不到它**，故 `dispatch` 入口统一补齐两种形状（缺哪种补哪种，已有值
  不覆盖；单数只取 `targets[0]`）。新技能读 `params.target` 或 `params.targets` 都可。
- **转化技的方向与目标语义由「产出牌」决定，不由 transform action 自身声明决定**：
  - 产出牌名由 `action.transform(当前选中的牌).name` 求值——浏览器 `transformWrapperName`
    必须跟随选牌（进入模式时的样本名只是占位），否则多向转化技（龙胆 杀↔闪、界龙胆 四向）的
    方向被手牌顺序钉死：主 action 不存在（按钮消失）或方向不符（引擎拒）。
  - 目标语义取**产出牌自己的 use action**（`findUseActionForCard` 按产出牌名查）：酒（无目标）、
    桃（selfTarget，提交 `targets:[自己]`）、杀（攻击范围）；沿用 transform 自己的 targetFilter
    会把「对他人」的目标塞给 桃/酒 → 恒拒。产出牌此刻不可用（闪/无懈无主动 use 入口、桃需已受伤）
    则不该枚举/渲染（`hasUseEntry` + 产出 action 的 `activeWhen`）。
- **声明型转化技把「声明」编码进 actionType**：界渐营/界矫诏 需要玩家声明牌名（outputName），
  客户端无法凭空提供 → 每个声明牌名注册一个 action（`transform:杀` / `transform:无中生有`…），
  `transform` 回调固定返回该牌名。新增同类技能照此办理，勿再依赖「前端声明面板」这类未实现的 UI。

## 测试

```bash
pnpm test              # 运行所有测试
pnpm test -- tests/unit/state.test.ts  # 运行单个文件
pnpm test:watch        # 监听模式
```

## 文件结构

- `src/client/` — 前端 React 应用
- `src/engine/` — 游戏引擎（纯逻辑）
  - `skills/` — 武将与装备技能实现（`SkillDef`），按技能单文件（汉字命名），`skills/cards/` 为卡牌效果
  - `data/characters/` — 角色声明（`CharacterConfig`），按势力组织
  - `core/`、`atoms/`、`flows/`、`rules/`、`view/` — 引擎核心（调度/原子操作/流程/规则/视图投影）
  - `index.ts` — 引擎对外唯一入口（门面 re-export）
- `src/server/` — 后端服务器
- `tests/` — 测试
- `docs/` — 设计文档和实现计划

## 环境

- Node.js >= 22
- pnpm
- 开发服务器：`pnpm dev`（端口 3930）

### 端口测试规范（CRITICAL）

- **所有本地 HTTP/REST/SSE 测试一律走 3930 端口**（`http://localhost:3930`）——这是 vite dev server 的唯一监听端口，前端和 Hono REST API 共享该端口。
- 启动 dev server 前必须先确认 3930 端口空闲；**若已有实例在跑，先 kill 掉再启动**，否则新实例会因端口占用失败、或请求被打到旧实例（携带过时的 SSR 模块缓存，表现为新加路由 404）。
  ```bash
  # 检查并清理 3930 占用
  ss -ltnp 2>/dev/null | grep 3930 && pkill -f 'vite.*3930|node.*vite' || true
  ```
- vite dev server 的 SSR 模块缓存（`server.ssrLoadModule`）在进程内首次加载后固定，**改 server 代码后仅靠重启进程不一定够**：若遇到新路由/新逻辑不生效（如新端点 404），清 vite 缓存目录再重启：
  ```bash
  rm -rf node_modules/.vite node_modules/.vite-temp && pnpm dev
  ```
