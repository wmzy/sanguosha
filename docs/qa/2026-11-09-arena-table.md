# 2026-11-09 演武场牌桌验收

本次仅重做观战前端及资源安装，不改 AI 决策、观众投影或于吉技能规则。保留既有未提交工作。

## 交付

- 管理面板网格改为正常游戏式围桌座位，暗金框、水墨背景、武将立绘、体力珠、技能、装备、判定区与公开手牌。
- 中央显示当前回合、阶段、处理区牌面、牌背与公共区数量；当前座位高亮、阵亡座位灰化并亮身份。
- 全手牌展开弹窗；归档、公共发言、战报侧栏；纯净观战、全屏。
- 使用既有 GameViewScaler/CardFace/CardBack/ResourceManager；前端不引入引擎执行模块，避免初始化循环依赖。
- 静态审查后保留觉醒等动态获得的公开技能，兼容归档阵营标签及临时数字座次胜者，平局单独显示。
- 可重复执行的 npm run arena:assets：固定上游 e8768851bd8054db9fd1b63cd6f1feca813590d7，31武将+43牌图+1背景。首次77个上游文件成功，二次77个跳过，manifest无重复。第三方图片被gitignore，仅本机安装。

## 本次验证

- npm run typecheck：通过。
- 改动 TypeScript/TSX 文件 ESLint：0错误；mjs脚本按仓库现有配置被忽略，不计入lint通过范围。
- npm run build：通过，并生成dist/packs/index.json（1个包）。仅有既有lottie eval和构建插件耗时提示。
- 资源映射、观众隐私及独立上下文：3文件 / 26测试通过（tests/unit/imageAssets.test.ts、tests/arena/visibility.test.ts、tests/arena/context.test.ts）。
- npm run arena:verify-ui -- mw7uksxx-71f596：6组浏览器检查通过；无页面运行错误或ErrorBoundary错误。
- 五席实际归档经真实HTTP API读取，核对逐席手牌数量、主公/存活非主公/死者身份显示及侧栏和纯净模式。
- 五席中局画面来自同一真实存档audience.jsonl第53帧；浏览器拦截API呈现历史帧，没有修改存档。
- 八席是基于公开中局帧构建的布局fixture，覆盖1600×900、1366×768、900×600、390×844。核对全部座位在战场内、互不重叠、18张手牌完整展开、死亡亮身份。不是新跑的八AI实战。
- 立绘和手牌图片decode成功；窄屏整体缩小，文字较小，建议横屏或打开详情。

截图与机读报告：data/arena/design/arena-five-live.png、arena-five-final.png、arena-eight-1600.png、arena-eight-1366.png、arena-eight-900.png、arena-eight-390.png、browser-results.json。

本轮未重新调用真实模型，也未重跑全仓库4000余测试；后端未改，既有实战证明见2026-11-08-ai-arena-acceptance.md。没有提交、推送或公开分发第三方素材。
