# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — 2026-06-10

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
