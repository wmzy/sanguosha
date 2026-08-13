---
name: add-skill
description: 添加三国杀技能。读取技能描述文档,分解原子操作和钩子时机,产出契约清单,实现技能代码并独立编写触发测试。当用户要求添加/实现某个武将技能时使用。
argument-hint: [技能名]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git *), Bash(npx tsc *), Bash(npx vitest *)
metadata:
  internal: true
---

## 事实依据(严格遵守)

1. **技能描述是唯一事实来源**。先读取 `docs/research/武将技能/` 下对应武将的 `.md` 文件,找到 `$ARGUMENTS` 相关技能描述。
2. **不得臆造规则、效果、数值**。描述里没写的不要加,描述里有的必须实现。
3. **如果描述模糊或缺失,标注"待澄清"并提问,不要自行补全**。

## 三步流程(每步独立交付)

### 步骤 1:分析(输出分析报告,不写代码)

阅读技能描述后输出:
1. **基本信息**:名称、类型、触发时机、限制条件
2. **原子操作分解**:逐条列出需要 apply 的 atom(类型+参数+顺序),并标注**精确触发时机**(哪个 atom 的 before/after hook)
3. **钩子挂载时机**:需要注册的 before/after hook,挂在哪个 atomType,触发条件。**锁定技判定**:before-hook 拦截型(防具/武器)= 非锁定?标 `isLocked`。
4. **缺失 atom 检查**:对比 `src/engine/atoms/index.ts`,缺失的标注"需要先添加 atom"
5. **契约清单(关键!)**:列出本技能读/写的所有跨 atom 通信通道(localVars/turn.vars/players[].vars/marks/tags),标注**生产者和消费者**,以及对端是否已实现。对端未实现的标注"需要协调"
6. **是否涉及通用机制**(见下方清单,优先复用):出杀次数/目标数、装备生命周期、限一次、转化回应、防具拦截时机
7. **退出路径完整性**(装备/临时状态类必填):技能造成的状态变更会在哪些 atom 退出?逐条列出恢复/清理路径,确认无泄漏(见陷阱 T6)

### 步骤 2:实现(基于分析报告写代码)

**引擎规范**:文件 `src/engine/skills/${技能名}.ts`;`ownerId` 是座次下标(number);状态变更通过 `applyAtom`;跨 atom 通信通过 localVars/turn.vars/marks(tags)/players[].vars,不用 frame.params;before hook 返回 HookResult;在 skills/index.ts 注册。

**钩子类型收窄**:`registerBeforeHook/AfterHook` 已泛型化——`atomType` 参数自动收窄 `ctx.atom` 到对应形状,无需强转。复用多 atomType 的 handler 标注联合类型:`ctx: AtomBeforeContext<AtomOfName<'询问闪' | '询问杀'>>`。

**通用机制(优先复用,禁止自造)** — 已有 helper 的,直接调用:

| 场景 | API | 文件 |
|---|---|---|
| 出杀次数上限/突破/无限 | `registerSlashMaxProvider/UnlimitedProvider(state,ownerId,fn)`、阻断器 `registerSlashBlocker` | slash-quota.ts |
| 杀目标数上限(方天画戟/天义) | `registerSlashTargetProvider(state,ownerId,fn)` | slash-target.ts |
| 限一次/限每回合 | `usedThisTurn` + `markOncePerTurn` + `activeUnlessUsedThisTurn`(三件套) | once-per-turn.ts |
| 装备技能加载/卸载 | 装备通用 execute 已处理(装→添加技能,卸→移除技能),不要重复 | 装备通用.ts |
| 横切规则(防具穿透等) | 标签 `tag:技能名/效果`,所有同类技能统一检查 | — |
| **逼杀/虚拟出牌**(激将/挑衅/乱武/借刀) | `runUseFlow(state, source, cardId, targets, cardName, { virtual: true })`,**禁止手写伤害结算** | card-effect/use-card.ts |
| **替代回应/救援**(转化当闪/杀/桃/酒,或声明牌名) | `declareAlternativeResponse(state, ownerId, atomType, requestType?)` | skill.ts |

**编辑安全(防中断损坏)**:
- 先读完整文件再编辑。用 write 覆盖整个文件,或 edit 小范围
- **编辑后立即运行 `npx tsc --noEmit`** 自检,有错误立即修复
- 缺失 atom 先实现(参考 docs/guides/添加atom.md)

### 步骤 3:测试(独立编写)

1. 文件:`tests/skill-tests/${技能名}.test.ts`,用 SkillTestHarness
2. **必须包含触发测试**:实际 dispatch 技能 action,验证效果确实生效
3. 覆盖:happy path / 触发条件不满足 / 边界 / **负面拒绝路径**(目标非法、无手牌、非自己回合、限一次用尽)
4. **断言可证伪**:期望值必须与初始态不同(如验证增伤要让伤害真的能从 1 变 2);杜绝"断言值恒为初始态"的僵尸用例
5. **文件头覆盖清单与实际 it() 一一对应**:每条注释对应一个真实测试,不列不存在的用例
6. **生成后运行 `npx vitest run tests/skill-tests/${技能名}.test.ts`**,附上结果

---

## 高发陷阱清单(实战教训,实现前对照,每条都造成过 5+ 个真实 bug)

> 以下每条提炼自变更历史。症状 = bug 表象;根因 = 为什么错;正解 = 正确做法(含具体 atomType/API)。

**T1. requestType 前缀必须 = skillId**
- 症状:前端点技能按钮无响应 / pending 匹配不到
- 根因:用了标版前缀(如 `'仁德/'`)或自造前缀
- 正解:requestType 恒为 `${skillId}/${子类型}`。界版技能前缀 = `'界X/'`,不得复用标版前缀。[bf1703d8 一次性改 30+]

**T2. 逼杀/虚拟出牌走 runUseFlow(virtual),禁止手写伤害结算**
- 症状:激将/挑衅/乱武/借刀出的火杀/雷杀按普通伤害结算(damageType 丢失),或跳过 use 流程时机 hook
- 根因:手写 `杀.respondKill + runDamageFlow` 不传 damageType、绕过 runSettlementPhase
- 正解:`runUseFlow(state, source, cardId, targets, '杀', { virtual: true })` → `杀.resolveSlash` 自动读 cardMap.damageType 传导,并跑全时机(指定目标/成为目标/检测有效性/生效前...)[10+ commit]

**T3. "对你无效" = 检测有效性 cancel;"伤害±N" = 受到伤害时 modify。绝不混用**
- 症状:藤甲被普通杀仍询问闪(做成减伤 -1);或仁王盾黑杀仍走抵消流程
- 根因:把"无效"实现成 `modify amount→0`,伤害流程照走(仍询问闪/杀、触发被抵消)
- 正解:"无效"挂 **`检测有效性`** before-hook 返回 `{kind:'cancel'}`(跳过该目标整个结算,不询问/不伤害/不抵消);"加减伤"挂 **`受到伤害时`** before-hook 返回 `{kind:'modify', atom:{...ctx.atom, amount}}`。镜像仁王盾。[de431579]

**T4. 转化技前端入口:prompt.type 必须是 'useCardAndTarget' + 返回 transform 字段**
- 症状:连环/界连环点了没反应(无法进入转化模式);乱击多卡转化发不出
- 根因:prompt.type 写成 `'useCard'`(走单卡分支);或缺 transform 字段(前端无 wrapperName 组合 preceding)
- 正解:onMount 的 use action:`prompt.type='useCardAndTarget'`(多卡转化如丈八蛇矛/乱击需选多张;AOE 用 `targetFilter.max:0` 表示无需选目标);并返回 `transform: (card)=>({name, sourceCardId:card.id, fromSkill:skill.id})`。单卡转化(武圣)同样需 transform 字段。[6cad36fc, b25178f9]

**T5. 跨回合技能状态禁用模块级变量/Map,必须 state-bound**
- 症状:多房间/多 session 状态串扰;resetForTest 失效;线上泄漏
- 根因:用 `const map = new Map()` 模块级存技能跨回合状态
- 正解:`WeakMap<GameState, ...>` 外挂,或 state.localVars / turn.vars / players[].vars / marks。slash-quota、青釭剑 tempUnload 均已从模块级 Map 改 WeakMap。[660c601d]

**T6. 装备技能状态变更覆盖全部退出路径 + 触发前动态校验装备仍在**
- 症状:防具被临时卸载后未恢复(泄漏);装备被获得/弃置/换装后旧 hook 仍生效
- 根因:只挂了"造成伤害"恢复路径,漏"被抵消";或未校验装备槽仍持有该装备
- 正解:① 临时状态变更覆盖所有退出 atom(造成伤害 / 被抵消 / 获得 / 弃置 / 换装替换);② before-hook 首行动态校验 `state.players[ownerId].equipment['防具']` 仍是指定装备(防易主残留 hook)。[77f158fc 6 处装备 bug, 0d84b422]

**T7. "限一次"标记在提交确认后写,不在询问开始写**
- 症状:玩家在分配/确认面板点取消仍消耗了限一次
- 根因:markOncePerTurn 在询问发起时就写
- 正解:在 use action 的 execute 第一个 await 前调 `markOncePerTurn(state, ownerId, skillName)`;validate 用 `usedThisTurn`,activeWhen 用 `activeUnlessUsedThisTurn`。取消提交不进 execute → 不消耗。[界结姻 CHANGELOG]

**T8. 触发时机精确——濒死救援/死亡结算型技能挂在正确时机,不在"造成伤害"立即**
- 症状:遗计在濒死未救时提前发动;或时机错位
- 根因:挂在 造成伤害 after-hook 立即触发,未等求桃链结算
- 正解:救援型依赖 `'求桃/已救'` 标志或"回复体力后"时机,确认角色存活(未被救回则不发动);死亡触发型(断肠/行殇)用"死亡时"atom,处理无来源(killer=undefined)致死边界。[746aab06, c71f1e3e]

**T9. 多目标牌在 prompt 声明 slots(每槽独立 filter);纯回应牌不注册 use**
- 症状:借刀杀人选了第二目标无响应(canPlay 误判);出牌阶段闪/无懈被误判可主动打出
- 根因:prompt.targetFilter 只写单目标 max,未声明 slots;或为 timing='生效前' 的纯回应牌注册了 use action
- 正解:多目标牌(借刀杀人 A/B 槽)用 `prompt.slots` 逐槽 filter;闪/无懈等 timing='生效前' 牌只注册 respond,不注册 use(前端靠 `hasUseEntry` 判定可否主动打出)。[d5125576, 49271e37]

**T10. 桃/酒是基本牌,默认全角色可用,不在 player.skills**
- 症状:canRescueWith 恒返回 false,持桃者看不到求桃窗口
- 根因:判定救援牌时 `skills.includes('桃')`,但 DEFAULT_SKILLS 不含基础牌名(桃/酒经 CardEffect 注册表路由)
- 正解:桃/酒对所有角色默认 true;只有武将技能(急救红牌等)才查 `skills.includes`。转化救援牌用 `declareAlternativeResponse` 声明。[c0e8ce5a]

**T11. 命名:函数/变量英文,业务常量中文,装备槽 key 中文**
- 根因:中文函数名(`醇列表`)割裂全仓库约定(`shadowIdOf`);英文装备槽 key 违反领域命名
- 正解:函数/局部变量用英文(`shadowIdOf`/`getNeighbors`);业务常量保留中文(武将名/atom 类型/卡牌名);装备槽 key 用中文(`'武器'`/`'防具'`/`'进攻马'`/`'防御马'`/`'宝物'`)。[90df9e06]

**T12. "限一次"vars 必须同时投影到 view.turnUsage（经「回合用量」atom），否则 activeWhen 永远 true**
- 症状:玩家用过技能后按钮仍亮着，点击被后端 validate 拒绝（前端 activeWhen 与后端 state 脱钩）
- 根因:只在 `player.vars[KEY]` 写标记，未调 `applyAtom({type:'回合用量', player:from, key:KEY, value:true})`
- 正解:写 vars 的同时调「回合用量」atom 投影到 `view.players[i].turnUsage[KEY]`。`activeUnlessUsedThisTurn` 读 turnUsage（前端），validate 读 vars（后端），两端一致。[界弓骑/界当先]
- 例外:**持久限定技**（整局一次）不能存 turnUsage（每回合清空），用 `player.vars` + 后端 validate 拦截（对齐乱武/界乱武约定）。

**T13. defaultChoice:true 用 `!== false`；false 用 `=== true`。禁止 truthy 检查**
- 症状:超时后行为错误——defaultChoice:true 超时应默认确认，但 `if (!localVars[KEY])` 把 undefined 当 false
- 根因:引擎 `请求回应.onTimeout` 对非 `__弃牌` 型 RT 不调 respond → execute 不执行 → localVars[KEY] 保持 undefined
- 正解:defaultChoice:true → `if (localVars[KEY] !== false)`（undefined 视为默认确认）；defaultChoice:false → `if (localVars[KEY] === true)`（undefined 视为默认取消）。[界献图×2处/界强识/界甘露]

**T14. respond execute 读 `params.choice`（前端 confirm prompt 提交 choice），不是 `params.confirmed`**
- 症状:玩家点确认后技能不发动——KEY 恒为 false
- 根因:前端 AwaitingPrompt.tsx 发送 `{choice:true/false}`，引擎无 choice→confirmed 归一化
- 正解:`params.choice === true || params.confirmed === true`（后者为防御性兜底，但 choice 是主要路径）。[界血裔 CRITICAL]

**T15. 强制弃牌/给牌必须 `mandatory:true` + 超时兜底；cardIds 校验无重复**
- 症状:玩家可跳过强制弃牌义务（白嫖）；提交重复 cardId 污染弃牌堆
- 根因:请求回应 atom 缺 `mandatory:true`（前端显示"不回应"按钮）；超时无自动补弃；validate 未校验 `new Set(cardIds).size`
- 正解:① 加 `mandatory:true`；② 超时兜底 `hand.slice(0, N)` 自动补弃；③ validate 加 `if (new Set(cardIds).size !== cardIds.length) return '不能选择重复的牌'`。[界灭计/界甘露/界焚城/界缔盟/界节命/界自守]

**T16. 从弃牌堆取牌前必须检查 `discardPile.includes(cardId)`，防止其他技能已取走导致卡牌复制**
- 症状:同一张牌同时出现在两个玩家手牌中（状态损坏）
- 根因:移动牌 atom 的 apply 对 from='弃牌堆' 只做 filter（不在则 no-op）却仍 hand.push
- 正解:取牌前 `if (state.zones.discardPile.includes(cardId))` 守卫；或重排顺序使取牌原子化（先取牌再做后续 await）。[界悲歌/界惴恐/界暴虐]

**T17. onInit cleanup 必须包含所有 hook/provider 的 unloader，不能返回空函数**
- 症状:技能卸载后 hook 仍触发 → 残留/重复注册 → 每次伤害触发两次
- 根因:`registerAfterHook` 返回的 unloader 被丢弃，onInit 返回 `() => {}`
- 正解:收集所有 unloader 到数组，onInit 返回 `() => unloaders.forEach(fn => fn())`。例外:仅注册 respond action 的技能可返回空函数（`unregisterActionsForInstance` 按 skillId 前缀自动清理 action+hook）。[界节命/界耀武]

**T18. 阶段结束交互式触发器用 before-hook（非 after-hook）**
- 症状:触发时机在 phase 已推进后才执行，与弃牌阶段 pending 错位
- 根因:回合管理是系统技能（注册序在角色技能前），其 阶段结束 after-hook 先执行并推进 phase
- 正解:交互式阶段结束触发器挂 `registerBeforeHook(state, skill.id, ownerId, '阶段结束', ...)`。非交互的 after-hook（仅调归还牌等）可保持 after。[界燕语→after改before]

**T19. 手牌变动触发型技能必须覆盖所有手牌减少路径**
- 症状:某些路径的手牌减少不触发技能（如给予/移出至暂存区/拼点扣置）
- 根因:只挂了 `移动牌`（手牌→处理区），遗漏 `给予`（手牌→他人手牌）、`移出至暂存区`（手牌→vars）、`拼点扣置`（手牌→处理区面朝下）、`获得`（被他人获得）
- 正解:逐路径检查并挂对应 after-hook。参考连营/界连营 的完整覆盖模式。[界伤逝 +3 hooks]

**T20. 偷牌必须随机盲取（Math.random），不能固定取第一张；手牌盲选须调 spliceHandOrderEntry**
- 症状:固定取 hand[0] 破坏隐藏信息不变量；重放时手牌顺序不一致导致结果不同
- 根因:代码用 `target.hand[0]` 而非随机索引；自实现选牌面板漏调 `spliceHandOrderEntry`
- 正解:① `const idx = Math.floor(Math.random() * target.hand.length)`；② 自实现 pickTargetCard 面板前调 `spliceHandOrderEntry(state, target)`（与 runPickTargetCardPanel 一致）。[界巧变/界补益/界趫猛]

---

## 详细模板和通用机制

四类技能模板、通用机制设计(出杀次数/装备加载卸载/横切规则/身份势力/declareAlternativeResponse)、完整 Checklist、SkillTestHarness API 详见:
`docs/guides/添加技能.md`
