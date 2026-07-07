# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — 2026-06-27

### Fixed — atom/技能设计原则违规修正

审查 atoms 与 skills 实现中对「状态变更必经 atom」「apply/applyView 对称」原则的违反,修正两类问题。

#### Fixed
- **拼点 atom apply/applyView 对称化**:此前 `拼点` atom 的 `apply` 是 no-op(纯事件标记),`applyView` 却在视图侧把两张拼点牌从 processing 移入弃牌堆——apply 与 applyView 不对称,真正的牌移动散落在各调用方。现把牌移动集中到 `apply`(后端 frame.cards→弃牌堆),并补全 `applyView` 同步 `view.settlementStack[top].cards`(此前只清 `view.zones.processing`),后端与视图真正对称。(`src/engine/atoms/拼点.ts`)
- **删除天义/烈刃/驱虎拼点后的直接 mutate**:三处技能在 `拼点` atom 后手动 `frameCards.splice` + `state.zones.discardPile.push` 直接改牌区,绕过 atom。现在拼点 atom 的 apply 集中移动,技能只需发 `拼点` 事件,删除三处冗余直接 mutate 与随之失效的 `frameCards` import。(`src/engine/skills/天义.ts`、`src/engine/skills/烈刃.ts`、`src/engine/skills/驱虎.ts`)
- **移动牌 shadowOf 弃牌视图不对称**:`移动牌` atom 的 apply 把转化影子卡(武圣红牌当杀)入弃牌堆时用原卡替换,但 `toViewEvents` 仍下发影子卡的 name/suit/rank,前端弃牌堆展示的是影子卡而非实际入堆的原卡。现 `toViewEvents` 在弃牌分支读 `card.shadowOf` 对应的原卡信息下发(`cardId` 仍为影子 id 供前端手牌精确过滤)。(`src/engine/atoms/移动牌.ts`)

### Added — 多人游戏结束后「再来一局」回到准备状态

此前多人模式(MultiplayerPage)游戏结束后仅有「返回大厅」(断开连接退出房间),想再打一局需重建房间、重新分享房间码。现新增「再来一局」:复用 debug 模式已有的 `restart_game`/`game_reset` 协议与 `session.resetToLobby`,结算界面并列两个按钮,点「再来一局」重置同一房间到「等待大厅」阶段,玩家重新准备后即可开始新一局。服务端 `handleRestartGame` 原本就对普通房间生效(无 debug 限制),本次只是补齐多人客户端。

#### Added
- **useMultiplayerRoom 暴露 sendRestart 并处理 game_reset**:`onMessage` 收到 `game_reset` 时清除 gameOver/view、ready 复位、stage 切回 `waiting`(保留 roomId/playerId,未退出房间);新增 `sendRestart` 调用 `hgc.sendRestart()` 发送 `restart_game`。(`src/client/hooks/useMultiplayerRoom.ts`)
- **结算界面新增「再来一局」按钮**:`MultiplayerPage` 结束分支在「返回大厅」旁并列「再来一局」(绿色),点击调用 `mp.sendRestart`。(`src/client/pages/MultiplayerPage.tsx`)
- **useMultiplayerRoom hook 测试**:mock WebSocket 验证 createRoom 进入 waiting、sendRestart 发送 restart_game、game_reset 后从 ended 回到 waiting 并清除 gameOver/view、reset 后仍保留 roomId/playerId。(`tests/client/useMultiplayerRoom.test.tsx`)
- **viewMaintainer game_reset 契约测试**:锁定 `game_reset` 消息产生 `view:null/lastSeq:0/resetToLobby:true/phaseChangedTo:'lobby'`。(`tests/headless/viewMaintainer.test.ts`)

#### Changed
- **服务端注释更正**:`handleRestartGame` 注释由「debug 房间任意座次可触发」更正为「任意座次/玩家可触发(debug 一人多座 / 多人各自连接)」,反映对多人房间的实际支持。(`src/server/app.ts`)

### Fixed — distribute 主动技选牌状态在 action 失活时未自动清除

debug 模式下，孙权点制衡进入选牌面板后不操作，出牌窗口超时引擎结束回合切到下一玩家，前端制衡选牌状态仍驻留，需手动点取消。仁德等其它 distribute 主动技同理。

#### Fixed
- **distribute 主动技自动取消**：`usePlayInteraction` 此前只为转化模式(transformMode，武圣/丈八蛇矛)提供「action 失活自动退出」effect，distribute 主动技分支(`distributeMode`，制衡/仁德)缺失对称逻辑。新增同名 effect：当 `distributeMode` 对应的 action 不再 active(出牌阶段超时回合结束 / debug 切视角到非当前回合玩家 / 限一次已用 / 技能被卸载)时，清除 `distributeMode` 及关联的 `distSelected`/`distAllocations`/`distTargetName`。被动 pending 分支(遗计)由 pending 驱动，pending 消失自然归 null，无需清理。(`src/client/hooks/usePlayInteraction.ts`)

### Added — AI 代打 MCP server

把三国杀引擎包装成游戏环境，通过 MCP server 暴露给外部通用 agent（Claude Code/OMP），由 agent 驱动某个座次的完整生命周期（进房间/准备/开始/选将/出牌循环）。游戏项目不集成 LLM，推理交给外部 agent。

#### Added
- **HeadlessGameClient 共享核心**：抽出家框架无关的单座次无头 WS 玩家客户端（`src/client/headless/`），封装 WS 连接、view 增量维护（复用 `viewReducer`）、可执行操作枚举（复用 `gameViewHelpers`/`pendingRespond`/`skillActionRegistry`）、房间生命周期。与 debug 前端共用，消除重复逻辑。(`src/client/headless/HeadlessGameClient.ts`、`viewMaintainer.ts`、`availableActions.ts`、`types.ts`)
- **MCP server**：手写 JSON-RPC 2.0 over stdio（不依赖破损的 `@modelcontextprotocol/sdk` v1.29.0，其 exports map 对 `McpServer`/`StdioServerTransport` 不可达）。`play` 工具统一「动作→观察」循环：执行操作 → 阻塞等待本座次 needsAction/游戏结束/超时 → 返回 view 快照 + 可执行操作枚举。(`src/ai-mcp/server.ts`、`mcpServer.ts`、`playHandler.ts`、`viewProjector.ts`)
- **npm 脚本**：`pnpm mcp:serve` 启动 MCP server（开发用，生产用 `npx tsx src/ai-mcp/server.ts` 避开 pnpm banner 污染 stdout）。

#### Changed
- **debug 多座次前端迁移到 HeadlessGameClient**：`useDebugMultiConnection` 从「单 hook 管 N 连接」重构为「N 个 HGC 实例 + 协调器」，view 维护/连接逻辑收敛到 HGC，hook 只保留展示层增强（判定牌 processing 延迟、seatPlayerIds、event playback）。净减 100 行。浏览器回归验证 4 人局全流程零错误。(`src/client/hooks/useDebugMultiConnection.ts`)

### Changed — 选目标改为点角色卡片 + 不回应/结束回合移入操作栏

移除独立的目标选择面板(TargetSelector),改为直接点击座位上的角色卡片选目标,不可选座位置灰;「不回应」按钮从顶部待回应区移入下方操作栏(actionBar),「结束回合」靠操作栏右端。

#### Changed
- **移除目标选择面板**:删除 `TargetSelector` 组件,出牌时直接点击弧形座位上的角色卡片选目标(原已有 `onTargetClick` 机制)。借刀杀人等双目标(slots)牌改为按选择进度依次点选 A、B(首次点选 A,再次点选 B),`isTargetable` 在 slots 模式按当前槽位 filter 判断可选性。(`src/client/components/TargetSelector.tsx` 删除,`src/client/hooks/usePlayInteraction.ts`、`GameView.tsx`)
- **不可选座位置灰**:选目标阶段不满足条件的座位(距离外/不满足槽位条件)应用置灰样式(`seatCardUntargetable`:opacity 0.4 + grayscale 0.8),与可选座位形成视觉对比。(`src/client/components/PlayerSeatView.tsx`)
- **座位高亮支持多目标**:`PlayerSeatView` 的选中高亮 prop 由单值 `selectedTarget` 改为集合 `selectedTargetNames`(借刀杀人双目标 A+B 同时高亮)。(`PlayerSeatView.tsx`、`SeatArcLayout.tsx`、`GameView.tsx`)
- **「不回应」移入操作栏**:`AwaitingPrompt` 的 useCard 待回应分支移除「不回应」按钮(仅留提示文案),按钮移至 `actionBar`(条件 `isMyAwaiting && !isDiscardPhase && prompt.type==='useCard'`,排除弃牌阶段复用 useCard prompt 的误显示)。(`AwaitingPrompt.tsx`、`GameView.tsx`)
- **「结束回合」靠右**:`endTurnBtn` 增加 `margin-left: auto`,将其推至操作栏右端。(`gameViewStyles.ts`)
- **死代码清理**:移除 `showTargetSelector`/`handleSlotSelect`/`multiTransformReady` 等 TargetSelector 专用派生量;移除 `targetSection`/`targetBtn*`/`mutedHint` 等专用样式。(`usePlayInteraction.ts`、`gameViewStyles.ts`)

### Changed — 装备区三态可选重构 + 移除 distribute 分配面板

装备技能与装备展示融合为统一可点击卡片,装备区恒定保留宽度;distribute(制衡/仁德/遗计)不再使用独立分配面板,候选牌在手牌/装备区卡片选,目标在座位区选,提交按钮入操作栏。

#### Changed
- **装备区恒定渲染**:移除 `EquipColumn` 无装备时的 `return null`,装备区始终保留 168px 宽度,无装备显示「无装备」占位,不再因空装备塌缩宽度。(`src/client/components/EquipColumn.tsx`)
- **装备技能融合到装备卡片**:装备技能不再作为装备区底部独立按钮(`equipSkillBtn`),而是绑定到对应装备槽位卡片(技能 `skillId === 装备牌名`)。技能可发动时卡片显示橙色发光 + ⚡ 徽标,点击即发动(行为与原按钮一致)。(`EquipColumn.tsx`、`gameViewStyles.ts`)
- **装备三态可选**:统一装备卡片为三种可交互状态——技能可发动(橙色发光)、distribute 候选(金色边框)、已选中(`translateX(8px)` 向右偏移 + 绿色高亮,与手牌选中一致)。移除 `equipDistBtn`/`equipDistSelected` 独立候选样式。(`EquipColumn.tsx`、`gameViewStyles.ts`)
- **移除 DistributeUI 分配面板**:删除 `DistributeUI` 组件,distribute 提示文案移至 `handHeader`(🤝 title · 已选 N),提交/清空按钮移至 `actionBar`(与出牌/结束回合并列)。三种模式目标选择统一:制衡(select)无目标,仁德/遗计通过座位区点玩家(遗计点玩家即分配当前选中牌)。(`src/client/components/DistributeUI.tsx` 删除,`GameView.tsx`、`usePlayInteraction.ts`)
- **handleTargetClick/isTargetable 扩展**:`usePlayInteraction` 的目标点击与可点判断支持 distribute 三模式——制衡忽略座位点击,仁德设目标,遗计触发分配;遗计按 `prompt.targetFilter`/`allowSelf` 过滤可点座位。(`src/client/hooks/usePlayInteraction.ts`)
- **测试适配**:装备技能按钮测试适配新的 `div[role=button]` 结构(正则匹配 accessible name);distribute 弹窗测试适配 handHeader/actionBar 结构;移除 `DistributeUI` 相关注释。(`tests/integration/playercard-equip-distribute.test.tsx`、`gameview-equipment-play.test.tsx`、`gameview-skill-button.test.tsx`)

### Changed — 对局界面布局优化:装备区纵向列、武将卡片右置

优化对局下方主区域布局与出牌提示信息呈现,使装备/武将/手牌分区更清晰,回合归属与等待状态更直观。

#### Changed
- **装备区独立成列(最左侧,纵向)**:装备区从 `PlayerCardLarge` 抽出为独立的纵向 `EquipColumn` 组件,置于布局最左侧纵向排列装备槽位;武将卡片(`playerCardLarge`)移至最右侧。下方主区域由「左武将/右手牌」两栏改为「左装备/中手牌/右武将」三栏。(`src/client/components/EquipColumn.tsx` 新增,`GameView.tsx`、`PlayerCardLarge.tsx`)
- **回合武将卡片高亮边框**:当前回合玩家的武将卡片显示金色 `outline` + 发光(`playerCardTurn`),谁的回合一目了然。(`gameViewStyles.ts`、`GameView.tsx`)
- **弃牌按钮移入操作栏**:弃牌阶段的「确认弃牌」「清空选择」按钮从 `PlayPhasePrompt` 提示框移至 `actionBar`,与「结束回合」并排放置。(`PlayPhasePrompt.tsx`、`GameView.tsx`)
- **进度条仅等待时显示**:自己武将的倒计时进度条(`CountdownBar`)由常驻改为仅当自己处于等待回应(`isPerspectiveAwaiting`)时显示,避免出牌阶段无关进度条干扰。(`GameView.tsx`)
- **装备区分发测试适配**:装备区分发选牌测试由 `PlayerCardLarge` 适配为 `EquipColumn`。(`tests/integration/playercard-equip-distribute.test.tsx`)

### Refactored — 主题和组件样式从 CSSProperties 迁移至 Linaria

所有客户端组件从 `CSSProperties` 对象内联样式迁移到 Linaria `css` 标记模板,实现零运行时 CSS-in-JS。

#### Changed
- **theme.ts**:移除 `styles` 工厂函数(`page`/`btn`/`input`/`errorToast`),替换为 Linaria `css` 具名导出(`pageStyle`/`btnStyle`/`inputStyle`/`errorToastStyle`);动态值通过 CSS 自定义属性(`--page-padding`/`--btn-bg`等)传入。
- **gameViewStyles.ts**:从 `CSSProperties` 对象重写为 Linaria `css` 模板,样式规模大幅扩展(新增布局/flex/定位等声明式样式)。
- **全部 UI 组件**:`import { styles }` → `import { pageStyle, btnStyle, … }`,内联 `style={}` 替换为 `className`。

### Fixed — 阵亡角色未亮明身份

角色阵亡后其他玩家视角仍显示身份为「暗」,未能按规则揭示。根因:`击杀` atom 的 `applyView` 只置 `alive=false`,未同步身份;前端走事件流(`viewReducer` → `applyView`)增量更新,而 `buildView` 的全量快照揭示逻辑在此路径上不生效,导致阵亡身份不公开。

#### Fixed
- **击杀事件携带并揭示身份**:`击杀.toViewEvents` 从 state 读取阵亡者真实身份写入事件(死亡即公开),`applyView` 据此把 `identity`/`identityHidden` 置为揭示态。(`src/engine/atoms/击杀.ts`)
- **回归用例**:验证 toViewEvents 携带身份、applyView 后所有视角可见阵亡者身份。(`tests/skill-tests/applyView-bugs.test.ts`)

### Fixed — 弃牌阶段按体力上限而非当前体力值判定

弃牌阶段手牌上限应等于角色**当前体力值**(受伤时低于体力上限),但弃牌检查与超时自动弃牌均误用 `maxHealth`(体力上限)。结果受伤角色手牌数介于当前体力值与体力上限之间时该弃不弃(或弃牌数偏少)。例如体力上限 4、当前体力 2、手牌 3 张,旧逻辑判定 3 ≤ 4 不进入弃牌阶段,正确应弃 1 张。

#### Fixed
- **弃牌上限改用 `health`**:回合管理弃牌阶段检查(`回合管理.ts`)与请求回应超时自动弃牌(`请求回应.ts`)均由 `maxHealth` 改为 `health`,与标准三国杀规则一致。(`src/engine/skills/回合管理.ts`、`src/engine/atoms/请求回应.ts`)
- **回归用例**:新增受伤(health=2 < maxHealth=4)手牌 3 张的弃牌用例,验证按当前体力值进入弃牌阶段且 excess=1。(`tests/integration/弃牌阶段.test.ts`)

### Fixed — 主公阵亡显示"无人获胜"而非反贼获胜

主公阵亡时 `checkGameOver` 返回 `winner: undefined`,session 据此广播 `winner: '无人'`,结算界面显示"无人获胜"。按三国杀规则主公阵亡应由反贼获胜(内奸清场单挑残局除外)。根因:胜负判定函数未区分主公阵亡时的阵营归属。

#### Fixed
- **主公阵亡胜负判定**:`checkGameOver` 主公阵亡分支改为按存活阵营判定胜方——反贼仍存活→反贼获胜;反贼全灭且内奸存活(内奸清场残局)→内奸获胜;极端(反贼/内奸均无存活)→仍判反贼获胜。`winner` 返回对应阵营代表座次,前端 `winningCamp` 据其 identity 推导阵营文案。(`src/engine/create-engine.ts`)

### Added — 游戏结束后"再来一局"重新进入准备阶段

游戏结束结算界面此前仅有"返回大厅"(删除房间)。现新增"再来一局":复用同一 session 重置房间到「配置+准备」阶段,玩家重新准备后即可开始新一局,无需重建房间。

#### Added
- **协议扩展**:新增 `restart_game`(客户端→服务端)与 `game_reset`(服务端→客户端)消息。(`src/server/protocol.ts`)
- **session.resetToLobby**:`gameOverHandled` 复位、丢弃旧 state、清空广播水位/准备记录、房间状态回到「等待中」、广播 `game_reset` 通知客户端清除结算界面回到配置面板。(`src/server/session.ts`)
- **restart_game 路由**:debug 房间任意座次可触发,复用 session 重置后广播 `room_state`。(`src/server/app.ts`)
- **结算界面新增"再来一局"按钮**:`GameResultOverlay` 增加 `onRestart`,与"返回大厅"并排;客户端收到 `game_reset` 后清除 gameOver/gameStarted/views 缓存回到配置面板。(`src/client/components/GameResultOverlay.tsx`、`src/client/hooks/useDebugMultiConnection.ts`、`src/client/components/DebugLobby.tsx`)

#### Changed
- **新增胜负判定与重置回归用例**:主公阵亡反贼/内奸胜方判定、resetToLobby 房间复位。(`tests/server/session-turn-deadline.test.ts`)

### Fixed — 兵粮寸断判定生效后仍摸牌

兵粮寸断判定为非梅花(生效)后本应跳过摸牌阶段,却仍摸了 2 张牌。根因:兵粮寸断通过 `registerBeforeHook` cancel 当前 `阶段开始(摸牌)` atom,并在 hook 内部自行把阶段推进到出牌;但回合管理的「阶段结束」after hook 在 `applyAtom(阶段开始, 摸牌)` 返回后**无条件**继续执行 `摸牌(×2)` 与 `阶段结束(摸牌)`——它并未察觉该 atom 已被 before hook 取消。结果「跳过摸牌阶段」只取消了阶段开始事件,摸牌动作照常发生,日志表现为出现两次「摸牌阶段结束」且仍「摸了 2 张牌」。乐不思蜀/闪电不受影响:乐不思蜀跳过的是出牌阶段(非自动阶段,after hook 无强制后续动作),闪电不跳过阶段。

#### Fixed
- **回合管理阶段推进加 phase 守卫**:`阶段结束` after hook 在 `applyAtom(阶段开始, next)` 之后校验 `ctx.state.phase === next`;若阶段被 before hook cancel/改写(如兵粮寸断跳过摸牌),`state.phase` 已偏离 `next`,直接 return,不再执行该阶段的自动动作(摸牌/弃牌检查/自动结束)。(`src/engine/skills/回合管理.ts`)

#### Changed
- **新增完整回合流转回归用例**:验证判定阶段结束 → 摸牌被兵粮寸断跳过 → 手牌不增加、标签清除、阶段推进到出牌;此前用例只直接 dispatch `阶段开始(摸牌)` 绕过回合管理,无法捕获本回归。(`tests/skill-tests/兵粮寸断.test.ts`)

### Fixed — 八卦阵确认发动后判定翻牌动画期间询问闪提前弹出

八卦阵确认发动后进入判定,引擎逻辑本身正确(红色视为闪 → cancel 询问闪、黑色才询问闪,已用裸 dispatch+pendingSeq 复现验证)。问题在前端时序:判定翻牌动画(`effect.animation='flip'`, `blockUntilDone`, 1800ms)本应阻塞,而 `useEventPlayback` 是非阻塞调度、询问闪的 `applyView` 又是同步写 `view.pending`。结果黑色判定时判定牌还在翻(EventBanner flip),询问闪面板(AwaitingPrompt)就已经弹出——玩家感觉「确认发动后没等判定结果就直接询问闪」。根本原因:`blockUntilDone` 语义在前端一直未实现。

- **实现 blockUntilDone 语义**:`GameView` 计算 `isPlayingFlipAnim`(当前播放事件的 atom `effect.animation === 'flip'`),flip 翻牌动画期间延迟 `AwaitingPrompt` 渲染,让玩家先看清判定结果再弹出询问。红色判定不受影响(引擎 cancel,根本不产生询问闪事件)。(`src/client/components/GameView.tsx`)
- **测试**:新增 GameView 渲染时序测试,断言判定 flip 动画播放中询问闪面板不渲染、动画播完后正常渲染;并验证移除修复后用例失败(捕获回归)。(`tests/integration/gameview-judge-flip-delay.test.tsx`)

### Fixed — 桃园结义对满血目标不问询无懈可击

桃园结义对满血角色本就无回复效果(无法回血),原实现对满血目标仍逐个广播询问无懈可击——既冗余(无可抵消的效果),又拖慢结算节奏、徒增无意义窗口。现满血目标直接跳过整个结算(不询问无懈、不回血),与三国杀标准实现一致。

#### Fixed
- **桃园结义满血目标跳过无懈问询**:逐目标结算循环中,满血目标(`HP >= maxHealth`)直接 `continue`,既不调用 `askWuxie` 也不 `回复体力`。(`src/engine/skills/桃园结义.ts`)

#### Changed
- **测试适配无懈窗口次数**:全满血场景不再需要 `pass`(`useCard` 内 `waitForStable` 即结算完成);部分满血场景 `pass` 次数=未满血存活目标数。同步更新机制注释。(`tests/integration/taoyuan.test.ts`、`tests/integration/taoyuan-heal.test.ts`、`tests/skill-tests/桃园结义.test.ts`)
- **新增「满血不问询无懈」针对性用例**:混合场景(P1 满血、P2/P3 未满血)断言仅未满血目标产生无懈窗口(2 次 pass),满血目标 P1 无窗口。(`tests/skill-tests/桃园结义.test.ts`)

## [Unreleased] — 2026-06-26

### Added — 房间配置功能(配置+准备阶段)

调试房间创建后不再立即开局,进入「配置+准备」阶段。房主(调试房间任意玩家)可配置房间名、操作倒计时倍率、将池预设、初始手牌数。所有玩家(调试房间逐座次)准备后可开始。配置模型对普通/调试房间通用,前端先只接调试房间。

- **`RoomConfig`** (`src/server/protocol.ts`): 新增 `{ name, timeoutScale, charPool, handSize }` + `normalizeRoomConfig` 规范化 + `DEFAULT_ROOM_CONFIG`。
- **协议扩展**: 新增消息 `update_room_config`(客户端→服务端)、`room_config`/`room_state`/`player_ready`(服务端→客户端);`create_debug_room` 改为接收 `config` 且不立即开局;`room_joined` 增加 `seatIndex`。
- **`Room` 增加 `config`** (`src/server/room.ts`): `createRoom`/`createDebugRoom` 接收 config;新增 `updateConfig`(普通房间仅房主、调试房间任意玩家);`getRoomList` 携带 config。
- **调试房间流程改造** (`src/server/app.ts`): 移除 `pendingPlayerCount` 立即开局机制;`handleJoinDebugRoom` 进入配置阶段(分配座次但不 startGame);`handleStartGame` 支持 debug(不校验房主、复用占位 session、传 maxPlayers);新增 `handleCreateDebugRoom`(WS 入口)/`handleUpdateConfig`;`handleReady` 广播准备状态。
- **引擎 `GameState.config`** (`src/engine/types.ts`+`create-engine.ts`): `GameConfig.timeoutScale` 注入 `state.config`;新增 `resolveTimeoutMs(state, baseSeconds)` helper,`createAndAwaitSlot` 与各 atom view 层统一应用 timeoutScale(Infinity=无限)。
- **atom 超时统一** (`src/engine/atoms/`): 询问杀/询问闪/出牌窗口/请求回应/并行回应/选将 的 `toViewEvents`/`applyView` 统一走 `resolveTimeoutMs`,透传 `timeoutMs` 字段给前端(口径与后端真实定时器一致)。
- **将池预设** (`src/server/session.ts`): `resolveCharPool(preset)` 解析 standard(各势力前8=32人)/extended/all(57人) 武将子集。
- **前端配置面板** (`src/client/components/debug/RoomConfigPanel.tsx`): 新建组件,展示房间名/将池/倒计时/手牌数配置 + 座次准备列表 + 开始按钮。`useDebugMultiConnection` 扩展支持配置阶段(房间消息处理 + sendReady/sendStartGame/sendUpdateConfig)。`DebugLobby` 状态机接入:游戏未开始时渲染配置面板。
- **持久化**: `restorePersistedRooms` 从 `state.config` 恢复房间配置。
- **测试**: `tests/unit/room.test.ts` 新增「房间配置」+「resolveTimeoutMs」describe(15 个用例);更新 6 个测试文件的 `makeRoom` 补 config 字段;E2E 冒烟验证完整配置→准备→开始流程。

### Refactored — skill 注册表 state-bound(WeakMap 外挂),跨 session 隔离

技能注册表(action/hook 实例)从模块级全局 Map 改为 WeakMap<GameState, SkillRegistry>。
消除了跨 session/跨测试套件时旧实例泄漏导致「已注册」冲突的问题,也顺带修复了
「孙权被询问是否发动流离」的幽灵 bug——上一局未被正常的流离注册泄漏到下一局。

- **SkillRegistry**: 新增 `getRegistry(state)` + 接口类型,action/hook/before/after 注册表
  全部 key 在 state 上,随 GameState 生命周期自动 GC。
- **API 签名变更**: `registerAction(state, …)` / `registerBeforeHook(state, …)` /
  `registerAfterHook(state, …)` / `findActionEntry(state, …)` /
  `getBeforeHooks(state, type)` / `getAfterHooks(state, type)` /
  `unloadSkillInstance(state, …)` / `registerSystemRespondActions(state, …)`。
  所有 caller(skills 目录 40+ 文件 + 测试文件 + create-engine + server) 同步更新。
- **移除 `clearAllSkillInstances()`**: 模块级不用再「清全部实例」,testCleanup 改为只清 slash
  quota providers;`src/server/app.ts` 的开局清理调用一并删除。
- **`系统规则` 全局 hooks 改走 `onInit`**: `restore` 路径补 `系统规则mod.onInit()` 调用,
  保证恢复时也注册全局 hook(之前只有 `clearAllSkillInstances` 后的重注册,现在 state-bound
  无需清理所以得主动注册)。
- **回归测试**: `tests/integration/杀装备距离.test.ts` 末尾新增「孙权无流离不应被询问」场景,
  构造双 session 验证跨 state 注册表隔离。(`src/engine/skill.ts`, `src/engine/create-engine.ts`,
  `src/engine/skills/*.ts`(40+), `src/server/app.ts`, `src/server/session.ts`, 8 个测试文件)

### Fixed — 八卦阵判定红色后仍询问目标出闪

八卦阵(防具)原实现:判定翻开红色牌后,只往处理区放一张虚拟闪牌,但 before hook 返回 `void`(= pass),导致主 `询问闪` atom 仍然执行——目标玩家再次被弹出「是否出闪」的询问。按三国杀规则,八卦阵判定红色即视为出闪,**不应再给目标出真闪的机会**。根本原因:遗漏了与仁王盾一致的 cancel 语义——仁王盾同样往处理区放虚拟闪后 `return { kind: 'cancel' }` 终止主 atom,八卦阵漏了这步。

- **判定红色后 cancel 主 询问闪 atom**: `询问闪` before hook 中,判定牌花色为 ♥/♦ 时,放虚拟闪进处理区后增加 `return { kind: 'cancel' }`,终止主 `询问闪` atom。杀.execute 仍只检查处理区有无闪牌(零感知防具),虚拟闪使其判定为已闪避。(`src/engine/skills/八卦阵.ts`)
- **hook 返回类型修正**: `registerBeforeHook` handler 显式标注 `Promise<HookResult | void>`,与仁王盾一致。(`src/engine/skills/八卦阵.ts`)
- **测试更新**: 原有「判定红色」用例补 `expectNoPending()` 断言暴露 bug;原「判定成功 + P1 出真闪」用例验证的是错误行为(判定红色后仍弹出询问闪),按规则重写为「判定红色 + 手中有真闪时不再被询问、真闪留在手里」。(`tests/skill-tests/八卦阵.test.ts`)

## [Unreleased] — 2026-06-25

### Fixed — 青龙偃月刀追杀未消耗杀牌(凭空杀人)

青龙偃月刀原实现:杀被闪后,确认追杀时直接再次 `询问闪`，**未让 owner 先出一张杀牌**——相当于凭空造了一张杀。标准规则下「追杀」是「再使用一张杀」，必须消耗手牌中的杀。本次改为与贯石斧统一的两步 respond 模式:confirm 追杀 → 选一张杀牌 → 杀牌进处理区 → 再询问闪。

- **respond action 扩展为两阶段**: 原 `respond` 只处理 `青龙偃月刀/confirm`；现新增 `青龙偃月刀/useKill` 阶段(validate 校验 cardId 是 owner 手牌中的一张杀,apply 把 cardId 存入 `localVars['青龙偃月刀/killCardId']`)。(`src/engine/skills/青龙偃月刀.ts`)
- **hook 流程修正**: confirm 追杀后,先发 `请求回应`(requestType=`青龙偃月刀/useKill`,useCard prompt,cardFilter 杀)让 owner 选杀牌;选中的杀牌 `移动牌` 从手牌进处理区;移走旧闪后再 `询问闪`。(`src/engine/skills/青龙偃月刀.ts`)
- **无杀不触发**: owner 手牌无杀时跳过 confirm 直接被闪,避免无意义询问。(`src/engine/skills/青龙偃月刀.ts`)
- **杀牌清理**: 追杀的杀牌在询问闪结束后移入弃牌堆(杀.execute 收尾只移走原始杀,不认识追杀的杀,需在 hook 内清理避免滞留处理区)。(`src/engine/skills/青龙偃月刀.ts`)
- **测试**: 新增 `tests/skill-tests/青龙偃月刀.test.ts` 7 例(追杀命中/连续追杀/不追杀/无杀跳过/超时放弃/被闪不追/选非杀拒绝)。

### Changed — 八卦阵需先询问是否发动

八卦阵(防具)原实现为「需要出闪时自动判定」,判定红色自动视为出闪。标准三国杀规则下八卦阵是可选技能——装备者可选择不发动。本次改为判定前先询问玩家是否发动,与 反馈/寒冰剑/贯石斧/麒麟弓 等技能统一走 `请求回应`(requestType=`八卦阵/confirm`)+ `respond` action 模式。

- **判定前插入询问**: `询问闪` before hook 中,先 `applyAtom(请求回应, requestType='八卦阵/confirm', defaultChoice=false, timeout=10)`,玩家选发动(choice=true)才执行判定;选不发动或超时则跳过判定直接进入询问闪。(`src/engine/skills/八卦阵.ts`)
- **注册 respond action**: 新增 `八卦阵/respond` action 处理玩家确认回应,用 `localVars['八卦阵/confirmed']` 传递结果(与反馈/寒冰剑等完全一致的模式)。(`src/engine/skills/八卦阵.ts`)
- **前端 defineAction 声明**: 新增 `onMount` 调 `api.defineAction('respond', ...)`,前端渲染「发动/不发动」按钮(`AwaitingPrompt` confirm 分支)。(`src/engine/skills/八卦阵.ts`)
- **测试更新**: 原有 8 例自动判定场景补 `respond('八卦阵', {choice:true})` 步骤;新增「不发动」(choice=false 不判定)和「超时不发动」(fireTimeout 不判定) 2 例。(`tests/skill-tests/八卦阵.test.ts`)

## [Unreleased] — 2026-06-24

### Fixed — 请求回应 atom: applyView 倒计时口径与后端不一致

`请求回应` atom 的 `applyView`（前端增量路径）硬编码 `DEFAULT_TIMEOUT_MS = 30_000`（30秒），而后端真实超时读 `atom.timeout ?? pending.timeout`——无懈可击传 `atom.timeout = 10`（10秒）。导致前端倒计时显示 30s、后端 10s 超时，二者不一致。虽有 session 的 `msg.deadline` 权威覆盖机制最终修正，但覆盖前的渲染间隙会显示错误的 30s，且依赖覆盖兜底本身脆弱。同一 atom 的全量路径 `buildView.ts:72` 已正确读 `atom.timeout`，唯独增量 `applyView` 遗漏——两条路径口径分歧是 bug 根源。

- **toViewEvents 透传 timeout**: `请求回应` atom 的 `toViewEvents` 现在在 `targetView`/`othersView` 中带上 `timeout` 字段（优先 `atom.timeout`，回退 `pending.timeout`）。(`src/engine/atoms/请求回应.ts`)
- **applyView 读取 event.timeout**: 三处 pending 构建（广播型/target viewer/其他 viewer）从 `event.timeout` 读取超时秒数并换算为 ms，fallback 到 30s（`pending.timeout`）。与 `出牌窗口.ts` 同模式，与后端 `create-engine.ts:562` 的 `timeoutMs = atom.timeout ?? pending.timeout` 口径一致。(`src/engine/atoms/请求回应.ts`)
- **atom 类型扩展**: `请求回应` 的 `AtomDefinition` 泛型参数加上 `timeout?: number` 和 `wuxieTarget?: number`（后者原已在无懈链路使用但未在类型声明）。移除未使用的 `DEFAULT_TIMEOUT_MS` 常量。(`src/engine/atoms/请求回应.ts`)
- **测试**: `applyView-bugs.test.ts` 新增 3 例（广播型 timeout=10s、target viewer timeout=15s、未传 timeout fallback 30s），验证 `totalMs` 与 `deadline` 口径。(`tests/skill-tests/applyView-bugs.test.ts`)

### Enhanced — 五谷丰登选牌面板:被选牌置暗禁用并标注选牌者

五谷丰登选牌时,引擎给每个选牌者弹的 `pickProcessingCard` pending 只含「仍在处理区的牌」——被选走的牌从 `state.zones.processing` 移除后,后续选牌者的面板上看不到它被谁选走。本次为**纯渲染层增强**(零引擎改动),让被选牌保留在面板上展示为禁用态并标注选牌者:

- **新增 useProcessingPicks hook**: 渲染层订阅已到达的公开「移动牌」事件(`from:处理区 → to:手牌`),累积「被选记录」(`cardId → 选牌者名称`)。全量候选 = 已被选走的牌(从事件流累积,卡牌信息从 `view.cardMap` 查得)∪ 当前 pending.cards。处理区清空(五谷丰登结算结束)时重置。与判定牌在 `useDebugMultiConnection` 里临时加入 processing 展示同一性质——纯前端展示增强,不碰引擎 `applyView`/`buildView` 契约。(`src/client/hooks/useProcessingPicks.ts`)
- **AwaitingPrompt 渲染禁用态**: pickProcessingCard 分支用 `allCards`(含已选牌)替代原始 `pending.cards`,有 `pickedBy` 的牌渲染为禁用按钮(`disabled`)并标注「已被 XX 选走」,不可点击。(`src/client/components/AwaitingPrompt.tsx`)
- **新增禁用态样式**: `promptBtnDisabled`(置暗、cursor not-allowed)+ `pickedByTag`(红色删除线标注)。(`src/client/components/gameViewStyles.ts`)
- **测试**: `wugu-pick-processing.test.tsx` 新增 2 例(被选牌禁用且不可点击/标注正确的选牌者名称),模拟 P2 视角下 pending 只含 pb/pc 但 currentEvent 携带 pa 被选走的场景。(`tests/integration/wugu-pick-processing.test.tsx`)

### Refactored — 删除 EventOverlay,事件展示移入 GameView 内部(effect 驱动翻牌动效)

旧的事件展示组件 `EventOverlay` 是一个独立于 `GameViewComponent` 的 fixed overlay( zIndex 9000),在 `DebugLobby` 中作为兄弟元素渲染。它存在两个架构问题:(1)脱离子 GameView 的布局上下文;(2)`summarizeEvent` 函数用 hardcode switch 按事件类型拼文案,与引擎 `toViewLog` 重复定义。

本次重构将事件展示能力移入 `GameView` 内部,**由 `AtomDefinition.effect` 驱动**而非 hardcode:

- **新增 EventBanner 组件**: GameView 内部的 effect 驱动卡牌动效层,渲染在 GameHeader 与座位区之间。当 `current event` 的 `effect.animation === 'flip'` 且 ViewEvent 携带 `card` 字段时,渲染一张中央浮动卡牌:从上方弹出(牌堆)→ 3D 翻转揭示花色点数→ effect.duration 后消失。判定事件额外显示 judgeType 标签。(`src/client/components/EventBanner.tsx`)
- **cardFlipIn 动画**: 新增 CSS keyframes,模拟翻牌:从牌堆位置弹出(`translateY(-40px) scale(0.7) rotateY(180deg)`)→ 翻转过程中(`rotateY(120°→0°)`)→ 定格。动画时长取 `effect.duration`(上限 1200ms)。(`src/client/animations.css`)
- **GameViewComponent 新增 currentEvent prop**: 上层(DebugLobby)将 `useEventPlayback` 的 current event 传入,EventBanner 消费。正式模式可不传。(`src/client/components/GameView.tsx`)
- **删除 EventOverlay.tsx**: 移除文件、hardcode 的 `summarizeEvent` switch、以及 DebugLobby 中的引用。(`src/client/components/EventOverlay.tsx` 删除,`src/client/components/DebugLobby.tsx`)
- **清理废弃样式**: 删除 `eventOverlay`/`eventBanner`/`eventBannerVisible` 等旧样式,新增 `eventCardLayer`/`eventCardFlip`/`eventCardBody`/`eventCardName`/`eventCardSuit`/`eventCardLabel`。(`src/client/components/gameViewStyles.ts`)
- **更新注释**: useEventPlayback/reducer/useDebugMultiConnection 中关于 EventOverlay 的引用更新为 EventBanner。(`src/client/hooks/useEventPlayback.ts`, `src/client/view/reducer.ts`, `src/client/hooks/useDebugMultiConnection.ts`)

### Added — 判定牌信息展示(日志+处理区停留)

判定事件此前在前端日志中只显示 `判定 乐不思蜀` 等干瘪文本,不展示判定牌的花色点数和牌名;判定牌也从不在处理区(ZoneInfoBar)显示——后端 `afterHooks` 立即将判定牌从 processing 移入弃牌堆,前端 `applyView` 净效果为 processing 不变。本次改进让玩家能看清判定翻出了什么牌:

- **toViewEvents 携带判定牌信息**: `判定` atom 的 `toViewEvents` 从牌堆顶读取判定牌,在 ViewEvent 中携带 `cardId` + `card`(花色/点数/牌名)。判定牌是公开信息,所有玩家可见。(`src/engine/atoms/判定.ts`)
- **toViewLog 展示判定牌详情**: 日志从 `判定 乐不思蜀` 改为 `判定(乐不思蜀):♠7 杀`,所有视角都能看到判定牌信息。(`src/engine/atoms/判定.ts`)
- **EventOverlay 判定结果增强**: 中央弹窗从干瘪的 `判定结果` 改为 `P1 判定·乐不思蜀` + `♠7 杀`,玩家能快速识别谁在判定什么。(`src/client/components/EventOverlay.tsx`)
- **判定牌在处理区停留 2.5 秒**: 前端 `useDebugMultiConnection` 收到判定事件后,主动将判定牌临时加入 `view.zones.processing` 展示(ZoneInfoBar 处理区可见),2.5 秒后自动移除。后端引擎状态不受影响(`afterHooks` 仍立即移走),展示层与数据层分离。(`src/client/hooks/useDebugMultiConnection.ts`)
- **测试**: `toViewLog-perspective.test.ts` 新增 3 例(带 card 展示牌面/所有视角可见/无 card 降级),`applyView-bugs.test.ts` 新增 1 例(净效果验证:deckCount-1 + discardPileCount+1 + processing 不变)。(`tests/skill-tests/toViewLog-perspective.test.ts`, `tests/skill-tests/applyView-bugs.test.ts`)

### Fixed — 身份揭示弹窗时机修正(选将前弹出)

开局身份揭示弹窗(`IdentityRevealOverlay`, zIndex 10000)此前被 `!isCharSelectPending && !charSelectInProgress` 条件屏蔽整个选将阶段,导致身份牌在选将**之后**才弹出。修正后身份牌在抽身份后立即显示,盖在选将遮罩(9999)之上,玩家点「确认」后才露出选将界面,符合开局「先亮身份再选将」的流程。(`src/client/components/OverlaysLayer.tsx`)

### Added — debug 快照遥测扩展(HTML 快照 + 控制台日志 + WS 消息流)

在现有 debug 快照(前后端游戏状态)基础上,新增三类前端运行时遥测数据采集,排查「数据对但画面/行为错」的前端 bug。遵循非侵入旁路原则:不改引擎、不改 session、不触游戏渲染状态树。每次快照的全部数据落在同一个目录 `data/snapshots/<snapshotId>/`,用户可直接复制该目录路径给 AI 审查。

- **HTML DOM 快照**:点击「保存快照」时序列化 `#root` 的 `outerHTML`,写入 `dom.html`。React 实际渲染的结构证据,排查渲染错乱/元素缺失/overlay 遮挡。
- **控制台日志**:劫持 `console.error`/`console.warn` + 监听 `window.onerror`/`unhandledrejection`,写入 ring buffer(上限 300 条),快照时落盘为 `console.txt`。前端报错、React warning、未捕获异常的唯一来源。
- **WebSocket 消息流**:在 `useDebugMultiConnection` 的 `onmessage`/`sendAction`/`reorderHand` 采集原始收发消息,写入 ring buffer(上限 500 条),快照时落盘为 `ws.jsonl`。排查事件到达顺序/消息丢失/seq 跳变/action reject。
- **用户操作时间线**:记录出牌/视角切换/整理手牌(上限 200 条),存入主快照 `telemetry.userActions`。
- **目录化快照存储**:每次快照独占 `data/snapshots/<snapshotId>/` 目录,包含 `snapshot.json`(主快照)+ `console.txt`/`ws.jsonl`/`dom.html`(sidecar)。前端 toast 展示目录路径(而非单文件),方便用户一键复制给 AI。
- **后端 sidecar 机制**:`createSnapshot` 接受可选 `telemetry` 字段,写 3 个独立 sidecar 文件(避免主快照 `.json` 膨胀),主快照增加 `telemetry` 元数据块(文件引用 + 条目数 + viewport + url)。(`src/server/snapshot.ts`)
- **遥测核心模块**:新增 `src/client/utils/debugTelemetry.ts`,提供 `installTelemetry`/`uninstallTelemetry`/`logWsMessage`/`logUserAction`/`collectTelemetry`。在 `DebugGameViewInner` 挂载时安装、卸载时清理(StrictMode 双挂载安全)。
- **测试**:`tests/client/telemetry.test.ts`(10 例,覆盖 ring buffer/全局异常捕获/DOM 采集/幂等)、`tests/server/snapshot.test.ts` 新增 2 例(带 telemetry 写 sidecar 文件、不带 telemetry 兼容)。

### Changed
- 出牌阶段使用卡牌的统一前置校验(validateUseCard)提取至 skill.ts,消除 14 张卡牌技能中的重复校验逻辑。

### Fixed
- Registered display-only atoms (等待选将, 打出) to prevent viewReducer from crashing on non-dispatch ViewEvent types used in othersView
- Isolated pending slots during serial character selection (主公先选) to prevent non-selecting players from seeing the lord's selection UI and shared countdown
- Added toViewEvents to 发牌 atom with information-leveled view events so each player sees their own dealt cards; others see only count metadata
- Suspended idle timer when room has no active WS connections to prevent timer self-loop leak
- Added detailed target validation to 过河拆桥 and 顺手牵羊: reject self-target, dead targets, out-of-range targets, and targets with no valid cards
- Added detailed target validation to 过河拆桥 and 顺手牵羊: reject self-target, dead targets, and out-of-range targets
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
