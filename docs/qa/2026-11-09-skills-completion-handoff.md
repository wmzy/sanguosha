# 技能补全 DSH 收尾交接

用户最新指令：周额度不足，更换策略。停止新增Codex子代理与大范围分析，使用DSH的Antigravity Gemini4Argon（或曲奇Opus5.5）继续收尾。工作区 E:/sanguosha_AI，当前分支codex/ai-arena，已有大量用户/前序未提交arena改动，勿覆盖、勿提交或清理。

## 已确认范围

用户明确选择：先完成现有165将的全部已知缺口；不扩展研究库中524份新武将/神晋/国战模式。只考虑正常AI对局，不做复杂并发、小概率交互和过度防御。

## 已完成代码

- 清侧、怀柔、思蜀、缠怨4模块和registry衍生注册。
- 征荣真实牌暂存；鸿举自主选择旧荣、手牌并实际等量交换；新增移动暂存牌atom。
- 清侧只选场上装备/判定区，能选具体荣；怀柔支持手牌/装备区装备重铸及正确AI候选；思蜀仅出牌阶段开始询问并反转指定角色本局乐不思蜀。
- 蛊惑/界蛊惑复用CardEffect/runUseFlow支持基本牌/普通锦囊声明、杀与无懈响应、匿名公开事件，choice:false不质疑；新增缠怨主动/hook/咆哮/马术失效闸门，正常基本牌/装备/系统不受影响。
- 黄天/界黄天availableToOthers共享动作；反间四种花色；分配0..N选择与动态装备过滤。
- 巧变/界巧变正确移到装备或判定区并迁移装备技能；翻面共享toggle；落英部分选牌；界酒诗落英所得具体牌无距离/不可响应，AI按具体实体ID投影；化身逐张选择要换掉的未亮牌（官方限制保留亮牌有来源）。
- 界陷阵按winTarget判断杀次数和额外普通锦囊目标，lostTarget使用前拒绝不耗牌，修正其他角色错误共享陷阵距离；支持无中生有额外目标。
- 真实对局暴露火攻/顺手选中无牌角色反复被拒，已加正确目标过滤回归。

## 已实际运行的证据

- 最后整批 `pnpm test:all --reporter=json --outputFile=docs/qa/2026-11-09-skills-completion-tests.json`：465文件、4176测试全部通过、0失败、0跳过（本机服务启动，原7条集成测试也实跑）。结果文件已压缩成摘要。
- `pnpm typecheck`通过。
- `pnpm build`通过，858模块，9.77s；有既存wyw/eval与插件时长提示，无构建错误。
- 本批scoped eslint最初5错误已修，最后针对修复文件/公共枚举与目标模块复跑通过；其余原有warning无需扩修。`git diff --check`通过。
- `pnpm exec tsx scripts/audit-skill-runtime.ts docs/qa/2026-11-09-skills-completion-runtime.json`：165将、282静态去重武将技、317模块全部成功加载初始化、348客户端声明、无缺失衍生模块。黄天在所属座次无backend但盟友有backend是设计，与共享发现测试通过相符。
- 三人真实heuristic AI对局第二场 `data/arena/mw90vjep-797789`：completed，99决策、2次rejected，无持续同动作拒绝；角色孙权/黄盖/黄月英。第一场`mw90ptc1-a693df`也完成但196决策/131拒绝，用于定位火攻/顺手无牌目标问题，不能说第一场零拒绝。
- 配置 `configs/arena.skills-completion.json`；本机验收dev server由本轮在127.0.0.1:3930启动，Codex PTY session 71508，不要杀未知进程。

## 收尾任务（继续自主完成）

1. 只需低成本检查上面的结果文件与当前git diff确认没有遗漏，不要无理由重复完整测试/模型调用。
2. 创建 `docs/qa/2026-11-09-skills-completion.md` 验收说明：列本轮实际范围、实现、测试、真实AI结果及限制；更新 `docs/superpowers/plans/2026-11-09-skills-completion.md` 状态；在旧审查报告开头加链接说明其为修复前历史快照，在docs/README.md加验收入口。
3. 保留规则口径说明：蛊惑沿用仓库现有两版测试兼容口径，未重写为最新官方OL于吉版本（官方 https://www.sanguosha.com/hero/211 与 https://www.sanguosha.com/news/20191212_3649_0318 有差异）。不声称完整复刻旧风红桃裁定。界陷阵借刀杀人的额外复合槽位组合未扩展，按用户排除复杂/小概率交互口径记录；基础借刀现有测试通过。
4. 独立review已覆盖普通路径，唯一未确认规则疑点是界陷阵能否给无中生有加目标；按本仓库OL hero/604原文“普通锦囊能多指定其”实现，勿仅因self目标定义就删除合法技能扩展。
5. 若发现实质正常路径bug可修并跑目标测试；无新代码则不重复全部4176测试。不得提交、推送、部署、批量清理。
6. 输出简短结果，返回文件路径和必要局限。主Codex只做调度读取结果，尽量减少周额度消耗。

规则来源：思蜀 https://www.sanguosha.com/news/20200325_5115_3921 ；清侧怀柔 https://www.sanguosha.com/news/20190527_1007_5120 ；界左慈保留亮牌 https://www.sanguosha.cn/hero-detail-294.html 。
