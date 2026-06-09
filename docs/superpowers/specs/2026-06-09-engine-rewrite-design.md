# 三国杀引擎重写设计(按 ENGINE-DESIGN.md)

> 一次性铺好 ENGINE-DESIGN 全骨架,以老代码为参考,在 `src/engine/` 重写新引擎。
> 首批交付 5 武将 + 全套 17 锦囊 + 全部装备 + 杀/闪/桃/酒,够 DebugLobby 复刻试用。

**日期**: 2026-06-09
**状态**: 设计完成,待用户 review
**前置依赖**: `docs/ENGINE-DESIGN.md`(终态设计,已就绪)

---

## 1. 目标与边界

### 1.1 目标

把现有 v2/v3 混存引擎**重写**为 `docs/ENGINE-DESIGN.md` 描述的终态架构:
- 客户端协议统一为 `ClientMessage { skillId, actionType, params, baseSeq }`
- 技能 API 改为 `createSkill / onInit / onMount`,通过 `registerAction` + `onAtomBefore/After` 注册
- 等待回应用 atom `awaits` 声明,不再有独立 pending 状态机
- 结算区栈(`SettlementFrame`)取代同步 `applyAtoms` + `MAX_HOOK_RECURSION`
- 牌是纯 token,无行为
- `Atom` 集合按 ENGINE-DESIGN §5 收紧(移除 §10 列举的冗余 atom)

### 1.2 首批范围

- 5 武将:**刘备(仁德+激将) / 曹操(护甲) / 孙权(制衡) / 关羽(武圣) / 郭嘉(遗计)**
- 4 基本牌:**杀 / 闪 / 桃 / 酒**
- 17 锦囊 + 全部装备
- DebugLobby 复刻(选将 / 发牌 / 查看牌堆 / 手动 click 走回合)

### 1.3 非目标(显式排除)

- AI bot / 性能压测 / i18n
- 老 v2 GameAction / SkillPhase DSL / `card-handlers.ts` 拆分逻辑保留
- 重连与超时的全部场景(仅覆盖基础场景,复杂场景留后续 PR)
- 计时与录像回放(留接口,功能延后)

---

## 2. 文件结构

### 2.1 目录布局

```
src/
├── engine/                        # 新引擎(本 spec 的实现目标)
│   ├── types.ts                   # §7 GameState / Atom / SkillDef / SettlementFrame / GameView
│   ├── atom.ts                    # atom 注册表 + apply 引擎
│   ├── skill.ts                   # 技能注册表 + Skill 实例生命周期
│   ├── settlement.ts              # 结算区栈管理
│   ├── event-stream.ts            # 前端事件流(per-player)
│   ├── create-engine.ts           # createEngine(config) 工厂
│   ├── skill-loader.ts            # 按 players.skills 动态 import + onInit/onMount
│   ├── atoms/                     # 1 文件 1 atom, ENGINE-DESIGN §5 全集
│   ├── skills/                    # 1 文件 1 技能(createSkill/onInit/onMount 三件套)
│   ├── view/                      # 客户端视图派生
│   │   ├── buildView.ts
│   │   └── types.ts
│   └── _legacy/                   # 老代码原样保留
│       ├── README.md
│       ├── (现有所有文件原样)
│
├── server/                        # 服务端按 ENGINE-DESIGN §2 改写
│   ├── session.ts                 # 接受 clientMessage,断线重连/超时/resume
│   ├── protocol.ts                # ClientMessage 终态
│   ├── persistence.ts             # ActionLogEntry 持久化
│   └── app.ts                     # Hono 路由
│
├── client/                        # DebugLobby 复刻
│   ├── components/
│   │   ├── DebugLobby.tsx         # 复刻老 DebugLobby
│   │   └── GameView.tsx           # 极简游戏页
│   ├── hooks/
│   │   └── useEngineSocket.ts     # WebSocket 收发 ClientMessage
│   └── main.tsx
│
└── shared/                        # 共享类型
    ├── types.ts
    └── cards/
```

### 2.2 关键规则

1. **`_legacy/` 下文件相对 import 不变**——保持老代码可独立运行
2. **新代码禁止 import `_legacy/`**——单向流动,老代码只能"被参考不能被引用"
3. **`_legacy/README.md`** 标注:`该目录为迁移期参考代码,新代码请勿引用。目标:全部功能稳定后删除整个目录`

### 2.3 不在首批 spec 范围(避免范围爆炸)

- 锦囊/装备"完整所有 17+ 8 个"的实现可分多 PR,本 spec 只列**完整清单**而不分阶段细化
- 武将不限于 5 个,后续按"加 SkillDef 文件"自然延伸

---

## 3. 核心架构决策

### 3.1 客户端协议

`ClientMessage` 唯一一种:

```ts
interface ClientMessage {
  skillId: string;     // 目标技能
  actionType: string;  // 技能内 action 类型
  params: Record<string, Json>;
  baseSeq: number;     // CAS 序列号
}
```

服务端处理:
1. CAS 校验:`baseSeq !== state.seq` → 静默丢弃
2. 路由到 `skillId + ownerId` 对应 `actionType` 处理函数
3. `validate` 校验参数
4. `execute` 执行

### 3.2 技能 API

```ts
// 技能模块文件,1 文件 1 技能
export function createSkill(id: string, ownerId: string): Skill;
export function onInit(skill: Skill, api: BackendAPI): () => void;
export function onMount(skill: Skill, api: FrontendAPI): () => void;
```

`BackendAPI` 提供:
- `registerAction(actionType, validate, execute)` → 卸载函数
- `onAtomBefore(atomType, handler)` → 卸载函数
- `onAtomAfter(atomType, handler)` → 卸载函数
- `apply(atom)` → 触发钩子 + 等待回应(如有 awaits)
- `notify(event)` → 通知事件

`FrontendAPI` 提供:
- `onEvent(handler)` → 卸载函数
- `defineAction(actionType, opts)` → 声明按钮 UI
- `playEffect(effect)` → 动画/音效

### 3.3 结算区栈

`SettlementFrame` 包含:
- `skillId / from / params / cards / atomStack / pendingRequest / parent`

执行规则:
- **主动 action 压栈** — 杀/南蛮入侵等 execute 开始时压入新帧
- **回应 action 不压栈** — 闪/杀(回应)在当前帧上执行
- **嵌套自然隔离** — 南蛮入侵内嵌杀,杀有独立帧
- **atom 栈** — 每次 `apply(atom)` 先压入 atom 栈,before 钩子可 drop 栈顶

### 3.4 等待回应

`AtomDefinition.awaits` 字段声明:

```ts
interface AtomAwaits {
  target: string;
  prompt: ActionPrompt;
  defaultChoice?: Json;
  timeout?: number;
}
```

### 3.5 钩子语义

- **before 钩子**:可 `drop()` 取消 atom + `modifyParams()` 改帧参数
- **after 钩子**:可 `modifyParams()` 改帧参数 + `apply(新atom)` 链式副作用
- 钩子是**副作用语义**,所有匹配的都执行(不是覆盖)

### 3.6 牌是 token

`Card` 只有属性(名称 / 花色 / 点数 / 类型 / subtype),无行为。
"使用杀的效果" 属于 `杀` 技能,不属于牌。

### 3.7 牌包装(武圣类转化)

```ts
interface CardWrapper {
  name: string;             // 包装后的牌属性
  sourceCardId: string;     // 原始牌 ID
  fromSkill: string;        // 转化此牌的技能
}
```

- 前端:玩家点武圣按钮 → 给手牌中的红牌加包装 → UI 显示为"杀" → 提交时 params 含包装
- 后端校验:重新转换,比对前后端一致 → 通过 → 写入处理区
- 还原:技能注册 `onAtomAfter('移动牌', ...)` 在牌离开处理区时还原

### 3.8 CAS 序列号

`state.seq` 全局单调递增,每次 action 开始时 +1。`baseSeq !== state.seq` 静默丢弃(不发错误)。断线重连按 `lastAckedSeq` 推差量。

### 3.9 相对时间

所有时间戳相对于 `startedAt` 偏移(毫秒)。`ActionLogEntry.timestamp = Date.now() - state.startedAt`。重放跨时区一致。

### 3.10 不删除但延后

- 录像回放:留接口,功能延后
- AI bot:延后
- 计时:留接口,功能延后

---

## 4. 5 武将 + 4 基本牌技能清单

| 武将/牌 | 技能 | 类别 | ENGINE-DESIGN API |
|---|---|---|---|
| 刘备 | 仁德 | 主动技 | `registerAction('use', validate, execute)` + `apply(移动牌) × N` |
| 刘备 | 激将 | 主公技(主动) | `registerAction` + validate 检查主公身份 + `apply(请求回应)` |
| 曹操 | 护甲 | 锁定被动 | `onAtomBefore('造成伤害', ...)` 检查黑色 |
| 孙权 | 制衡 | 主动技 | `registerAction` + `apply(摸牌)` |
| 关羽 | 武圣 | 转化技 | `defineAction.transform` + `onAtomAfter('移动牌', ...)` 还原 |
| 郭嘉 | 遗计 | 锁定被动 | `onAtomAfter('造成伤害', ...)` + `apply(摸牌)` + `apply(请求回应)` 分配 |
| 杀 | 杀 | 主动技(基本) | `registerAction('use')` + `apply(询问闪) + apply(造成伤害)` |
| 闪 | 闪 | 回应(基本) | `registerAction('respond')` + `apply(移动牌) + frame.drop()` |
| 桃 | 桃 | 主动技(基本) | `registerAction('use')` + `apply(回复体力)` |
| 酒 | 酒 | 主动技(基本) | `registerAction('use')` + `apply(加标记)` 标记"下一张杀伤害+1" |

### 4.1 锦囊与装备
锦囊与装备完整清单(后续 PR 逐步实现,**不在本 spec 验收范围**):

- 锦囊:无中生有 / 顺手牵羊 / 过河拆桥 / 五谷丰登 / 南蛮入侵 / 万箭齐发 / 决斗 / 火攻 / 借刀杀人 / 桃园结义 / 铁索连环 / 闪电 / 兵粮寸断 / 乐不思蜀(具体数量以老 `src/engine/handlers/card-handlers.ts` 注册为准)
- 装备:八卦阵 / 仁王盾 / 藤甲 / 诸葛连弩 / 青龙偃月刀 / 丈八蛇矛 / 方天画戟 / 进攻马 / 防御马(具体以老 `src/engine/equipment/` 注册为准)

**注**:锦囊/装备具体清单**以老 `src/engine/handlers/card-handlers.ts` + `src/engine/equipment/` 实际注册为准**,本 spec 不重新枚举,实施时按"一个 PR 一组"实现。


---

## 5. 实施顺序

按"每步中间状态可运行"分 PR:

### 步骤 1:迁移准备(PR 1,1 天)
- 移动 `src/engine/*` 下所有文件到 `src/engine/_legacy/*`
- 加 `_legacy/README.md`
- **主路径效果**:`src/engine/` 空,主分支暂时不跑(标 WIP)
- 客户端/服务端:不动(继续指向老路径)

### 步骤 2:新引擎核心(PR 2,2-3 天)
- 写 `src/engine/types.ts` / `atom.ts` / `settlement.ts` / `skill.ts` / `skill-loader.ts` / `event-stream.ts` / `create-engine.ts`
- 写 4 个核心 atom:摸牌 / 移动牌 / 造成伤害 / 击杀
- 写 2 个测试用最小 Skill:杀 + 闪
- 写烟雾测试 `tests/engine-smoke.test.ts`
- **主路径效果**:`vitest run` 通过,服务端/客户端仍不跑

### 步骤 3:核心 atom 全集(PR 3,2 天)
- 实现 ENGINE-DESIGN §5 列出的全部 atom(约 30 个)
- 每个 atom 文件:validate + apply + 可选 effect/toPlayerViews
- **主路径效果**:全 atom 可用,技能文件可继续写

### 步骤 4:核心 Skill(PR 4,1-2 天)
- 实现 5 武将技能(仁德/激将/护甲/制衡/武圣/遗计)
- 实现 4 基本牌(杀/闪/桃/酒)
- 写每个 Skill 的 e2e 测试
- **主路径效果**:全部首批 Skill 通过 e2e 测试

### 步骤 5:服务端接通(PR 5,1-2 天)
- 改 `src/server/protocol.ts`:ClientMessage 终态
- 改 `src/server/session.ts`:接受 clientMessage
- 删老 server 中所有 handler 引用
- **主路径效果**:WS 可收发新协议

### 步骤 6:DebugLobby 复刻(PR 6,2-3 天)
- 改 `src/client/components/DebugLobby.tsx`:选 4-5 武将,选主公
- 写 `src/client/components/GameView.tsx`:显示 state + viewer 手牌 + 按钮
- 改 `src/client/hooks/useEngineSocket.ts`:发 ClientMessage
- **主路径效果**:浏览器开 debug,跑"出杀→出闪→扣血" 完整流程

### 步骤 7:锦囊与装备(PR 7-10,5-7 天)
- 按"一组一类"分 PR:锦囊 1 PR / 装备 1 PR
- 每 PR 含 Skill 文件 + e2e 测试
- **主路径效果**:DebugLobby 能玩完整一局

### 步骤 8:清理(后续,不在本 spec)
- 功能稳定后(可能 1-2 个月),删 `src/engine/_legacy/*`
- 删老 ADR(0012, 0013, 0015, 0016, 0025)
- 加 0027 ADR 记录本次迁移

---

## 6. 测试策略

### 6.1 单元测试(引擎核心)

| 文件 | 覆盖 |
|---|---|
| `tests/atom-registry.test.ts` | atom 注册/查找、validate 拒绝、apply 返回新 state |
| `tests/settlement.test.ts` | 主动 action 压栈/弹栈、回应 action 不压栈、嵌套隔离、栈可序列化 |
| `tests/event-stream.test.ts` | 事件按序、per-player 视图分叉(自己的手牌 vs 对手的手牌数) |
| `tests/apply-pipeline.test.ts` | before 钩子 drop/modifyParams,after 钩子 modifyParams,awaits 等待回应 |
| `tests/skill-loader.test.ts` | 技能按玩家实例化(杀-P1 和 杀-P2 独立),添加技能/移除技能触发加载/卸载 |
| `tests/cas.test.ts` | baseSeq 不匹配时静默丢弃、seq 推进、断线重连 |
| `tests/card-wrapper.test.ts` | 武圣包装后端校验,离开处理区还原 |

### 6.2 Skill e2e 测试(每个 Skill 一个)

`tests/skills/`:
- `杀.test.ts`:出杀→出闪→不掉血 / 出杀→不出闪→扣 1 血 / 超出攻击范围→拒绝 / 出牌阶段限 1 张→拒绝 / 多目标(南蛮入侵嵌套)
- `闪.test.ts`:询问闪后出闪→dodged=true / 不出闪→dodged=false / 超时→dodged=false
- `桃.test.ts`:濒死出桃→回复 1 血 / 不濒死出桃→拒绝
- `酒.test.ts`:酒+杀→下一张杀伤害+1 / 酒+已受伤角色→拒绝
- `仁德.test.ts`:给 1 人 1 张 / 给 2 人各 1 张→回复 1 血 / 手里没牌→拒绝
- `激将.test.ts`:主公被南蛮入侵→主公可发动 / 非主公→拒绝 / 没人响应杀→南蛮入侵生效
- `护甲.test.ts`:受到黑色【杀】伤害→-1 / 受到红色【杀】→不变 / 受到【决斗】→不变
- `制衡.test.ts`:出牌阶段弃 1 张手牌→摸 1 张 / 手里没牌→拒绝 / 非出牌阶段→拒绝
- `武圣.test.ts`:红色手牌当杀→成功 / 黑色手牌当杀→拒绝 / 结算后还原
- `遗计.test.ts`:受到 1 伤害→摸 2 张→分配 / 受到 0 伤害→不触发 / 跳过→不摸牌

### 6.3 集成测试

`tests/integration/`:
- `1v1-dual.test.ts`:2 人局,一个死亡,游戏结束
- `4v4-full-game.test.ts`:4 人局,跑完一局,assert winner
- `bagua-judge.test.ts`:装备八卦阵后被【杀】,判定红/黑各一次
- `wrap-replay.test.ts`:序列化 GameState → 重启 → 恢复,assert 一致

### 6.4 引擎核心场景测试(ENGINE-DESIGN §11 推演代码化)

`tests/engine-scenarios/`:
- `scenario-a-kill-redirect-dodge.test.ts`:杀→流离改目标→出闪
- `scenario-b-bagua-judge.test.ts`:杀→八卦阵判定成功→视为闪
- `scenario-c-nested-settlement.test.ts`:南蛮入侵内嵌杀,杀内嵌闪,栈正确隔离

### 6.5 客户端 e2e

`tests/e2e/`:
- `debug-lobby-flow.test.ts`:启动 debug,选将,发牌,出杀,选目标,出闪,验证 GameView
- `reconnect-flow.test.ts`:断线重连,assert 事件流差量正确

### 6.6 不在首批测试范围

- AI bot 测试(`scripts/repro-duel.mjs` 那种)
- 性能基准(出牌阶段 1000 次 stress test)
- 多语言/i18n

---

## 7. 风险与缓解

### 7.1 风险 1:结算区栈设计在 30+ 复杂场景未验证

**风险**:ENGINE-DESIGN §11 推演只描述了 3 个场景(流离/八卦阵/南蛮入侵嵌套),实际 Sanguosha 有 17 锦囊 + 装备 + 武将的复杂组合,结算区栈可能漏设计。

**缓解**:
- 步骤 4 实现 5 武将前,**先实现** `tests/engine-scenarios/` 三个场景测试,**强制跑通** 三个 ENGINE-DESIGN 推演场景
- 5 武将覆盖 5 种技能类型(主动/锁定被动/主公/转化/锁定多步),任一类失败即回退修订设计
- 步骤 7 锦囊/装备时,如发现栈设计缺陷,**不绕过**——回退修订 ENGINE-DESIGN,新 spec ADR 记录

### 7.2 风险 2:锦囊/装备"完整所有"的工作量超估

**风险**:你以为的 17 可能实际是 14(查老代码),或者 17 里有 3 个共享逻辑(延时锦囊 / 不需选目标的锦囊)。

**缓解**:
- 步骤 7 严格按"一组一类"分 PR,**禁止**一个 PR 包含 5+ 锦囊
- 每 PR 完成后 `pnpm test` 必过才合并
- 如发现某类锦囊需新设计模式(如"延时锦囊独立栈"),回退到 ENGINE-DESIGN 加 §5.x 描述,**不绕过**

### 7.3 风险 3:`_legacy/` 单向流动约束被破坏

**风险**:实施过程中,"参考"老代码很容易变成"import"老代码,新代码无意中耦合到 `_legacy/`。

**缓解**:
- 步骤 1 在 `_legacy/README.md` 写明禁止
- PR review 时强制 grep `_legacy` import,**有则驳回**
- `pnpm run lint` 加自定义规则:禁止 `import.*_legacy`(若可行)

### 7.4 风险 4:DebugLobby 复刻"工作量低估"

**风险**:DebugLobby 原版可能与新协议不兼容(老 client 用 GameAction,新用 ClientMessage),实际改写可能比预估 870 行大。

**缓解**:
- 步骤 6 严格限定范围:**只**做"选 4-5 武将 + 选主公 + 点出杀 + 选目标 + 出闪" 这一条线
- 其他 DebugLobby 功能(查看所有玩家手牌、撤销、回放)延后,**不阻塞**首批交付

### 7.5 风险 5:测试驱动流程冲突"先写代码再写测试" 习惯

**风险**:团队习惯先写实现后写测试,本 spec 要求 e2e 测试先于 Skill 实现。

**缓解**:
- 步骤 4 第一个 PR 先写 5 武将的 e2e 测试(全失败),**不写实现**
- 第二个 PR 才写实现,逐步让测试通过
- 这在 PR history 中明确可查

---

## 8. 验收标准

首批交付(PR 1-6 + 步骤 7 部分)通过的客观标准:

1. `pnpm test` 全绿(包括单元 + e2e + 集成)
2. `pnpm tsc --noEmit` 无错误
3. `pnpm dev` 启动后,浏览器开 debug 模式:
   - 选 4 武将(曹操主公 + 刘备/孙权/关羽),点"开始游戏"
   - 主公(曹操)出牌阶段,点"出杀"按钮,选刘备为目标
   - 刘备看到"出闪"提示,点"出闪",曹操的杀不造成伤害
   - 重启步骤 1 流程,刘备不点"出闪"超时,曹操的杀扣刘备 1 血
   - 刘备(被扣血后)点"是否发动遗计" → 选"发动" → 摸 2 张 → 分配给关羽
   - 关羽点"武圣"按钮 → 选一张红桃手牌 → UI 显示为"杀" → 点"出杀" → 验证 UI 显示
4. 断线重连场景:故意断 1 个客户端,重连后事件流从 lastAckedSeq 推差量,GameState 一致
5. 录像回放:ActionLogEntry 序列可在新进程重放,得到相同最终 state(基础版即可)

---

## 9. 不在 spec 范围(显式声明)

- 录像完整重放(留接口,功能延后)
- AI bot(完全延后)
- 性能压测
- 多语言/i18n
- 计时与游戏时长统计
- 老 ADR 清理(留待稳定后)
- `_legacy/` 目录最终删除(留待稳定后)
