---
name: card-design
description: 设计并生成三国杀卡牌图像(分层合成架构)。scripts/gen-card.ts 调用商汤 SenseNova U1 Fast 模型生成插画和艺术字 PNG,其余元素(花色/技能/印章/边框)用 SVG + sharp 程序绘制合成,保证多牌间像素级一致。提示词参照 SenseNova-Skills/sn-infographic 的最佳实践。当用户要求生成/设计/制作卡牌图像(杀/桃/丈八蛇矛/古锭刀 等)时使用。
argument-hint: [牌名] [--suit ♠] [--rank 7] [--damageType 火焰] [--verify]
allowed-tools: Bash, Read, Write, Edit, Grep
---

## 事实依据(严格遵守)

1. **牌名/花色/点数须与权威数据源一致**。标准包(108)+军争篇(52)的精确花色点数见 `src/shared/deck.ts`(BWIKI 权威数据)。不得臆造花色点数。
2. **API 调用细节以 `scripts/gen-card.ts` 实测为准**。文档站点 platform.sensenova.cn/docs 是 JS 渲染的,直连读不到;若 API 变更,以实测响应为准。
3. **生成图保存到 `public/cards-ai/`**(gitignored,规避版权风险)。不得写入 `public/cards/`(该目录存自制默认图,入 git)。

## 分层合成架构

**核心理念**(用户多次反馈得出的关键决策):LLM 在多张卡牌间无法产生一致的布局/字体/边框。因此采用分层架构——

LLM 只生成 3 类 PNG(都有缓存):
- **插画**(`.art.png`):每牌×属性一张
- **标题艺术字**(`_titles/<牌名>[_属性].png`):每牌×属性一张
- **点数艺术字**(`_ranks/<点数>_<red|black>.png`):13 点数 × 2 颜色 = 最多 26 张,全卡共用

程序绘制(SVG + sharp):
- **边框**(`border.png`):从 SVG 渲染一次,所有牌共用(回纹 + 云纹章 + 双线框)
- **花色符号/技能说明/印章/坐骑±1/武器攻击范围**:每牌实时 SVG 绘制

合成顺序(从下到上):边框底图 → 插画(带边缘渐变融入) → 点数 → 标题 → 其他文字层

### 布局种类(3 种)

根据卡牌类型自动选择:
- **basic**(基本牌 杀/闪/桃/酒):标题 + 花色点数 + 大插画(占 80% 画面)
- **mount**(坐骑):标题 + 花色点数 + 插画 + 大字 ±1 + 印章
- **standard**(锦囊/武器/防具):标题 + 花色点数 + 插画 + 技能描述 + 攻击范围(武器) + 印章

## 命令用法

```bash
tsx scripts/gen-card.ts <牌名> [选项]
tsx scripts/gen-card.ts --gen-border   # 仅重新渲染边框模板(不调 LLM)
```

**必填**:牌名(如 `杀`、`丈八蛇矛`)。卡牌的类型/子类/攻击范围/技能描述从源代码实时读取。

**选项**:
- `--suit <花色>`:`♠`/`♥`/`♣`/`♦`(默认取该牌名在牌堆中第一次出现的花色)
- `--rank <点数>`:`A`/`2`..`10`/`J`/`Q`/`K`(默认同上)
- `--damageType <属性>`:`火焰`/`雷电`(仅火杀/雷杀)
- `--size <尺寸>`:覆盖默认 `1760x2368`
- `--api-key <key>`:覆盖环境变量 `SENSENOVA_API_KEY`
- `--verify`:生成后用 flash-lite 视觉验证
- `--dry-run`:只打印 prompt,不调 API

**环境变量**:`SENSENOVA_API_KEY` 必填(或用 `--api-key`)。仅在实际调用 LLM 时检查(gen-border 和 art 复用不需要)。

**输出**(`public/cards-ai/`,gitignored):
- `border.png` 边框模板(共用)
- `_titles/<牌名>[_属性].png` 标题艺术字(缓存)
- `_ranks/<点数>_<red|black>.png` 点数艺术字(缓存)
- `<type>/<牌名>[_属性].art.png` 插画(中间产物)
- `<type>/<牌名>[_属性].png` 成品
- `<type>/<牌名>[_属性].md` 提示词档案

## 提示词设计(参照 SenseNova-Skills)

提示词规则严格遵守 `../SenseNova-Skills/skills/sn-infographic/references/prompt-writing-rules.md`:

1. **必描述背景纹理 + 字体风格**(Rule 1):否则 LLM 任意选择,破坏一致性
2. **禁止 hex 色值,用自然语言色名**(Rule 2):用"朱砂红""宣纸米黄",不写 `#f5e6c8`。LLM 靠语义理解颜色,hex 反而输出怪色
3. **要烤进图的文字加双引号**(Rule 3):`"杀"` 不写 `杀`,让 LLM 区分描述指令和要渲染的字面文字
4. **禁止否定性指令链**(ppt-creative 规则):T2I 模型对"no text/no logo"处理不稳定,直接正向描述要什么
5. **禁用空泛形容词**:不写"modern/simple/professional",写具体视觉内容
6. **列表/markdown 标记禁用**:输出自然语言 prose

### 共享风格锚点(STYLE_ANCHOR)

所有 LLM 提示词(插画/标题/边框)共享同一段风格锚点,保证整副牌视觉统一:

- **风格**:水墨工笔融合画,浓墨晕染与细腻勾线并存,参照中国古典插画与三国题材工笔人物画传统
- **背景纹理**:陈年宣纸,纸面带细微纤维起伏与淡黄色调,偶有轻微折痕与透墨感
- **配色**:以浓墨与淡墨为主调,点缀朱砂红、石青蓝、赭石黄等传统国画颜料色,色彩古朴沉稳
- **氛围**:庄重古朴,带英雄气概,有三国时代的史诗感

### 标题书法样式(核心修复)

用户曾反馈"字体太丑"。问题诊断:旧版用"隶书或魏碑体"导致生硬规整。新版采用:

- **字体**:雄浑行楷(介于楷书端庄与行书流动之间),参照三国时期碑榜与古代武将旗号笔意
- **【笔触质感-最重要】** 强制三效果同时出现:
  - **飞白**:笔画中段的纸色透出
  - **枯笔**:笔画末端的干涸扫迹
  - **墨晕**:笔画边缘的墨汁洇开
- **颜色**:深朱砂红配金色描边;火杀版环绕火焰,雷杀版环绕紫蓝雷电
- **背景**:陈年宣纸色(可见纤维纹理、轻微折痕、透墨感、纸面不规则起伏)

flash-lite 验证:新版标题评分 8-8.5/10,"比生硬隶书美观,专门设计的书法字体"。

### 点数样式

- **字体**:现代粗体衬线印刷字,参照扑克牌点数字体,笔画粗壮
- **严格要求**:必须画阿拉伯数字/字母本身(`"7"`/`"A"`),不加其他字符
- **颜色**:深朱砂红(红桃/方块) 或 浓墨黑(黑桃/梅花)

**关键坑**:曾用"隶书艺术字"提示词,LLM 把 7 画成"柒"、5 画成"伍"(财务大写汉字)。改用现代粗体印刷 + 明确禁止变体后修复。

### 插画样式

- **构图**:基本牌竖版,其他横版
- **【填满要求-最重要】**:画面从左到右、从上到下充满实质内容(山峦/云雾/树木/建筑/火焰/雷电/纹饰),任何方向不出现裸露背景纸色
- **主体**:焦点居中占约 3/4,周围填满呼应的陪衬景物
- **属性杀**:火杀整画面笼罩火焰(不只是手持火剑),雷杀整画面环绕紫蓝雷电

插画内容描述(纯视觉不含典故)见 `illustration-history.md`。

## 验证注意事项

**flash-lite 视觉模型的局限**(重要):
- 460px 以下缩略图会丢失书法飞白/墨晕等细节,误判为"印刷体"
- 验证字体质感时,必须用 `sharp().extract()` 裁切局部区域并保持 ≥1000px 宽
- flash-lite 偶发漏判实际存在的元素,应与人工视觉审查结合

**裁切验证示例**:
```bash
node -e "const s=require('sharp');s('public/cards-ai/basic/杀.png').extract({left:300,top:80,width:1160,height:200}).jpeg({quality:92}).toFile('/tmp/title.jpg').then(()=>console.log('ok'))"
```

## 执行流程

### 步骤 1:确认牌的花色点数(防臆造)

查 `src/shared/deck.ts` 的 `STANDARD_DECK`/`JUNZHENG_DECK` 数组。用户没指定时默认用标准包中该牌名第一次出现的花色点数。

火杀/雷杀:牌名仍是「杀」,通过 `--damageType` 区分(对应 deck.ts 中 damageType 字段)。

### 步骤 2:首次运行需先生成边框

```bash
tsx scripts/gen-card.ts --gen-border
```

从 SVG 渲染 `border.png`(不调 LLM,保证像素级一致)。

### 步骤 3:调用命令生成

```bash
SENSENOVA_API_KEY=<key> tsx scripts/gen-card.ts <牌名> [--suit <花色>] [--rank <点数>] [--damageType <属性>]
```

生成耗时约 30-60 秒(调 3 次 LLM:标题+点数+插画),复用缓存时仅 2-3 秒。

### 步骤 4(可选):视觉验证

加 `--verify` 自动用 flash-lite 对比官方参考图(来自 `docs/card-refs/<牌名>.png`,已 gitignore)。

或手动裁切关键区域(标题/插画/技能文本)用 flash-lite 分项验证。

### 步骤 5(可选):运行时预览

AI 生成图在 `public/cards-ai/`,不在加载链路(链路是 `cards-local/` → `cards/`)。预览需手动复制:
```bash
cp public/cards-ai/<type>/<牌名>.png public/cards-local/<type>/<牌名>.png
```

## 复用与重新生成

- **改提示词/布局后**:`rm` 成品 `.png` 重新合成(无需调 LLM,2-3 秒)
- **标题/点数 PNG 全局共享缓存**,生成新牌时自动复用同点数/同标题
- **改插画才需 `rm .art.png`**(调 LLM ~25 秒)
- **改边框纹样**:`rm border.png` 后 `--gen-border`

## 批量生成

```bash
for card in 杀 闪 桃 酒; do
  SENSENOVA_API_KEY=<key> tsx scripts/gen-card.ts "$card"
done
```

注意 API 调用频次与额度,建议先生成 1-2 张确认效果再批量。

## 官方参考图获取

`docs/card-refs/` 放官方参考图(用于 `--verify` 对比,已 gitignore)。来源:萌娘百科公共 wiki 资源存储。

访问 `https://zh.moegirl.org.cn/三国杀:<条目名>`,提取 `storage.moegirl.org.cn/moegirl/commons/<x>/<xx>/三国杀-【<牌名>】.png|jpg` 直链。

## 验收

- 生成图 + 同名 md 保存到 `public/cards-ai/<type>/`
- `file` 命令确认有效 PNG
- md 含完整 prompt + 基本信息(供检查)
- (可选)`--verify` 或裁切分项验证
- (可选)dev server curl 验证运行时加载
