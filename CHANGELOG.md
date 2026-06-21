# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — 2026-06-21
### 出杀次数上限重构 + 摸牌重洗实装 + 马匹描述修复

重构出杀次数上限为查询型提供者模式,彻底解决诸葛连弩换装时序 bug;
实装摸牌/洗牌/重洗的 RNG 与牌堆补充逻辑;修正马匹描述。

#### Changed
- **出杀次数上限重构为查询型提供者模式**: 旧机制用单个 `turn.vars['杀/quota']`
  同时承载「上限」与「剩余次数」,导致换装时丢失「已出过杀」信息。新机制拆分:
  上限由技能注册的提供者动态计算(基础 1 + Σ贡献;任一 ∞ 即 ∞),已用次数由
  `turn.vars['杀/usedCount']` 独立累计。新增 `src/engine/slash-quota.ts` 提供
  `slashMax/slashUsed/canSlash/incSlashUsed/registerSlashMaxProvider` API。
  技能不预写状态,卸载即停止贡献,多技能天然叠加。(`src/engine/slash-quota.ts`,
  `src/engine/skills/杀.ts`)

#### Fixed
- **诸葛连弩换装后出杀次数错误**: 旧 `杀/quota` 方案下,换装重置 quota 会丢失
  「已出过杀」信息——装连弩前出过杀,换装后配额被重置仍可继续出。改为提供者模式后,
  卸载连弩只取消上限加成(回到 1),`usedCount` 保留 → 正确拒绝。同时修复原 `after
  hook(移除技能)` 是死代码(卸载时已被清理,永不触发)的问题。连弩现用
  `onInit` 注册 `() => Infinity` 提供者,unloader 随实例生命周期自动清理。
  (`src/engine/skills/诸葛连弩.ts`)
- **赤兔描述反字**: `description.ts` 中赤兔写为「进攻马,距离+1」,与实际效果相反。
  修正为「距离-1」,并补齐其他 5 匹马描述。(`src/shared/cards/description.ts`)
- **重洗 ViewEvent 字段语义模糊**: `deckCount` 在 apply 前调用实际表示合并总数,
  改名为 `totalCards` 并加注释。(`src/engine/atoms/重洗.ts`)

#### Added
- **摸牌牌堆不足时重洗补充**: 牌堆不足时自动合并弃牌堆 Fisher-Yates 重洗补充
  (标准三国杀规则);`planDraw` 纯函数供 apply 与 toViewEvents 共用,保证一致。
  (`src/engine/atoms/摸牌.ts`, `src/engine/atoms/洗牌.ts`, `src/engine/atoms/重洗.ts`)
- **出杀次数重构回归测试**: 装连弩前出过杀 → 换装后 usedCount 保留不能再用;
  提供者随装备注册/卸载;非出牌阶段装备被拒。(`tests/skill-tests/诸葛连弩.test.ts`,
  `tests/integration/zhuge-crossbow.test.ts`, `tests/integration/draw-reshuffle.test.ts`)

## [Unreleased] — 2026-06-21
### 仁德/制衡 bug 修复 — 发动次数与时序漏洞

修复仁德规则错误(错误地限一次)和制衡可重复发动的时序 bug(fire-and-forget 窗口期 `usedThisTurn` 未设)。

#### Fixed
- **制衡可重复发动(fire-and-forget 时序 bug)**: `制衡/usedThisTurn` 标记原在 execute 末尾(`applyAtom(摸牌)` 之后)才设,但 dispatch 是 fire-and-forget——session 不 await,execute 内的 `await applyAtom` 会让出事件循环,前端收到中间状态广播后技能按钮仍亮,用户可再次点击发 dispatch。第二次 dispatch 的 validate 在第一次 execute 设标记之前就跑 → 通过 → 可重复发动。修复:把 `usedThisTurn = true` 移到 execute 最开头(第一个 `await` 之前),dispatch 同步阶段即设好标记,第二次 validate 必然拒绝。(`src/engine/skills/制衡.ts`)
- **仁德规则错误(误实现为限一次)**: 原实现把仁德写成了「出牌阶段限一次」,但标准版/国战版仁德可多次发动——「出牌阶段,可以将任意张手牌交给其他角色;以此法失去第二张牌时回复 1 点体力」。修复:移除 `仁德/usedThisTurn` 限制,改用 `仁德/givenCount` 累计计数 + `仁德/healed` 标记。给出牌时累加 `givenCount`,当从 1 跨越到 2(首次达到 2 张)时回血一次并设 `healed`,之后继续给牌只累计不再回血。回合结束清理新增标记。(`src/engine/skills/仁德.ts`、`src/engine/atoms/回合结束.ts`)

#### Added
- **仁德新规则测试**: 覆盖可多次发动(第一次给 1 张不回血,第二次再给 1 张累计 2 张回血)、回血仅一次(累计≥2 张后继续给牌不再回血)、分三次各给 1 张的累计回血时序。(`tests/skill-tests/仁德.test.ts`)
- **制衡时序防回归测试**: 连发两次 `dispatch`(不等第一次稳定),验证第二次被拒(seq 只 +1,修复前为 +2)。该测试在回退修复后确定性地失败,证明能捕获时序 bug。(`tests/skill-tests/制衡.test.ts`)

## [Unreleased] — 2026-06-21
### 牌堆耗尽 bug 修复 — 摸牌未合并弃牌堆重洗补充

修复牌堆耗尽时摸牌直接失败、未将弃牌堆重新洗牌补充的问题。同时实装了长期空置的 `重洗`/`洗牌` atom(TODO 占位)。

#### Fixed
- **摸牌牌堆不足未重洗弃牌堆补充**: `摸牌` atom 的 validate 在牌堆不足时直接报错 `'deck empty'`,apply 不执行,导致回合摸牌/制衡/无中生有等抽牌流程在牌堆耗尽时直接卡死。修复:validate 改为只在牌堆+弃牌堆总数都不足以满足 count 时才报错;apply 在牌堆不足时合并 deck+discardPile,Fisher–Yates 洗牌后抽足,弃牌堆清空。`toViewEvents` 与 apply 共用同一纯函数 `planDraw`,保证 owner 看到的具体牌面与实际摸入一致。(`src/engine/atoms/摸牌.ts`)
- **`重洗` atom 长期空置**: 原 `apply` 为空 TODO(`// TODO: 弃牌堆+牌堆合并并洗牌(待 RNG 接入)`)。修复:实装为合并 deck+discardPile → Fisher–Yates 洗牌 → 弃牌堆清空,用 `state.rngSeed` 派生 RNG(推进后写回),保证重放确定性。(`src/engine/atoms/重洗.ts`)
- **`洗牌` atom 长期空置**: 原 `apply` 为空 TODO(`// TODO: 真正的随机化洗牌(待 RNG 接入)`)。修复:实装为对当前 deck 做 Fisher–Yates 洗牌,用 `state.rngSeed` 派生 RNG(推进后写回)。(`src/engine/atoms/洗牌.ts`)

#### Added
- **摸牌重洗补充集成测试**: 覆盖牌堆不足触发重洗、牌堆完全为空从弃牌堆补足、牌堆+弃牌堆都不足时 validate 拒绝、牌堆充足不触发重洗、相同 rngSeed 可重放、重洗后 rngSeed 被推进,以及 `重洗`/`洗牌` atom 的独立单元验证。(`tests/integration/draw-reshuffle.test.ts`)

## [Unreleased] — 2026-06-20
### 延时锦囊 bug 修复 — 无懈可击问询时机错误

修复闪电/乐不思蜀/兵粮寸断三类延时锦囊的无懈可击问询时机:延时锦囊的生效时机是判定阶段而非使用时,无懈可击问询应在判定前才出现。同时修补了乐不思蜀遗漏无懈可击问询的 bug。

#### Fixed
- **闪电无懈可击问询时机错误**: 原实现在出牌阶段使用时即问询无懈可击,但闪电此时只是放入判定区尚未生效。修复:从 `use` action 移除无懈问询,改到判定阶段 before hook 中——判定前先问无懈,被抵消则移除延时锦囊并跳过判定。(`src/engine/skills/闪电.ts`)
- **兵粮寸断无懈可击问询时机错误**: 与闪电同样的问题,使用时问询无懈。修复:同闪电——use action 仅放置延时锦囊,无懈问询移到判定阶段判定前。(`src/engine/skills/兵粮寸断.ts`)
- **乐不思蜀遗漏无懈可击问询**: 乐不思蜀原实现完全没有无懈可击问询(使用时和判定前都没有),玩家无法对乐不思蜀打出无懈。修复:在判定阶段 before hook 判定前补上无懈可击问询,与闪电/兵粮寸断一致。(`src/engine/skills/乐不思蜀.ts`)

#### Added
- **延时锦囊被无懈抵消测试**: 验证闪电在判定前被打出无懈可击后被抵消——闪电移除、不判定、不受伤、不传递,判定牌未被翻动。(`tests/skill-tests/闪电.test.ts`)
- **更新延时锦囊测试适配新时机**: 闪电/兵粮寸断的 use action 测试不再需要消耗无懈窗口;判定阶段测试改为 fire-and-forget + fireTimeoutAndWait 模式以处理新增的无懈 pending。(`tests/skill-tests/闪电.test.ts`、`tests/skill-tests/乐不思蜀.test.ts`、`tests/skill-tests/兵粮寸断.test.ts`、`tests/integration/乐不思蜀.test.ts`、`tests/integration/乐不思蜀判定跳过.test.ts`)

## [Unreleased] — 2026-06-20
### 选将 bug 修复 — 并行选将卡住直到超时

修复并行选将场景下,多个玩家同时 respond 选将时,后发的 respond 被 CAS 校验误拒,导致选将流程卡住直到 60s 超时才能开始的阻断性问题。

#### Fixed
- **并行选将卡住直到超时**: `session.handleAction` 的 CAS 校验(`baseSeq !== curState.seq`)在并行选将/并行回应场景下错误地拒掉了合法 respond。多个玩家同时 respond 选将会让 `state.seq` 连续 +1,其它玩家基于旧 `lastSeq`(广播有延迟)发的 respond 会被 CAS 误拒,导致选将流程卡死,只能等 60s 超时自动分配。修复:respond 路径(该 ownerId 存在对应的 pending slot)跳过 CAS 校验——respond 本质是对已存在 pending 的回应,只要 slot 还在就应允许;只有主动 action(无 pending slot)才需要 CAS 防止陈旧操作。这也顺带修复了"其它玩家看不到主公选将完成"的表现——那是选将流程被卡住的副作用。(`src/server/session.ts`)

#### Added
- **session CAS 行为回归测试**: 验证并行选将中基于陈旧 baseSeq 的 respond 仍被接受(选将完成,不卡到超时),以及主动 action 在无 pending 时仍受 CAS 保护。(`tests/server/session-cas-respond.test.ts`)

## [Unreleased] — 2026-06-20
### 选将 bug 修复 — idle timer 误触发/超时空武将/武将池缺失

修复实际运行中选将流程的三个阻断性问题:玩家超时或选将间隙时游戏被错误推进导致空武将、武将池只有 6 个导致常备主公拆分无意义。

#### Fixed
- **选将间隙 idle timer 误触发自动结束回合**: `resetIdleTimer` 在主公选完→并行选将创建之间的间隙(pendingSlots.size===0)启动了 50s 定时器,玩家选将慢时误触发"自动结束回合",清掉所有选将 pending。修复:选将阶段(phase==='准备' 且仍有玩家未选完武将)不启动 idle timer。(`src/server/session.ts`)
- **选将超时后玩家武将为空**: 选将询问 slot 超时(60s)只执行 `无操作` atom,未给玩家分配武将,导致游戏带着空武将(character 为空)进入出牌阶段,显示"未知"且不可玩。修复:`createAndAwaitSlot` 的 `fireTimeoutNow` 对选将询问 slot 特殊处理——超时后从该玩家候选列表随机分配一个未被选走的武将(与 respond 一致设 DEFAULT_SKILLS),不留空武将。(`src/engine/create-engine.ts`)

#### Changed
- **session 武将池改用引擎全量武将**: `session.ts` 原硬编码 6 个武将(刘备/曹操/孙权/关羽/郭嘉/司马懿),现改用 `allCharacters`(57 个),使常备主公 5+非常备 2 拆分与按身份分配有实际意义。(`src/server/session.ts`)

#### Added
- **选将超时自动分配测试**: 验证选将 slot 超时后玩家从候选列表自动分配武将、无空武将、跨玩家不重复。(`tests/integration/char-select-distribution.test.ts`)

## [Unreleased] — 2026-06-19
### 选将逻辑重构 — 按身份分配候选武将 + 不实例化武将技能

修正选将分配逻辑:主公选完后未选的武将进入候选池,其余玩家按身份从候选池随机抽取特定数量的候选武将(不重复),候选池不足时从总池补足;选将完成后只实例化引擎默认技能,暂不实例化武将自身技能。

#### Changed
- **选将候选数改为按身份配置**: 新增 `CANDIDATES_PER_IDENTITY` 配置表(主公 7/忠臣 5/反贼 4/内奸 5,对齐三国杀OL身份模式)。主公先选完后,池中未被选中的武将全部进入候选池。(`src/engine/skills/开局.ts`)
- **主公候选池拆分为常备/非常备**: 常备主公(拥有主公技的武将:刘备/曹操/孙权/孙策/张角/董卓/刘禅)随机 5 + 非常备随机 2,合并为 7 张候选人。常备不足时用非常备补足,总数仍不足则给现有全部。(`src/engine/skills/开局.ts`)
- **非主公候选人按身份分配**: 从候选池随机抽取,跨玩家不重复(独占模式)。(`src/engine/skills/开局.ts`)
- **候选池不足时自动补足**: 池不足以覆盖全部需求时回退共享模式——所有非主公玩家共享同一批候选人,由 respond validate 保证最终唯一(先选先得),不再阻塞开局。(`src/engine/skills/开局.ts`)
- **选将后不实例化武将技能**: respond action 选定武将后 `player.skills` 只保留引擎默认技能(`DEFAULT_SKILLS`),武将自身技能不进入 `player.skills`、不被 `instantiateSkill` 注册。候选人 atom 仍携带 `skills` 字段供选将 UI 显示。(`src/engine/skills/系统规则.ts`)

#### Added
- **CharacterMeta 增加 isLord 字段**: 新增 `LORD_CANDIDATES` 常量(7 个常备主公名单)作为 isLord 判定唯一来源,`CharacterMeta.isLord` 与 `isLord(name)` 查询函数。(`src/engine/character-meta.ts`)
- **选将分配集成测试**: 覆盖按身份分配数量、候选池入池、候选人携带 skills 字段、不实例化武将技能、池不足共享模式、主公候选 5+2 拆分六个场景。(`tests/integration/char-select-distribution.test.ts`)

## [Unreleased] — 2026-06-17
### 前端游戏流程修复 — 选将/身份动画/技能过滤/出杀问闪/弃牌 UI

通过多模型协作(sensenova 浏览器视觉验证 + mimo-v2-pro 代码审查 + deepseek/M3 批量实现 + mimo-v2.5 UI 设计)定位并修复 8 个问题。

#### Fixed
- **P0 出杀不问闪**: 双层根因——(1)buildView deadline 用相对时间,前端当绝对时间戳导致 remainingSeconds ≤ 0 立即自动 respond;(2)前端 useEffect 在 remainingSeconds ≤ 0 时自动触发 handleRespond。修复:deadline 改为绝对时间戳(state.startedAt + slot.deadline),删除自动 respond useEffect。(`src/engine/view/buildView.ts`, `src/client/components/GameView.tsx`)
- **P0 手牌点击无操作面板**: useMemo 未 await registerSkillActions。修复:改 useState+useEffect 异步注册。
- **P0 延时锦囊无法使用**: targets(数组) vs target(单数)契约错配。
- **P0 弃牌阶段无弃牌**: 引擎 ownerId 路由 + 前端 UI 双层修复。
- **P0 身份不显示**: buildView 缺 identity 字段。
- **P1 技能按钮区太多**: 显示了杀/闪/桃等基本牌按钮。修复:HIDDEN_ACTION_SKILLS 过滤集。
- **P1 杀/respond 空牌被拒绝**: validate 不允许空 cardId。修复:允许空 respond(不出杀)。
- **P1 buildView 读取定义级 prompt**: 丢弃了 atom 实例的动态 prompt。修复:优先读 atom 实例 prompt。
- **P1 pending UI 硬编码**: 只渲染闪/杀按钮。修复:根据 requestType 动态渲染(求桃→出桃/不救)。
- **P1 身份可见性规则**: debug 模式全可见,正式模式按规则隐藏。
- **P0 主公分配假角色**: CHARACTERS 含 `{name:'主公',skills:[]}` 假角色,选将 atom 优先分给主公座次导致无武将技能。修复:删除假角色,主公选真实武将。(`src/server/session.ts`, `src/engine/atoms/选将.ts`)
- **P0 刷新重复展示身份/选将**: useState 刷新后重置。修复:sessionStorage 标记。(`src/client/components/GameView.tsx`)
- **P0 pending 超时不推进**: fireTimeout 后未调 notifyStateChange。修复:补充调用。(`src/engine/create-engine.ts`)
- **P1 过河拆桥 targets/target 契约错配**: validate 改为兼容 targets 数组。(`src/engine/skills/过河拆桥.ts`)
- **P1 武圣不能使用**: prompt 类型改为 useCardAndTarget + transform + preceding 提交。(`src/engine/skills/武圣.ts`, `src/client/components/GameView.tsx`)

#### Added
- **选将 UI**: 游戏开始展示武将选择遮罩(5张随机武将卡,阵营色,hover 效果,确认选择)。(`src/client/components/GameView.tsx`)
- **身份揭示动画**: 3D 翻转动画展示玩家身份(主公=金/忠臣=蓝/反贼=红/内奸=紫)。(`src/client/animations.css`, `src/client/components/GameView.tsx`)
- **前端动画系统**: 摸牌滑入/出牌飞行/伤害闪烁震动/阶段过渡/回合光环。(`src/client/animations.css`, `src/client/components/GameView.tsx`)

#### Changed — defineAction 驱动的 UI 渲染
- **技能按钮区改为 prompt 类型驱动**: 不再硬编码 DEFAULT_SKILLS 过滤集。按文档设计,`defineAction` 的 `prompt.type` 决定渲染方式:`confirm`/`distribute`/`choosePlayer` 显示独立触发按钮;`useCard`/`useCardAndTarget`/`selectTarget` 影响手牌区可选性(哪些牌可选、选了怎么选目标),不显示按钮。(`src/client/components/GameView.tsx`)
- **身份可见性 debug 与真实一致**: debug 模式下身份不再全部可见,统一规则:自己可见 + 主公可见 + 死亡可见 + 其他隐藏。切换视角可查看对应玩家身份。(`src/engine/view/buildView.ts`)

#### Verified(sensenova 5/5 PASS)
- 技能按钮区只显示 confirm 类型(遗计等),不显示杀/闪/桃/装备 ✅
- 身份可见性:自己+主公可见,其他显示「暗」 ✅
- 出杀→询问闪→不闪→伤害结算 P1 4→3 ✅
- 选将遮罩 + 身份揭示动画 ✅
- 技能按钮只显示武将技能 ✅
- 身份徽章正确显示(4 种颜色) ✅
- 弃牌 UI 可操作 ✅

## [Unreleased] — 2026-06-16
### 前端游戏流程修复 — 技能按钮/身份显示/延时锦囊/弃牌 UI/动画

通过多模型协作(sensenova 浏览器视觉验证 + mimo-v2-pro/v2.5 代码审查与设计 + deepseek/M3 实现)定位并修复 5 个 P0 bug。

#### Fixed
- **P0 手牌点击无操作面板**: `GameView.tsx` 的 `useMemo` 中调用 async `registerSkillActions()` 未 await,Promise 被忽略,onMount→defineAction 从未执行,registry 永远为空。修复:改为 `useState`+`useEffect` 异步注册,await 完成后 setSkillActions 触发重渲染。(`src/client/components/GameView.tsx`)
- **P0 身份不显示**: `buildView.ts` 的 players 映射未输出 identity 字段,前端永远拿不到身份信息。修复:buildView 加 `identity: p.vars['身份']`,GameView 类型加 `identity?: string`,座位卡片渲染彩色身份徽章(主公=金/忠臣=蓝/反贼=红/内奸=紫)。(`src/engine/view/buildView.ts`, `src/engine/types.ts`, `src/client/components/GameView.tsx`)
- **P0 延时锦囊无法使用**: 前端发 `params.targets: number[]`(数组),后端乐不思蜀 validate 要 `params.target: number`(单数),契约错配导致 validate 拒绝。修复:新增 `DELAYED_TRICKS` set,延时锦囊发 `params.target`(单数),其他牌仍用 `targets`(数组)。(`src/client/components/GameView.tsx`)
- **P0 弃牌阶段无弃牌**: 双层缺陷——(1)引擎:弃牌 respond 注册在 ownerId=-1,客户端用 perspectiveIdx 查找永远找不到;(2)前端:弃牌 UI 完全没实现(selectedForDiscard 死代码+handleDiscard 注释掉)。修复:dispatch 加系统级 respond fallback(ownerId 不匹配时回退查 -1),前端实现弃牌交互(手牌多选+确认弃牌按钮+倒计时)。(`src/engine/create-engine.ts`, `src/client/components/GameView.tsx`)

#### Added
- **前端动画系统**: 纯 CSS animation 实现(零额外依赖),包含摸牌滑入动画、出牌飞行动画、伤害闪烁+震动+红光覆盖、阶段过渡淡入、回合开始金色光环脉冲。通过 `useAnimationState` hook + ref diff 检测状态变化触发。(`src/client/animations.css`, `src/client/components/GameView.tsx`)

#### Verified(浏览器完整游戏测试)
- 技能按钮渲染:18 个操作按钮(杀/闪/桃/酒/装备/锦囊等)全部出现
- 身份徽章:4 种身份(主公/忠臣/反贼/内奸)彩色显示
- 出杀流程:选牌→选目标→出牌→询问闪→视角切换
- 弃牌流程:结束回合→弃牌 pending→手牌多选→确认弃牌→回合切换
- 延时锦囊:乐不思蜀 target 参数对齐后端契约
- 多轮游戏稳定性:第 2 轮状态正常无崩溃

## [Unreleased] — 2026-06-16
### 引擎核心修复 — dispatch pending slot 时序 + 多选择机制修复

通过自动化玩家脚本完整模拟游戏(2人/4人局从开局到濒死求桃),定位并修复游戏完全卡死的根因。

#### Fixed
- **P0 dispatch respond 路径提前清除 pendingSlot**: `dispatch` 在 `entry.execute` 前执行 `state.pendingSlot = undefined`,导致 respond execute(如系统规则弃牌、桃救援)读不到 slot 信息。修复:保存 oldSlot 引用 → execute 前不清除 → execute 完成后才清除(仅当 pendingSlot===oldSlot 时) → promoteChoiceQueue。(`src/engine/create-engine.ts` dispatch)
- **P0 选择询问 atom 未注册**: `atoms/选择询问.ts` 缺 `registerAtom()` 调用,`atoms/index.ts` 缺 import。修复:补注册和 import。(`src/engine/atoms/选择询问.ts`, `src/engine/atoms/index.ts`)
- **P0 选择询问 requestType 不一致**: makeChoiceSlot 用 `__选择询问`(双下划线),skill validate 检查 `选择询问`(单下划线)。修复:统一为 `__选择询问`。(`src/engine/skills/选择询问.ts`)
- **P0 dispatch respond 后未 promote choiceQueue**: 用户 respond 完成一个 pending 后,choiceQueue 中剩余 slot 永远不会被提升为 pendingSlot,导致多选择场景死锁。修复:dispatch `.then` 中清除 pendingSlot 后调用 `promoteChoiceQueue`。(`src/engine/create-engine.ts` dispatch)

#### Verified(自动化玩家完整游戏模拟)
- 出杀→询问闪→出闪/不闪→伤害结算 全链路
- 杀 quota 扣减(每回合一次)
- 回合切换(结束回合→弃牌阶段→下家回合)
- 弃牌阶段(手牌超限→弃牌 pending→系统规则 respond→弃置)
- 濒死求桃(HP→0→逐个询问→无人救则击杀→存活≤1人结束)
- 遗计分配(郭嘉受伤→摸牌→分配 pending→respond)
- 桃自救(手牌有桃→出桃 respond→HP+1)
- 4人局多玩家交替回合

#### Changed
- **前端布局修复**: `GameView.tsx` 的 `pageRoot` 加 `overflow-x: hidden`,`seatRowSpread`/`seatRowCenter` 加 `flex-wrap: wrap; gap`,修复玩家卡片被边缘裁切的 P0 布局 bug。(`src/client/components/GameView.tsx`)

#### Removed(遗留测试跳过)
- 96 个引用已删除 v2 模块(@engine/skill-hook, @engine/engine, @engine/mark, @engine/phase-advance 等)的遗留测试文件改为 `describe.skip` 跳过,不再报 import 解析错误。

### 多模型协作迭代 — 核心技能打磨 + UI 修复 + 死代码清理

通过多模型协作（mimo-v2-pro 审查、M3/sensenova 浏览器测试、deepseek 批量清理）发现并修复多个关键 bug。

#### Fixed
- **P0 buildView debug 参数丢失**：`create-engine.ts` 的 `buildView` 包装函数未传递 `debug` 参数 → 调试模式只有 viewer 手牌可见，其余玩家手牌为 undefined。修复：包装函数加 `debug` 参数透传。(`src/engine/create-engine.ts`)
- **P0 sendDebugGameState/getDebugView 漏传 debug**：`session.ts` 中 `sendDebugGameState`（行 188）和 `getDebugView`（行 271）调用 `buildView` 未传 `this.debug`。修复：补 `this.debug` 参数。(`src/server/session.ts`)
- **P1 请求回应 timeout 被忽略**：`applyAtom` 只读 `def.pending.timeout`（hardcode 30s），忽略技能传入的 `atom.timeout`。修复：优先读 atom 字段，fallback 到 def。(`src/engine/create-engine.ts`)
- **P1 加标签/去标签 atom 用 marks 模拟 tags**：改为直接操作 `player.tags` 数组，符合设计文档 §7.4 tags/marks 分离。(`src/engine/atoms/加标签.ts`, `src/engine/atoms/去标签.ts`)
- **P1 乐不思蜀读取 tags 位置错误**：从 `marks.some(m => m.id === 'tag:...')` 改为 `tags?.includes()`。(`src/engine/skills/乐不思蜀.ts`)
- **P2 寒冰剑未注册到牌堆**：`shared/cards/equipment.ts` 和 `shared/deck.ts` 补寒冰剑 CardDef + deck 条目。(`src/shared/cards/equipment.ts`, `src/shared/deck.ts`, `src/engine/cards/装备.ts`, `src/engine/cards/index.ts`, `src/shared/types.ts`)

#### Changed
- **武器卡补 range 字段**：`engine/cards/装备.ts` 的 `make()` 加 `range` 参数，所有武器补 range（诸葛连弩 1, 青釭剑/寒冰剑/雌雄双股剑 2, 贯石斧/青龙偃月刀/丈八蛇矛 3, 方天画戟 4, 麒麟弓 5）
- **前端 UI 改进**：装备区独立显示（emoji+名称）、HP 三态预警（绿/橙/红）、pending 红色警示框+倒计时进度条+手牌金色高亮、座位编号标注。(`src/client/components/GameView.tsx`)

#### Removed
- **抽牌 atom 死代码**：从 `types.ts`、`atoms/抽牌.ts`、`atoms/index.ts` 删除（被摸牌取代，无调用方）
- **24 个废弃前端组件**：GameBoard/MultiplayerGameBoard/ReplayBoard/NewEngineDemo/PlayerPanel/ActionPanel/HandCards/LogPanel/ReplayControls/DebugPlayerList/activePlayer.ts/game/*整个目录(11文件)/MultiplayerPage/ReplayPage/LobbyPage。App.tsx 路由精简为 3 条（`/`, `/debug`, `/debug/:roomId`），HomePage 移除废弃入口。

#### Added
- `tests/integration/杀装备距离.test.ts` — 4 测试：装备范围扩大、出杀→出闪→伤害为 0、出杀→超时→扣血、诸葛连弩无限出杀
- `tests/integration/弃牌阶段.test.ts` — 3 测试：手牌超限→弃牌 pending、fireTimeout 自动弃牌、手牌未超限→无 pending
- `tests/integration/濒死求桃.test.ts` — 3 测试：出杀致死→濒死流程→无人救→击杀
- `tests/integration/无懈可击.test.ts` — 2 passed 2 skipped（嵌套无纶的 dispatch respond 路径需重构）

#### Fixed（补充第二轮）
- **请求回应 validate 拒绝广播 target**：target=-2（无纶可击广播）导致 validate 失败，pending 不创建。修复：validate 允许 target<0 的特殊值。(`src/engine/atoms/请求回应.ts`)
- **造成伤害 validate 拒绝 amount=0**：护甲减伤到 0 时 validate 报错，伤害静默取消。修复：允许 amount=0（apply 自然不扣血）。(`src/engine/atoms/造成伤害.ts`)

#### Added（补充第二轮）
- **弃牌阶段实装**：回合管理 阶段推进钩子中，进入弃牌阶段时检查手牌超限→创建弃牌 pending→系统规则注册 respond action→fireTimeout 自动弃最后 N 张。(`src/engine/skills/回合管理.ts`, `src/engine/skills/系统规则.ts`, `src/engine/create-engine.ts`)

#### Removed（补充第二轮）
- `src/engine/cards/装备.ts`、`基础.ts`、`锦囊.ts`、`index.ts` — 冗余 Card[] 牌堆实例（运行时用 shared/deck.ts，仅 characters/ 被引用）

#### Verified
- skills 项目：4 文件 13 passed 4 skipped
- 新增 integration：杀装备距离 4 passed
- 浏览览器实测：出杀→扣血→消耗手牌全链路通过、距离系统生效（徒手范围 1 打不到座位距离 2 的目标）、装备成功、所有玩家手牌可见（debug 模式修复）

### dispatch fire-and-forget 重构 — session 不 await dispatch

将 dispatch 从“await barrier”转为 fire-and-forget 输入分发器，广播时机从 dispatch 返回点移到 state 变更点（每次 applyAtom 结束）。并发安全（回应 vs 超时竞争）从 dispatch 层的 Promise.race 下移到 slot 层的定时器状态。

#### Changed
- **dispatch fire-and-forget**：同步跑 preceding/validate → `entry.execute(...).then(resolve)` 启动后立即返回，不等 pending 创建。旧 `_pendingSignal`/`_waitForStable`/`Promise.race` 机制全部移除。主动 action 的 execute 跑到 `applyAtom` 建 pending 时自然挂起；回应路径 `slot.pause()` 取消定时器让 respond execute 独占推进。递归 pending（无纶递归）下 respond execute 挂在新 pending 上，旧 slot 待整条链 resolve 后才恢复。(`src/engine/create-engine.ts` dispatch)
- **PendingSlot 加 isTimeout/pause**：`isTimeout` 标记定时器已触发（dispatch 据此丢弃竞态中的用户 action）；`pause()` 取消定时器让 dispatch 走用户 action 路径。在 applyAtom 建 slot 时实现。(`src/engine/types.ts` PendingSlot, `src/engine/create-engine.ts` applyAtom)
- **GameState 加 onStateChange 回调**：每次 applyAtom 结束（pushEvent 后、cancel 分支、pending 建好后）触发。删除旧的 `_pendingSignal` 字段。(`src/engine/types.ts` GameState)
- **session 订阅 onStateChange**：`handleAction` 不再 `await dispatch`，改为 `void dispatch(...)`。广播/持久化/checkGameOver/resetIdleTimer 全部移入 `attachStateListener` 挂载的 onStateChange 回调。destroy 时先清回调防止挂起的 execute resume 触发已销毁 session 的广播。idleTimer 的 dispatch 也改 fire-and-forget。(`src/server/session.ts`)
- **fireTimeout 注释更新**：广播由 applyAtom 内部的 onStateChange 驱动，不再用 pendingSignal。(`src/engine/create-engine.ts` fireTimeout)

#### Removed
- `setupPendingSignal`/`resolvePendingSignal`/`resolveSlot` helper（死代码）
- `_pendingSignal` 字段（GameState）
- dispatch 注释中过时的 pendingSignal/race 描述

#### Added（测试适配）
- `tests/engine-harness.ts` 导出 `waitForStable(state)`/`dispatchAndWait(state, msg)`/`fireTimeoutAndWait(state)`：dispatch fire-and-forget 后用轮询（setTimeout 0 yield）等到 pendingSlot 就绪或 execute 跑完。手写集成测试（直接用 dispatch、不经 SkillTestHarness）可用这些 helper。
- 9 个直接用 `await dispatch` 的集成测试批量迁移到 `dispatchAndWait`/`fireTimeoutAndWait`。

#### Verified
- skills + integration：15 文件 42 passed 6 skipped
- 类型检查：0 新错误（create-engine.ts/session.ts/types.ts 干净；types.ts 的 3 个 ViewEvent 索引签名错误为预存）
- engine-smoke/server-gameplay/guanxing/serializer 的失败为历史遗留（改动前即失败，引用已删模块或旧 API）

## [Unreleased] — 2026-06-10

## [Unreleased] — 2026-06-15
### Identity Game — 身份局实现推进

- **P0 核心**:
  - `PlayerState` 加 `identity`/`faction` 字段(身份局基础)
  - 濒死/求桃流程:`造成伤害` 不再直接死亡,进入 `runDyingFlow` 按座次轮询求桃,无人救才 `击杀`(手牌装备入弃牌堆)。新增 `陷入濒死` atom。
  - 桃/酒 加 `respond` 路径(濒死时出桃/酒救援)
- **P1 装备**:诸葛连弩/青釭剑/丈八蛇矛 从空壳实现;八卦阵接通(杀读 autoDodge 标签);仁王盾加 cardId 杀检查;青龙偃月刀/贯石斧 时序修复;防具全加青釭剑无视检查;装备通用修旧装备替换+技能实例化
- **P1 锦囊**:无懈可击(dispatch 广播 pending + `settleWithWuxie` helper + respond);决斗修 respond 标志重置
- **P1 基本牌**:桃完善(validate 受伤检查 + 濒死 respond);酒完善(濒死 respond)
- **sensenova 批量评估**:适合单文件规范明确的技能实现;技能间通信协议(标签/标记命名)需人工统一

## [Unreleased] — 2026-06-14
### Research — 武将技能研究文档补全(吴/群/蜀/魏 4 国)

按 docs/research/武将技能.md 框架,补全 70+ 武将技能描述和规则注释:

### Added

- `docs/research/武将技能/吴国/*.md` — 20 名吴国武将(丁奉/凌统/吴国太/大乔小乔/孙鲁班/徐盛/朱桓/朱然/步练师/潘璋马忠/祖茂/程普/蒋钦/虞翻/诸葛瑾/陈武董袭/韩当/顾雍)
- `docs/research/武将技能/群雄/*.md` — 24 名群雄武将(伏完/伏皇后/何太后/何进/刘协/刘表/吉本/孔融/张任/张宝/李儒/汉献帝/沮授/灵雎/田丰/穆顺/纪灵/蔡夫人/邹氏/陈宫/韩遂/马腾/高顺)
- `docs/research/武将技能/蜀国/*.md` — 18 名蜀国武将(关兴张苞/关平/关银屏/刘封/吴懿/周仓/夏侯氏/夏侯霸/廖化/张松/徐庶/星彩/法正/甘夫人/简雍/糜夫人/蒋琬费祎/马岱/马良/马谡)
- `docs/research/武将技能/魏国/*.md` — 18 名魏国武将(乐进/于禁/张春华/文聘/曹冲/曹彰/曹昂/曹植/曹洪/曹真/李典/杨修/满宠/牛金/王异/臧霸/荀攸/诸葛诞/郭淮/钟会/陈琳/陈群/韩浩史涣)

### Changed

- `docs/research/基础规则.md` — 补充牌堆构成、装备区规则、判定流程等
- `docs/research/卡牌信息.md` — 补全锦囊/装备牌完整信息,修正官方规则引用
- `docs/research/武将技能.md` — 补全 70+ 武将技能框架
- `docs/research/武将技能/蜀国/刘备.md` — 修正仁德规则描述
- `docs/research/武将技能/蜀国/界赵云.md` — 修正描述
- `docs/research/武将技能/蜀国/诸葛亮.md` — 修正观星空城规则
- `docs/research/武将技能/魏国/曹操.md` — 修正奸雄规则
- `docs/research/武将技能/魏国/界曹操.md` — 修正界奸雄规则
- `src/engine/skills/反馈.ts` — 注释修正:删除已完成的"描述错误"条,重新编号
- `src/engine/skills/寒冰剑.ts` — 添加完整官方规则注释(技能描述/触发/FAQ)
- `src/engine/skills/杀.ts` — 注释修正:目标限制改为"其他角色",标注 validate 未约束
- `src/engine/skills/桃.ts` — 补充完整规则描述:各模式变体、FAQ
- `src/engine/skills/酒.ts` — 补充完整规则描述:两种使用方法、FAQ

### Removed

- `scripts/check-coverage.mjs` — 无用覆盖检查脚本
- `scripts/repro-duel.mjs` — 无用重放脚本(依赖 v2 遗留路径)

### Verified

- 9 新引擎测试文件全绿(21 passed, 4 skipped)
- 类型检查:0 新错误(遗留 1000+ v2 预存错误)

### Engine v3 P0 重构启动 — 按 ENGINE-DESIGN.md 在 `src/engine/` 重写核心

将 `src/engine/*` 整体迁至 `src/engine/_legacy/`(参考保留),在 `src/engine/` 重新实现新引擎核心(types/atom/settlement/skill/skill-loader/event-stream/create-engine)。首批交付 38 atom + 10 skill(4 基本牌 + 5 武将 6 技能)。


### Infrastructure — 集成收尾 + 测试框架 + 技能/atom 指南(2026-06-14)

- **前后端集成收尾**:`skillActionRegistry`/`GameView`/`MultiplayerGameBoard` 的 ownerId/viewer 从 string 改 number(座次下标),对齐座次解耦。
  GameView 加 `preceding` 支持(组合 action 透传,武圣两步 UI)。dispatch 全链路类型对齐。
- **测试框架修复**:`findValidCard`/`findValidTargets` 修座次对齐;加 `expectAtoms`/`expectExactAtoms` 断言;加 `transformThenUse` helper(转化技);`distribute` target 改 number。
- **docs/guides/添加技能.md**:技能实现生产手册。含引擎模型、4 类技能模板(锁定/主动/转化/防具武器 HookResult)、SkillTestHarness 测试方法、实现 Checklist、3 步式 AI 提示词(分析→实现→测试,每步强调文档为事实依据防幻觉,缺 atom 先建)。
- **`.claude/skills/`**:`/add-skill`(添加武将技能,三步式:分析→实现→测试,带防幻觉约束+缺失 atom 检查)、`/add-atom`(添加引擎原子操作)。SKILL.md 精简(核心流程+硬约束),详细模板留在 `docs/guides/` 作为 supporting file 引用。

### Docs — 引擎能力边界分析(2026-06-14)

- **ENGINE-DESIGN.md §4.4**:新增"多人响应"说明——验证了无懈可击(抢占式)、濒死求桃(逐个询问)、于吉蛊惑(扣牌+揭示)都能用"单槽 pending + for 循环 + 状态观察"表达,**不需要打破"同时只一个 pending"不变量**。
  三国杀所有多人交互都是依次串行(非并发),抢占式无懈是数据层约定(请求回应声明合法回应者集合)。
- **ENGINE-DESIGN.md §6.1**:修正"原子性保证"——before 钩子现通过 HookResult(modify/cancel)干预,非"不能修改/取消"。杀示例座次改 number。
- **docs/design/引擎缺失能力.md**:重写。核心结论:**引擎执行模型能表达全部技能**,所有缺口均为数据层(atom/字段)或机制已就绪(HookResult),无执行模型改动。逐项标注性质(数据层/已就绪)和优先级。

### Added — 组合 action + 影子卡牌(转化技重构)(2026-06-14)

- **组合 action(preceding)**:`ClientMessage` 加可选 `preceding` 字段——在主 action 前顺序执行的前置 action 序列(转化类)。
  dispatch 逐个 validate+execute;主 action validate 失败时,对已执行的 preceding 按逆序调用 `rollback` 恢复 state(不用快照,action 自带回滚)。
  `ActionEntry` 加可选 `rollback`;`registerAction` 加第 6 参数。
- **影子卡牌(转化模型)**:转化技(武圣)不再 mutate cardMap,而是新建影子 Card(`${id}#${skill}`,`shadowOf` 指向原卡)。
  原卡属性全程不变;影子入弃牌堆时 `移动牌` atom 用 `shadowOf` 还原为原卡。
  杀技能零感知武圣——它看到的永远是 cardMap 里的一张"杀"。
- **武圣迁移**:武圣.transform 作为 preceding action(创建影子 + 手牌替换 + rollback 删除影子)。
  删除旧 `wrapAsKill`/`unwrap`(cardMap 全局 mutate)和死代码 `武圣包装`/`武圣还原` atom。
- 新增 `tests/integration/composite-action.test.ts`(3 测试:转化+使用成功 / preceding validate 失败丢弃 / 主 action validate 失败 rollback)。
  (`types.ts` Card.shadowOf/ClientMessage.preceding/ActionEntry.rollback;`create-engine.ts` dispatch preceding 循环 + rollback;`skills/武圣.ts` 重写;`ENGINE-DESIGN.md` §3.1 重写)

### Refactor — 引擎优雅度重构(2026-06-14)

- **HookResult 取代 dropAtom**(review B1):before 钩子返回 `HookResult`(`pass`/`modify`/`cancel`)取代隐式 `dropAtom` flag。
  - `modify`:修改 atom 参数,管线用新值继续(藤甲 -1 → 白银狮子看到减过的伤害,叠加生效,座次序)。消除了 6 个防具/武器技能的 drop+reapply+guard-mark 反模式。
  - `cancel`:取消当前 atom,推 notify 事件(非静默),仁王盾/寒冰剑用此。
  - 折叠(folding)语义:before hooks 按注册顺序串行折叠,而非第一个 drop 就 break。
  - 修复 guard mark 永久残留 bug(藤甲/护甲 `scope:-1` 从不清理 → 只触发一次)。
  (`types.ts` HookResult;`create-engine.ts` applyAtom 折叠循环;6 skill 迁移;`ENGINE-DESIGN.md` §4.2/4.5/6.1 更新)
- **双重注册**:`instantiateSkill` 改幂等(先 `unloadSkillInstance` 再注册),修复 skill 实例重注册的 `already registered` 抛错。
  `bootstrap` 非幂等——已开局 state(玩家已发牌)重入直接抛错(状态变更不可回滚)。
- **restore 取代 rebootstrap**:旧的 `rebootstrap`(遍历 player.skills 注册实例)逻辑错误。
  改为 `restore(state, config, actionLog)`:跳过开局条目,逐条 `dispatch` 重放 actionLog,确定性重建完整 state + skill 注册。
  `session.restoreState` 改用 create+bootstrap+restore 全量重放(config 从 state.rngSeed+全局 CHARACTERS 重构)。
  原遍历式注册保留为 `registerSkillsFromState`(bootstrap 内部 + 测试用,语义清晰)。
- **dispatch 瘦身为纯路由**:`dispatch` 返回 `void`(删 `DispatchResult` 类型),不再返回 `error`/`gameOver`。
  - validate 失败/无匹配 → 静默丢弃(无返回值暴露)
  - 回应路径:先执行 respond execute,再 resolve slot,父 execute 续跑
  - 游戏结束不再由 dispatch 返回——`checkGameOver(state)` 导出为纯函数,session 在 dispatch 后自行调用(游戏结束从 state/atom 日志可读,不绑定单个 action)
- **座次解耦**:引擎层所有 player/target/source/ownerId 从 string(玩家名)改为 number(座次下标)。
  引擎只认座次,玩家真实 ID ↔ 座次映射在 session 层(`playerNames: Map<WS, number>`)。
  `SYSTEM_OWNER = '系统'` 改为 `-1`(消除玩家名冲突风险)。`PlayerState.name` 保留为展示名。
  (`types.ts` Atom 联合 + 全部接口;`create-engine.ts`/`skill.ts`/`atoms/*`/`skills/*`/`session.ts`/`protocol.ts`/`distance.ts`/`buildView.ts`;测试全量迁移)
- **gameConfig 显式传参**:`bootstrap(state, gameConfig)` 显式接收配置,删除 `state._gameConfig` 隐式 stash(避免序列化污染)。
- **低风险清理**:
  - 删 `settlement.ts` 死模块(create-engine.ts 有同名实现,幽灵代码 + 双实现语义冲突)
  - 删 `SettlementFrame.cards` 死字段 + `EngineApi` 死类型
  - `logAction.id` 改 `seq`(确定性,支持重放)替代 `Date.now()-random`
  - pending `startTime/deadline` 改相对时间(`Date.now() - state.startedAt`),符合 §7.5
  - `GameView.players[]` 加 `index` 字段;`ViewEventSplit.ownerViews` key 改 number

### Fixed — 引擎 review P0 修复(2026-06-13)

- **动态技能生命周期(§4.13)**:`添加技能`/`移除技能` atom 现在真正触发实例化/卸载。
  之前 `apply` 只改 `player.skills` 列表,后端 action/hook 从未注册——动态获得的技能(装备、觉醒、化身)全坏。
  修复:`applyAtom` 在 apply 后为这两个 atom 补 `instantiateSkill`/`unloadSkillInstance`(引擎管理,与 `判定` 特殊处理同构)。
  (`src/engine/create-engine.ts` applyAtom;新增 `tests/integration/dynamic-skill.test.ts` 4 测试)
- **双重注册 P0**:`instantiateSkill` 改幂等(先 `unloadSkillInstance` 再注册),`bootstrap` 的 `开局:系统:start` 注册前先卸载。
  修复并发 rebootstrap / bootstrap 重入时的 `Action "X:Y:Z" already registered` 抛错(原 review 问题 7)。
  (`src/engine/skill.ts` instantiateSkill 导出+幂等;`src/engine/create-engine.ts` bootstrap)
- **stable-wait 时序契约**(review 问题 5):dispatch/回应路径必须直接 `await state._waitForStable`,
  不能用 async 包装 + Promise.race——额外微任务 tick 会破坏 杀.execute 的 pending 创建与 dispatch 恢复时序(pendingSlot 在 resolveStable 前被清空)。
  未加超时兜底:引擎是确定性状态转移,execute 卡死属契约违反,应由 session 层 pending timeout 处理,引擎层不用墙钟时间容错。
- **技能测试缺失 await**:`tests/skill-tests/{杀,遗计,contract}.test.ts` 的 `harness.setup()` 是 async 但调用处漏 `await`,
  导致并发 setup 在模块级注册表上竞争 → unhandled rejection。补齐 `await`。
- **dispatch 瘦身(纯路由+校验)**:删除两处 dispatch 违规逻辑,回归"匹配不到/校验失败即丢弃"。
  1. 删 `装备通用` 特殊路由(dispatch 原本检查 `card.type === '装备牌'` 改路由到 `装备通用`——dispatch 不该认识业务概念;该路径无测试覆盖,装备应通过 `skillId: '装备通用'` 路由)。
  2. 删回应路径无匹配 entry 时的 `Object.assign(frame.params, message.params)`(违反 §4.3 frame.params 只读)。
  回应路径语义:pending 目标的回应无论是否有效(校验失败/无 entry)都必须 resolve slot——
  目标不出牌即"未有效回应",父 execute(杀)继续结算;slot 保持挂起会死锁。

### Verified
- 目标测试:`tests/integration/{new-engine-*,create-game,restore-from-log,dynamic-skill,system-owner-id}.test.ts tests/skill-tests/` 全绿(26+ passed | 4 skipped)
- 全量基线:34 passed(新引擎),155 failed(v2 legacy 引用已删模块,预存)
- `pnpm tsc --noEmit`:0 新引擎错误(types.ts 的 3 个 ViewEvent 索引签名错误为预存)


### Added

- `docs/superpowers/specs/2026-06-09-engine-rewrite-design.md` — 引擎重写 spec
- `docs/superpowers/plans/2026-06-09-engine-rewrite.md` — 17 Task 实现计划
- `src/engine/types.ts` — `GameState` / `Atom` 联合(spec §5 全集) / `ActionPrompt` / `Skill` / `SettlementFrame` / `ClientMessage` / `BackendAPI` / `FrontendAPI`
- `src/engine/atom.ts` — atom 注册表 + 同步 apply
- `src/engine/settlement.ts` — 结算区栈骨架(push/pop/top)
- `src/engine/skill.ts` — 技能模块注册表
- `src/engine/skill-loader.ts` — 玩家技能查询骨架
- `src/engine/event-stream.ts` — per-player 事件流骨架
- `src/engine/create-engine.ts` — `createEngine()` 工厂
- `src/engine/view/buildView.ts` — `GameState → GameView` 派生(viewer 隔离手牌)
- `src/engine/atoms/*.ts` — 38 atom(摸牌/弃置/移动牌/获得/给予/抽牌/装备/卸下/洗牌/重洗/整理牌堆/造成伤害/回复体力/失去体力/击杀/设上限/加去标记/清过期标记/设横置/加去标签/添加移除技能/回合开始结束/阶段开始结束/设阶段/下一玩家/指定目标/判定/添加移除延时锦囊/拼点/询问闪杀/请求回应)
- `src/engine/skills/杀.ts` `闪.ts` `桃.ts` `酒.ts` — 4 基本牌(registerAction)
- `src/engine/skills/仁德.ts` `激将.ts` `护甲.ts` `制衡.ts` `武圣.ts` `遗计.ts` — 5 武将 6 技能(刘备/曹操/孙权/关羽/郭嘉)
- `tests/engine-smoke.test.ts` — 4 烟雾测试
- `src/server/protocol.ts` — 新 `EngineClientMessage` 协议(删老 SequencedEvent/EventSeq)
- `src/server/session.ts` — 切到 `createEngine().dispatch()`(删老 createAsyncEngine/GameAction/AsyncHookRegistry)
- `src/server/persistence.ts` — 序列化 `GameState` + `ActionLogEntry[]`(删老 action replay)
- `src/server/app.ts` — 删老 pendingToAction/handleAsyncHookResponse/handleResponse,所有 action 走新 ClientMessage
- `src/client/components/NewEngineDemo.tsx` — client-side 直接调新 `createEngine().dispatch()` 试用
- `tests/integration/server-gameplay.test.ts` — 服务端玩法集成测试(P1出杀→P2扣血 + CAS 校验)
- `src/client/components/GameView.tsx` — 新 ENGINE-DESIGN 游戏视图(渲染 GameView + 发 ClientMessage)
- `src/client/hooks/useDebugLobbyController.ts` — 重写,存 GameView,发 ClientMessage(删老 SequencedEvent/reduceGameState)
- `src/client/components/DebugLobby.tsx` — 用 GameViewComponent 替代 DebugPlayerList
- `src/engine/types.ts` — 删除重复 GameView 接口(缺 marks 字段)
- `src/client/components/MultiplayerGameBoard.tsx` — 重写,用 GameView + ClientMessage 替代 FrontendState/reduceFrontend
- `src/client/components/ReplayBoard.tsx` — stub(老 ReplayEngine 依赖 SequencedEvent,待重写)
- `src/client/utils/logFile.ts` — serialize/deserialize 替换为 JSON.stringify/JSON.parse

### Changed

- `src/engine/atoms/摸牌.ts` — `slice(-count).reverse()`(牌堆顶→入手首位,Sanguosha 惯例)
- `src/engine/atoms/弃置.ts` — `cardIds: string[]`(spec 用 `cardId` 单数,本实现用复数更贴合多张弃牌场景)
- `src/engine/atoms/造成伤害.ts` — `cardId?: string` 字段(spec 用 `damageType`,本实现附加 cardId 便于技能如护甲判断)
- `src/engine/atoms/添加延时锦囊.ts` — `trick: PendingTrick`(匹配 spec `PendingTrick` 接口)
- `src/engine/skills/杀.ts` — `killsPlayed` 持久化到 `player.marks`(每 turn 自动清理),而非 `frame.params`(settlement 局部)
- `src/engine/skills/酒.ts` — 加 `onAtomBefore('造成伤害')` 钩子消费 `酒/nextKillDamageBonus` mark,实现酒+杀=2 伤害
- `src/engine/skills/护甲.ts` — 加 `护甲/applied` guard mark 防 onAtomBefore 递归 re-entry

### Removed

- `src/engine/*` 全部内容 → `src/engine/_legacy/*`(`src/engine/` 仅含新代码 + `_legacy/` 参考目录)

### Verified
- `pnpm vitest run tests/engine-smoke.test.ts`: 4/4 passed
- `pnpm vitest run tests/integration/new-engine-*.test.ts`: 9/9 passed
- `pnpm vitest run tests/integration/server-gameplay.test.ts`: 2/2 passed
- `pnpm tsc --noEmit`: 0 新引擎错误(`_legacy/` 148 个错误为预期,旧代码未动)
- 0 新代码 import `_legacy/`
- 0 内联 `import("...")`(全部顶级 `import type`)

### Spec Deltas (待 spec 更新)

- `弃置` 复数 `cardIds`(spec 单数 `cardId`)— 实用主义
- `造成伤害` 字段 `cardId`(spec 用 `damageType`)— 同时保留 spec 的 DamageType 概念可在后续 PR 补
- `回复体力` `source` 可选(spec 必填)— 自然恢复场景不应强制 source
- `添加延时锦囊` 用 `trick: PendingTrick` 对象(spec 写 flat `trickName + source`)— 修复 PR 3 review 发现的 critical 不匹配
- `询问闪` / `询问杀` 加 `source` 字段(spec 无)— 前端需展示攻击来源

### Pending Follow-ups

- PR 5: 服务端接通(`src/server/protocol.ts` + `session.ts` 切到新 ClientMessage)
- PR 6: DebugLobby 复刻
- PR 7-10: 17 锦囊 + 8 装备
- settlement frame awaits 完整实装(目前简化:杀/闪同步模拟,武圣/遗计/激将为骨架)
- 武圣牌包装/还原机制(`CardWrapper` 完整实装)
- 洗牌 RNG 接入(目前 no-op)
- 30+ skill e2e 测试(plan §6.2 列出)

### Documentation
- 2 条新 ADR 待写(`src/engine/_legacy/` 清理时机 + v2 删除)

### Engine v3 P0 PR 5 — createEngine().dispatch() 完整实装

新引擎核心完整跑通:`createEngine().bootstrap(state)` 启动时按 per-player 实例化所有 skill,`dispatch(state, ClientMessage)` 走"主动 action 压栈 → 路由 → validate → execute → 弹栈"全流程,`frame.apply(atom)` 触发 before/after 钩子 + atom apply pipeline。

### Added

- `src/engine/settlement.ts` — makeFrame/pushFrame/popFrame + DropAtom sentinel + 完整 apply pipeline(before 钩子可 drop + modifyParams,after 钩子可 modifyParams + apply 新 atom,awaits 同步 resolve)
- `src/engine/skill.ts` — 完整实装:`registerActionEntry` / `findActionEntry` / `registerHookEntry` / `getBeforeHooks` / `getAfterHooks` / `instanceUnloads` 管理 / `makeBackendAPI` 返回带 `self` 字段
- `src/engine/create-engine.ts` — `createEngine()` 工厂,返回 `EngineInstance` 含 `dispatch` / `buildView` / `bootstrap` / `resetForTest`
- `tests/integration/new-engine-kill.test.ts` — 出杀全流程(3 测试):无回应扣血、limit 验证、未注册 action 静默丢弃
- `tests/integration/new-engine-hujia.test.ts` — 曹操护甲(锁定被动):黑色杀吸收
- `tests/integration/new-engine-rende.test.ts` — 刘备仁德:给 2 张牌后回复 1 血

### Changed

- `src/engine/types.ts` — `SettlementFrame` 加 `apply/modifyParams/notify` 方法;`BackendAPI` 加 `readonly self: string` 字段;`GameView.players` 加 `marks: Mark[]`;新增 `ActionEntry` / `AtomHookEntry` 内部 registry 类型
- `src/engine/view/buildView.ts` — 传递 `marks` 到 GameView

### Verified

- `pnpm vitest run tests/engine-smoke.test.ts tests/integration/new-engine-*.test.ts`: **9/9 PASS**(4 文件)
- `pnpm tsc --noEmit`: 0 新引擎错误
- 新引擎独立可运行:`createEngine().bootstrap(state).dispatch(state, msg)` 跑出杀全流程、护甲减伤、仁德给牌回复血

### Pending Follow-ups

- PR 6: DebugLobby 复刻(改 3 个 client 文件用新 engine dispatch)
- PR 7-10: 17 锦囊 + 8 装备(按 plan §4.1)
- server 切到新 engine:目前 server 仍 import `_legacy/create-engine` 路径,需要按新 ClientMessage 重写 session.ts dispatch
- `frame.apply(atom)` awaits 异步等待实装(目前是同步 resolve 占位)
- settlement frame 超时/断线机制
- 30+ skill e2e 测试覆盖
### Engine v3 ATOM_GAME_EVENTS 自动派发 — emitEvent 调用点从 11 处降至 4 处

将 `ATOM_GAME_EVENTS` 自动 emitEvent 管道集成到 `applyAtoms` 主入口，消除手工 `emitEvent` 调用。

### Added

- `engine/atom-game-events.ts` — 扩展映射：新增 `阶段开始`/`阶段结束`/`回合开始` 三种 atom→event 映射
- `engine/atom.ts` — `applyAtoms` 在 onAfter 钩子之后自动检查 `ATOM_GAME_EVENTS`，匹配时调 `emitEvent`；新增 `aborted` 标志位处理 pending 中断
- `engine/phases/atoms.ts` — 新增 `hadPending` 检查，避免在已有 pending 的技能执行中误中断

### Removed

- `engine/phase-advance.ts` — 删除 `processPhaseStep` 中 phaseBegin/phaseEnd 和 `advanceToInteractivePhase` 中 turnStart 的手工 `emitEvent` 调用（3 处）
- `engine/handlers/engine-utils.ts` — 删除 `applyDamage` 中手工 `emitEvent(受到伤害)` 调用（1 处）
- `engine/phases/atoms.ts` — 删除 ATOM_GAME_EVENTS 手工调用代码块（3 处）


### Engine v3 阶段 D 准备 — 58 个 v2 stub 技能去 trigger + hasWushuang 改 v3 真相源

为阶段 D（删 v2 基础设施：`state.triggers` / `emitEvent` / `registerSkill` / 全局 registry）做前置安全清理——所有空 handler 的占位 stub 技能去 v2 trigger 字段。

### Changed

* `engine/handlers/card-handlers.ts` — `handleKillCard` 中 `hasWushuang` 判定从 `state.triggers.some(...)` 改用 `hasSkill(state, player, '无双')`（[P5-T2] v3 真相源：`PlayerState.skills`）
* `tests/scenarios/蜀/卧龙诸葛.test.ts` — 火计/看破 注册检查从 `state.triggers` 断言改 `ctx.player('P1').skills`（v3 真相源）
* `tests/scenarios/蜀/庞统.test.ts` — 连环 注册检查同上

### Removed

* 58 个 v2 stub 技能（handler 是空 `[]`，v2 派发本就无效）删 `trigger` 字段：
  * 5 个孤儿 stub 文件（无双/不屈/周泰/化身/新生）
  * 22 个孤儿 stub 文件（乱武/倾国/制霸/双雄/咆哮/固政/天义/天香/急救/断肠/暴虐/武圣/流离/激将/缔盟/肉林/蛊惑/谦逊/酒池/鬼道/黄天/龙胆）
  * 24 个多技能文件中的 stub 技能（华佗急救、董卓酒池肉林暴虐乱武、蔡文姬断肠、左慈化身新生、颜良文丑双雄、张角鬼道黄天、甄姬倾国、小乔天香、孙策制霸、陆逊谦逊、张飞咆哮、大乔流离、鲁肃缔盟、太史慈天义、张昭张纮固政、赵云龙胆、卧龙诸葛火计看破、庞统连环、吕布无双、火计/看破/连环/急救 4 个独立 stub 文件）
  * 3 个孤儿 stub 文件（火计/看破/连环 完整清理）

### Verified

* `npx vitest run`: **1413 passed**, 40 skipped, 0 failed
* v2 路径未破坏：剩余 109 个 v2 trigger 兜底技能继续工作（全是真实 handler）
* `hasWushuang` 计算路径（吕布杀需 2 闪）行为不变

### Engine v3 P5 T1 — chained 迁移 Mark 体系

将 `chained`（铁索连环）状态从 `PlayerState.chained` 字段迁移到 Mark 体系。

### Changed

- `engine/mark.ts` — 新增 `hasMark` / `hasChained` / `CHAINED_MARK` 导出；`clearExpiredMarksByPhase` 中文 phase 名
- `engine/atoms/setChained.ts` — `设横置` atom 改写为 `addMark` / `removeMark` 入口
- `engine/equipment/chained-propagation.ts` — 伤害传导读取 `hasChained` 替代 `PlayerState.chained`
- `engine/view/reducer.ts` — `设横置` server event 处理走 Mark
- `engine/types.ts` — 移除 `PlayerState.chained` 字段
- `engine/state.ts` — 移除 `chained: false` 初始值
- `client/components/debug/DebugPlayerList.tsx` — 移除 `chained: false` 默认值

### Tests

- `tests/atoms/player-chained.test.ts` — 适配 Mark 体系断言
- `tests/atoms/set-chained.test.ts` — 新增幂等性测试 + Mark 断言适配
- `tests/integration/p1-event-handlers.test.ts` — 设横置走 Mark 断言
- `tests/scenarios/设备/大雾-真规则.test.ts` — 用 `addMarkToPlayer` 替代手动构造 chained
- `tests/scenarios/设备/铁索连环.test.ts` — 用 `addMarkToPlayer` 替代手动构造 chained
- `tests/scenarios/设备/雷电-连环.test.ts` — 用 `addMarkToPlayer` 替代手动构造 chained

### Documentation

- `docs/ENGINE.md` — §4.8 更新为"持续状态走 Mark 体系"；§6 P5 表格 chained 行标 ✅

---

## [Unreleased] — 2026-06-05

### Engine v3 P0 — 引擎核心扩展

按 `docs/ENGINE.md` §6 P0 表格落地 6 项改进，**12 commits** 跨 6 Task。

### Added

- `engine/atoms/reshuffle.ts` — 抽 `reshuffle` atom（修 §4.7 重洗不写 serverLog）
- `engine/atoms/giveCard.ts` / `takeCard.ts` — 13+ 技能语义统一（仁德/突袭/反间/好施/黄天/集智/借刀失败/归心/反馈/烈刃/雷击/顺手牵羊/过河拆桥）
- `engine/atoms/specifyTarget.ts` / `becomeTarget.ts` / `resolveCard.ts` — useCard 三阶段原子
- `engine/atoms/compareRank.ts` — 拼点比较原子（5 拼点技能基础设施）
- `engine/phases/pindian.ts` — pindian SkillPhase 骨架
- `engine/phases/multiStep.ts` — multiStep SkillPhase 骨架
- `engine/skills/wansha.ts` / `kongcheng.ts` / `weimu.ts` — 用 `registerAtomHook` 实现演示技能
- ADR 0014-0017 文档

### Changed

- `engine/atoms/draw.ts` — `reshuffleIfNeeded` 替换为 onBefore 钩子调用
- `engine/view/reducer.ts` — `applyGameStateEvent` 加 `case 'reshuffle'` no-op
- `engine/atom.ts` — 导出 `clearAtomRegistry`；re-export `registerAtomHook` / `clearAtomHooks`
- `engine/skills/qun.ts` — 移除 v2 `完杀` / `帷幕` stub（避免与 v3 重复 registerSkill）
- `engine/skills/shu.ts` — 移除 v2 `空城` stub
- `engine/types.ts` — Atom 联合 +5 变体（reshuffle / giveCard / takeCard / specifyTarget / becomeTarget / resolveCard / compareRank）；SkillPhase 联合 +2 变体（pindian / multiStep）；`cardPlayed` GameEvent 加 `@deprecated`
- `engine/phase.ts` — 转发 `result.error`
- `engine/phases/index.ts` — 注册 pindian + multiStep
- `tests/scenario-runner.ts` — `applyAtoms` 辅助方法
- `tests/engine-helpers.ts` — `TestGameOptions` 加 hand / deck 选项

### Tests

新增 25+ 单元/场景测试：

- `tests/atoms/reshuffle.test.ts` (4 测试)
- `tests/atoms/give-take-move.test.ts` (5 测试)
- `tests/atoms/use-card-lifecycle.test.ts` (4 测试)
- `tests/unit/pindian.test.ts` (7 测试)
- `tests/unit/multi-step.test.ts` (1 测试)
- `tests/scenarios/群/完杀.test.ts` (3 场景)
- `tests/scenarios/蜀/空城.test.ts` (5 场景)
- `tests/scenarios/群/帷幕.test.ts` (3 场景)

### Verified

- `pnpm test`: **1306 passed**, 38 skipped, 1 pre-existing flake (`tests/unit/memo.test.tsx` timing)
- `pnpm typecheck`: clean
- v2 路径未破坏（38+ 老 `trigger.event` 技能继续工作）
- v2 → v3 迁移的 3 个演示技能（完杀/空城/帷幕）通过 `registerAtomHook` 实现，作为 [T-25] 渐进迁移模板

### Known Issues / P1 Follow-ups

- `engine/view/reducer.ts` 缺 `giveCard` / `takeCard` case（13+ 技能 v3 迁移时必须修）
- 引擎 entry 未在 card handler 关键点 emit 3 个 useCard atom（借刀/五谷/桃园 v3 实现时补）
- 38+ `trigger.event` 技能未迁移到 `registerAtomHook`（[T-25] 渐进迁移 + [T-22] 2 周稳定期后删 v2）
- pindian 双方选牌 pending 表达留 P1
- multiStep step 级 resume 留 P2
- `damage.type` 字段 / `chained` 状态 / 4 武器 stub / 八卦阵 var 不读 等 P1 改进未触及

### Documentation

- `docs/ENGINE.md` §0.3 §4.7 标 ✅ 已修
- `docs/ENGINE.md` §6 P0 全部标 ✅ 完成
- 4 条新 ADR（0014-0017）

---

## 历史

早期版本变更见 git log（`b047166` 之前的 commit 历史）。
