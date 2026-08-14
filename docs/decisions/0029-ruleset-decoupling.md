# ADR 0029: 规则包解耦与游戏模式动态加载

- 状态:已接受
- 日期:2026-08-14
- 关联:ADR 0026(统一引擎架构)、ADR 0027/0028(引擎顶层函数)

## 背景与动机

改造前,`core/index.ts` 顶层**静态 import** `skills/系统规则`,并在 `checkGameOver` 中内嵌身份局胜负判定:

1. **core → skills 的静态反向依赖**:core 是引擎门面,却在模块加载期锁定具体规则实现。循环边界只能靠注释约定维持(core/index.ts 文件头注释),任何新模式都要改 core 源码。
2. **身份局规则硬编码**:`checkGameOver`(主公/忠臣/反贼/内奸胜负)写死在 core,选将候选数(`CANDIDATES_PER_IDENTITY`,主公 7/忠臣 5/反贼 4/内奸 5)写死在 `skills/开局.ts`。1v1、国战等模式无处安放——要么加 if/else 分支污染通用代码,要么复制整个开局流程。
3. **模式不可配置**:房间只能玩身份局;`RoomConfig` 没有模式概念。

## 决策

### 1. 规则包(Ruleset)抽象

新增 `src/engine/rules/`,定义模式级扩展点契约(`rules/types.ts`):

```ts
interface RulesetModule {
  mode: GameMode;                                  // '身份局' | '1v1' | ...
  onInit(state): () => void;                       // 开局前注册全局 hooks/respond actions
  checkGameOver(state): GameOverResult;            // 胜负判定(纯函数)
  opening: { candidatesPerIdentity, lordPickEnabled };  // 开局选将流程配置
}
```

- `rules/身份局.ts`:系统规则 hooks 组合(复用 `skills/系统规则` 的 onInit/registerSystemRespondActions)+ 身份局胜负判定(自 core 迁入)+ 标准候选数、主公先行。
- `rules/1v1.ts`:复用身份局判定(两人特化:主公死=反贼胜),`lordPickEnabled=false`(全员并行等额 5 候选,无主公开局特权)。
- 引擎级规则(濒死求桃、技能生命周期、装备兜底)**不随模式变化**,两类模式共享,仍由 `skills/系统规则` 提供。

### 2. core 仅经 registry 动态加载

`rules/registry.ts` 维护 `GameMode → dynamic import` 表(零副作用,符合引擎无模块级可变状态约束)。core 删除 `import * as 系统规则mod` 静态依赖:

- `bootstrap()`:按 `gameConfig.mode` 加载规则包 → `ruleset.onInit(state)` 注册 hooks,并把 mode 持久化到 `state.config.mode`(开局 execute 与 restore 均从此解析)。
- `checkGameOver(state)`:改为**异步**,经 `loadRuleset(resolveGameMode(state))` 路由到规则包判定。ES 模块缓存使重复加载近零开销。
- `registerSkillsFromState()`:同样按 `state.config.mode` 加载(测试直构 state 缺省身份局)。

### 3. 开局流程数据驱动

`skills/开局.ts` 删除本地 `CANDIDATES_PER_IDENTITY`,execute 内经 `loadRuleset(resolveGameMode(state))` 读 `ruleset.opening`:

- `lordPickEnabled=true`(身份局):主公串行先行(常备 5+非常备 2),其余并行按身份候选数。
- `lordPickEnabled=false`(1v1):跳过主公先行,全员并行等额选将。
- 选将/发牌/回合启动等通用骨架不变——模式差异被压缩为**配置**,不是分支代码。

### 4. 模式贯穿服务端与前端

- `RoomConfig.gameMode: GameMode`(server/protocol.ts,normalize 兜底身份局,旧房间配置兼容)。
- `GameSession.startGame/restoreState` 将 `config.gameMode` 注入引擎 `GameConfig.mode`;`create()` 写入 `state.config` 随快照持久化——**重放/恢复自动还原模式**。
- 前端建房表单与房主配置面板新增模式选择(1v1 强制 2 人),只读面板展示模式。

## 后果

**正向**:
- core 不再 import 任何 skills 规则模块(开工局仍是动态 import),God-module 反向依赖消除;新增模式(国战/3v3)= 新增一个 rules/ 文件 + registry 一行 + GameMode 字面量,core/开局零改动。
- 模式随 state 序列化,快照恢复天然支持多模式。
- checkGameOver 异步化后,胜负逻辑与 core 解耦,可按模式独立测试。

**代价与权衡**:
- `checkGameOver` 从同步变异步:session.onStateChange 中改为 fire-and-forget(模块缓存后首个微任务即完成),测试需排空微任务;曾评估保留同步出口(启动时预热加载 + 同步缓存),因引入模块级可变状态违反引擎约束而放弃。
- `state.config.mode` 与 `GameConfig.mode` 双通道(显式参数 + state 持久化):bootstrap 显式参数优先并回写 state,保证两条路径一致。

## 验证

- `tests/integration/ruleset-modes.test.ts`(新增):registry 契约/未知模式抛错/checkGameOver 路由与缺省回退/1v1 开局无主公特权/身份局回归保护。
- `tests/server/session-turn-deadline.test.ts`:checkGameOver 用例适配异步;gameOver 广播/resetToLobby 用例补微任务排空。
