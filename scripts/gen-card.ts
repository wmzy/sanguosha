#!/usr/bin/env tsx
// scripts/gen-card.ts
// 三国杀卡牌图像生成命令(分层合成版)。
//
// 设计:LLM 只生成两张图——① 空边框模板(一次性,所有牌共用)② 纯插画(每牌一张);
//      其余所有元素(花色点数/标题/攻击范围/印章/技能描述)用程序 SVG 绘制,
//      用 sharp 合成到边框模板上。保证多张卡牌间布局/字体/边框像素级一致。
//
// 卡牌信息实时从源代码声明文件读取:
//   - src/shared/deck.ts(牌堆花色点数)
//   - src/shared/cards/{basic,equipment,tricks}.ts(CardDef 类型/range)
//   - src/shared/cards/description.ts(技能描述原文)
//
// 插画外形描述(纯视觉,不含典故):见 .claude/skills/card-design/illustration-history.md
//
// API: POST https://token.sensenova.cn/v1/images/generations (sensenova-u1-fast)
//      POST https://token.sensenova.cn/v1/chat/completions (sensenova-6.7-flash-lite 验证)
//
// 用法:
//   tsx scripts/gen-card.ts <牌名> [选项]
//   选项:
//     --suit <花色>     ♠/♥/♣/♦ (默认取该牌名在牌堆中第一次出现的花色)
//     --rank <点数>     A/2..10/J/Q/K (默认同上)
//     --damageType <属性> 火焰/雷电 (仅火杀/雷杀)
//     --size <尺寸>    覆盖默认 1760x2368
//     --api-key <key>  覆盖环境变量 SENSENOVA_API_KEY
//     --verify         生成后用 flash-lite 视觉验证
//     --dry-run        只打印 prompt,不调用 API
//     --out-name <名>  覆盖成品文件名(默认 <名>[_属性].png);插画缓存仍按 牌名+属性
//
//   批量模式:
//   tsx scripts/gen-card.ts --all [--limit N] [--skip-existing]
//     遍历整个牌堆(160 张,去重后 143 张独立牌面),逐张调用自身生成。
//     输出命名:<type>/<名>-<点数>-<花色>.png
//     串行执行避免 API rate limit;某张失败不中断其他。
//
//   模板生成(不调 LLM):
//   tsx scripts/gen-card.ts --gen-border  渲染边框模板
//   tsx scripts/gen-card.ts --gen-back    渲染牌背(所有牌共用一张)
//
// 输出(public/cards-ai/,gitignored):
//   border.png              边框模板(共用)
//   <type>/<牌名>.art.png   LLM 生成的纯插画(中间产物)
//   <type>/<牌名>.png       成品(边框+插画+所有文字层合成)
//   <type>/<牌名>.md        提示词档案

import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { createStandardDeck } from '../src/shared/deck';
import { 基本牌列表, 锦囊牌列表 } from '../src/shared/cards';
import { 装备牌列表 } from '../src/shared/cards/equipment';
import { getCardDescription } from '../src/shared/cards/description';
import type { Card, CardDef, Suit, CardType, CardSubType } from '../src/shared/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const API_URL = 'https://token.sensenova.cn/v1/images/generations';
const VISION_URL = 'https://token.sensenova.cn/v1/chat/completions';
const DEFAULT_SIZE = '1760x2368';
const SUPPORTED_SIZES = new Set([
  '1664x2496', '2496x1664', '1760x2368', '2368x1760',
  '1824x2272', '2272x1824', '2048x2048', '2752x1536',
  '1536x2752', '3072x1376', '1344x3136', '2560x720', '3072x864',
]);

// 卡面布局坐标(百分比,相对卡面宽高)
// 边框宽度固定 80px(与 buildBorderSvg 的 bw 一致)。
// 按卡牌类型分三种布局。所有布局的 title/rank 均由 LLM 生成艺术字 PNG 叠加;
// 花色符号、技能说明、印章仍由 SVG 程序绘制。
//   - basic(基本牌:杀/闪/桃/酒):点数+花色+标题艺术字+大插画
//   - mount(坐骑:进攻马/防御马):标题+花色+点数+插画+大字+1/-1+印章
//   - standard(锦囊/武器/防具):标题+花色+点数+插画+技能描述+攻击范围(武器)+印章
type LayoutKind = 'basic' | 'mount' | 'standard';

// 标题艺术字 PNG 占位区:yStartPct=0.045(106px) 已在 80px 边框外
const LAYOUT_BASIC = {
  title: { yStartPct: 0.045, yEndPct: 0.10, xCenter: 0.50, wPct: 0.30 },
  rank: { yStartPct: 0.045, yEndPct: 0.10, xStartPct: 0.05, xEndPct: 0.105 },
  suit: { xPct: 0.075, yPct: 0.135 }, // 花色在点数下方
  art: { yStartPct: 0.105, yEndPct: 0.96 }, // 插画占大部分卡面
};

const LAYOUT_MOUNT = {
  title: { yStartPct: 0.045, yEndPct: 0.10, xCenter: 0.50, wPct: 0.30 },
  rank: { yStartPct: 0.045, yEndPct: 0.10, xStartPct: 0.05, xEndPct: 0.105 },
  suit: { xPct: 0.075, yPct: 0.135 },
  art: { yStartPct: 0.15, yEndPct: 0.62 },
  mountText: { yPct: 0.78 }, // 大字 +1/-1
  seal: { yPct: 0.95, xPct: 0.50 },
};

const LAYOUT_STANDARD = {
  title: { yStartPct: 0.045, yEndPct: 0.10, xCenter: 0.50, wPct: 0.30 },
  rank: { yStartPct: 0.045, yEndPct: 0.10, xStartPct: 0.05, xEndPct: 0.105 },
  suit: { xPct: 0.075, yPct: 0.135 },
  art: { yStartPct: 0.15, yEndPct: 0.62 }, // 插画小一些,留技能说明空间
  skillText: { yStartPct: 0.74, yEndPct: 0.90, xPct: 0.50, wPct: 0.82 },
  range: { xPct: 0.08, yPct: 0.93 }, // 攻击范围数字位置(移到底部避免与技能重叠)
  seal: { yPct: 0.96, xPct: 0.50 },
};

// 保留旧 LAYOUT 供 meta 打印引用(走 standard 布局)
const LAYOUT = LAYOUT_STANDARD;

function cardLayoutKind(def: CardDef): LayoutKind {
  if (def.type === '基本牌') return 'basic';
  if (def.subtype === '进攻马' || def.subtype === '防御马') return 'mount';
  return 'standard';
}

// ─── 参数解析 ───────────────────────────────────────────────
const BOOL_FLAGS = new Set(['verify', 'dry-run', 'gen-border', 'gen-back', 'all']);
const args = { _: [] as string[] } as Record<string, any>;
for (let i = 0; i < process.argv.slice(2).length; i++) {
  const a = process.argv.slice(2)[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (BOOL_FLAGS.has(key)) { args[key] = true; }
    else { args[key] = process.argv.slice(2)[i + 1]; i++; }
  } else { args._.push(a); }
}

const apiKey = args['api-key'] || process.env.SENSENOVA_API_KEY;
const size = args.size || DEFAULT_SIZE;
const dryRun = args['dry-run'] === true;

// API key 仅在实际调用 LLM 时检查(gen-border 和 art 复用不需要)
if (!SUPPORTED_SIZES.has(size)) { console.error(`错误:size 不支持。支持值:${[...SUPPORTED_SIZES].join(', ')}`); process.exit(1); }

const [W, H] = size.split('x').map(Number);
const AI_DIR = join(ROOT, 'public', 'cards-ai');
const BORDER_FILE = join(AI_DIR, 'border.png');

// 按布局选插画生成尺寸(API 支持列表中选最接近插画区比例的):
//   basic 插画区高88%(约1620×2077,比例1:1.28)→ 1664x2496(1:1.5)
//   mount/standard 插画区高50%(约1620×1178,比例1:0.73)→ 2496x1664(1:0.67) 或 2272x1824(1:0.80)
const ART_SIZE_FOR_KIND: Record<LayoutKind, string> = {
  basic: '1664x2496',      // 竖版
  mount: '2272x1824',      // 横版(坐骑插画区较宽矮)
  standard: '2496x1664',   // 横版(锦囊/装备插画区较宽矮)
};

// ─── 从源代码读取卡牌信息 ──────────────────────────────────
const DEF_INDEX = new Map<string, CardDef>();
for (const def of [...基本牌列表, ...锦囊牌列表, ...装备牌列表]) DEF_INDEX.set(def.name, def);
const FULL_DECK = createStandardDeck();
function firstOccurrence(n: string): Card | undefined { return FULL_DECK.find((c) => c.name === n); }

// ─── 辅助函数 ──────────────────────────────────────────────
function suitName(s: Suit): string { return { '♠': '黑桃', '♥': '红桃', '♣': '梅花', '♦': '方块' }[s] ?? '黑桃'; }
function suitColorName(s: Suit): string { return s === '♥' || s === '♦' ? '红色' : '黑色'; }
function suitUnicode(s: Suit): string { return s; }
function escapeXml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function typeLabel(n: string, t: CardType, st: CardSubType, dt: string | undefined): string {
  if (t === '基本牌') {
    if (n === '杀') return dt === '火焰' ? '基本牌·火杀' : dt === '雷电' ? '基本牌·雷杀' : '基本牌';
    return '基本牌';
  }
  if (t === '装备牌') return `装备·${st}`;
  if (t === '锦囊牌') return st === '锦囊' ? '锦囊' : st;
  return '';
}

// 插画外形描述(纯视觉,不含典故;完整表见 illustration-history.md)
const ILLUSTRATION_HISTORY: Record<string, string> = {
  '古锭刀': '一柄中国古代环首刀。刀身细长、略弯曲、轻薄,刀尖上翘,刀身可有松纹纹理;刀柄末端有圆环(环首),刀柄缠绳;古朴庄重,属单刃长刀(非双刃直剑)',
  '青龙偃月刀': '一柄长柄大刀。刀身宽厚呈月牙形,刀背厚重,刀刃寒光;长木柄;气势威武',
  '丈八蛇矛': '一杆长矛。矛头蛇形蜿蜒,矛尖锋利;长木柄,铁质',
  '雌雄双股剑': '两柄古剑并陈。一雄一雌,剑身一长一短,剑柄纹饰有别',
  '青釭剑': '一柄寒光凛凛的古剑。剑身青光,剑鞘华贵',
  '方天画戟': '一柄画戟。戟头双月牙形,戟身华丽纹饰;长柄',
  '诸葛连弩': '精巧的连弩机械结构。可容纳多支箭矢,木质弩身,铜质机件',
  '的卢': '一匹白马跃起渡溪。额有白斑,动态跃起',
  '赤兔': '一匹赤红骏马奔驰。浑身火炭般赤红,鬃毛飞扬',
};
function illustrationFor(n: string, dt: string | undefined): string {
  if (ILLUSTRATION_HISTORY[n]) return ILLUSTRATION_HISTORY[n];
  const map: Record<string, string> = {
    '杀': '一名古代武将挥剑斩击的动态姿态。武将甲胄鲜明',
    '火杀': '武将挥舞燃烧着火焰的剑,烈焰飞舞',
    '雷杀': '武将持剑,周身环绕紫色雷电',
    '闪': '武将闪避腾挪的侧身动态。身姿轻盈',
    '桃': '盛开的桃树,粉红桃花。生机盎然',
    '酒': '古朴酒壶倾倒琼浆。酒香四溢',
    '寒冰剑': '一柄剑身凝结冰晶的冷剑。剑身泛冷蓝光泽',
    '贯石斧': '一柄厚重的石质战斧。斧身粗犷',
    '麒麟弓': '一柄雕饰麒麟纹的长弓。弓身华丽',
    '八卦阵': '太极八卦图案阵法。黑白双鱼环绕,外围八卦符号',
    '仁王盾': '一面刻有仁王怒相的盾牌。盾面狰狞威严',
    '藤甲': '一副编织的藤制铠甲。藤条交织,坚韧轻便',
    '白银狮子': '一顶银色狮头护肩铠。狮面威严,银光闪烁',
    '朱雀羽扇': '一柄饰有朱雀羽毛的羽扇。扇面火红羽毛,扇柄精致',
    '紫骍': '一匹紫色骏马',
    '大宛': '一匹西域骏马。体格健壮',
    '绝影': '一匹黑色战马',
    '爪黄飞电': '一匹飞电战马。爪蹄金黄',
    '骅骝': '一匹骏马。体态神骏',
    '过河拆桥': '古战场拆毁桥梁场景。断桥残垣',
    '顺手牵羊': '市井顺手牵走羊只场景',
    '无中生有': '凭空创造之奇幻场景。光芒涌现',
    '决斗': '两人对峙决斗。剑拔弩张',
    '万箭齐发': '箭雨倾泻战场。万矢齐发',
    '南蛮入侵': '蛮族入侵军队。旌旗猎猎',
    '桃园结义': '刘关张桃园结义场景。桃花树下三人结拜',
    '五谷丰登': '丰收田野。金穗累累',
    '乐不思蜀': '刘禅宴乐场景。歌舞升平',
    '兵粮寸断': '断粮草营地。辎重萧条',
    '闪电': '夜空闪电劈下。雷光闪烁',
    '无懈可击': '化解攻击的法阵。光华护盾',
    '铁索连环': '铁索连环船阵。铁链相连',
    '火攻': '火箭焚烧营地。烈焰冲天',
    '借刀杀人': '借刀场景。两武将递刀',
  };
  return map[n] || `与「${n}」主题契合的中国古典场景`;
}

// ─── LLM 调用 ──────────────────────────────────────────────
async function generate(prompt: string, sz: string): Promise<{ url: string; usage: unknown }> {
  const body = JSON.stringify({ model: 'sensenova-u1-fast', prompt, size: sz, n: 1 });
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`生成失败 HTTP ${res.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  const url = json.data?.[0]?.url;
  if (!url) throw new Error(`响应无 data[0].url: ${text.slice(0, 500)}`);
  return { url, usage: json.usage };
}

async function download(url: string, dest: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return buf.length;
}

// ─── prompt 构造 ─────────────────────────────────────────
// 参照 SenseNova-Skills/sn-infographic/references/prompt-writing-rules.md:
//   1. 必描述背景纹理 + 字体风格(否则 LLM 任意选);
//   2. 禁止 hex 色值,改用自然语言色名(朱砂红/宣纸米黄 等);
//   3. 要烤进图的文字必须加双引号(如 "杀");
//   4. 禁止否定性指令("不要画 X"),T2I 模型处理不稳定,直接正向描述。
// 整体风格锁定:水墨工笔融合画,宣纸纹理,三国古典英雄题材。
const STYLE_ANCHOR = [
  '风格:水墨工笔融合画,浓墨晕染与细腻勾线并存,参照中国古典插画与三国题材工笔人物画传统。',
  '背景纹理:陈年宣纸,纸面带有细微的纤维起伏与淡黄色调,偶有轻微折度与透墨感。',
  '配色:以浓墨与淡墨为主调,点缀朱砂红、石青蓝、赭石黄等传统国画颜料色,色彩古朴沉稳。',
  '整体氛围:庄重古朴,带英雄气概,有三国时代的史诗感。',
].join('\n');

// 插画尺寸 = 插画区尺寸(非整卡),prompt 不提"三国杀卡牌"避免 LLM 画边框。
// 强调填满画布、属性杀加火焰/雷电衬托。
function buildArtPrompt(n: string, dt: string | undefined, kind: LayoutKind): string {
  const illustration = illustrationFor(n, dt);
  // 属性杀:插画整体须被火焰/雷电笼罩(不只是主体手持火剑)
  const elemental = dt === '火焰'
    ? `画面整体笼罩在熊熊烈焰之中:赤红火焰从画面底部向上暂饶,环绕主体四周,火光映红整个画面,火星飞溅;主体本身也燃烧着火焰。`
    : dt === '雷电'
    ? `画面整体被紫蓝色雷电环绕:数道闪电从画面上方劈下,环绕主体四周,电光照亮整个画面,背景是紫蓝色雷云;主体身上也有电弧环绕。`
    : '';
  const orient = kind === 'basic'
    ? `竖版构图(高度大于宽度)。`
    : `横版构图(宽度大于高度)。`;
  return [
    `一幅中国古典题材插画,${orient}`,
    STYLE_ANCHOR,
    `【填满要求-最重要】画面从左边缘延伸到右边缘、从上边缘延伸到下边缘,充满整张画布。画中每个区域都有实质内容:山峦、云雾、树木、建筑、火焰、雷电、纹饰、色块,任何方向都不出现裸露的背景纸色。`,
    `【主体要求】画面焦点居中,主体占画面约四分之三,周围填满与其呼应的陪衬景物,形成完整的构图闭环。`,
    `插画内容:${illustration}。`,
    elemental || `画面四周以淡墨山水或云纹烘托主体,填充所有空白。`,
    `纯插画作品,画面中只包含插画内容本身。`,
  ].filter(Boolean).join('\n\n');
}

// ─── 标题/点数艺术字 prompt(LLM 生成 PNG,缓存复用) ────
// 标题 PNG:每牌一张,按 damageType 区分(火杀/雷杀是不同标题)。
// 点数 PNG:每个点数×颜色复用一张(共 13×2=26 张)。
// 所有艺术字 PNG 都生成在宣纸色背景上(与卡牌底色一致),合成时直接覆盖。
// 样式参考真实三国杀卡牌的标题字:行楷书法,雄浑有力,带飞白与墨浑。
function buildTitlePrompt(n: string, dt: string | undefined): string {
  const charCount = [...n].length;
  const charDesc = charCount === 1 ? '一个巨大的书法字' : charCount === 2 ? '两个大字水平排列' : `${charCount} 个大字水平居中排列`;
  const colorHint = dt === '火焰'
    ? '朱砂红色字体,字体周围环绕燃烧的火焰纹饰,火焰从文字下方升起环绕,字形边缘略带火光灿灿的灼烧感'
    : dt === '雷电'
    ? '紫蓝色字体,字体周围环绕闪烁的紫蓝雷电纹饰,电光在文字周身溅射,字形边缘带电闪的冷光感'
    : '深朱砂红色字体,配以金色描边,字形质感厚重古朴';
  return [
    `一幅书法艺术字图,画面主体是 "${n}" 这组字,${charDesc}。`,
    `字体风格:雄浑的行楷书法(介于楷书的端庄与行书的流动之间),参照三国时期碑榜与古代武将旗号的笔意,笔锋苍劲有力。`,
    `【笔触质感-最重要】这是真实的毛笔书法作品:每一笔必须有明显的【飞白】(笔画中段的纸色透出)、【枯笔】(笔画末端的干涸扫途)、【墨浑】(笔画边缘的墨汁泗开)三个效果同时出现。笔画中浓墨与淡墨交织,整体要有手写书法的不均匀质感与气韵,避免任何印刷体或电脑字体的均匀外观。`,
    `字体颜色与装饰:${colorHint}。`,
    `背景为陈年宣纸色(古朴的淡黄米色,带有可见的纤维纹理、轻微的折度与透墨感,纸面略带不规则起伏),背景平铺,无其他元素。`,
    `文字水平居中,占画面宽度的八成以上,上下留白适度。`,
    `纯书法艺术字作品,画面中只有这组字本身与其周围的装饰纹样。`,
  ].join('\n\n');
}

function buildRankPrompt(rank: string, isRed: boolean): string {
  // 重要:点数必须是阿拉伯数字或字母(A/J/Q/K),LLM 在"隶书/书法"语境下
  // 会生成财务大写汉字(柒/伍),与卡牌点数语义不符。改用现代粗体印刷风格。
  const color = isRed ? '深朱砂红色' : '浓墨黑色';
  return [
    `一个粗体阿拉伯数字或字母 "${rank}",超大居中。`,
    `字体风格:现代粗体衬线印刷字,参照扑克牌点数的字体,笔画粗壮有力,轮廓清晰。`,
    `【严格要求】画面中必须清晰呈现 "${rank}" 这个符号本身;只画这个符号本身,不加任何其他字符或纹样。`,
    `颜色:${color},无描边。`,
    `背景为陈年宣纸色(古朴的淡黄米色,带细微纤维纹理)。`,
    `数字占画面的八成以上,上下左右居中。`,
    `纯数字图,画面中只有这个数字本身。`,
  ].join('\n\n');
}
// ─── SVG 文字层构造(仅花色符号+技能说明+印章+坐骑±1) ────
// 标题与点数已由 LLM 生成艺术字 PNG,在 compose() 中独立叠加;
// 本函数只负责其他仍需程序绘制的元素,保证多牌一致。
//   basic:只有花色符号
//   mount:花色符号+大字+1/-1+印章
//   standard:花色符号+技能说明+攻击范围(武器)+印章
function buildTextOverlay(name: string, suit: Suit, rank: string, def: CardDef, dt: string | undefined, kind: LayoutKind): string {
  const sColor = suitColorName(suit);
  const suitChar = suitUnicode(suit);
  const label = typeLabel(name, def.type, def.subtype, dt);
  const elems: string[] = [];

  // 花色符号(左上角,在点数 PNG 下方)——点数 PNG 在 yStartPct-yEndPct 区间,花色画在其下方
  const suitLayout = kind === 'basic' ? LAYOUT_BASIC.suit : kind === 'mount' ? LAYOUT_MOUNT.suit : LAYOUT_STANDARD.suit;
  const suitX = Math.round(W * suitLayout.xPct);
  const suitY = Math.round(H * suitLayout.yPct);
  const suitFontSize = Math.round(H * 0.05);
  elems.push(`<text x="${suitX}" y="${suitY + suitFontSize}" font-family="Noto Sans CJK SC, sans-serif" font-size="${suitFontSize}" fill="${sColor}" text-anchor="middle">${suitChar}</text>`);

  if (kind === 'basic') {
    // 基本牌:只有花色符号(标题、点数是 LLM PNG,插画占主体)
    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${elems.join('\n')}</svg>`;
  }

  if (kind === 'mount') {
    // 坐骑:中央大字 +1/-1
    const isAttack = def.subtype === '进攻马';
    const mt = isAttack ? '-1' : '+1';
    const mtColor = isAttack ? '#c0392b' : '#1a5d1a';
    const mtY = Math.round(H * LAYOUT_MOUNT.mountText.yPct);
    elems.push(`<text x="${W / 2}" y="${mtY}" font-family="Noto Serif CJK SC, serif" font-size="${Math.round(H * 0.12)}" font-weight="bold" fill="${mtColor}" text-anchor="middle">${mt}</text>`);
  } else {
    // standard:技能说明 + 武器攻击范围
    const skillText = getCardDescription(name);
    const isWeapon = def.subtype === '武器';
    const rangeVal = def.range;
    if (isWeapon && rangeVal != null) {
      // 攻击范围:左下角,数字+竖排说明(与印章同行,印盘左侧)
      const rangeX = Math.round(W * LAYOUT_STANDARD.range.xPct);
      const rangeY = Math.round(H * LAYOUT_STANDARD.range.yPct);
      const rangeFontSize = Math.round(H * 0.04);
      const labelFontSize = Math.round(H * 0.012);
      elems.push(`<text x="${rangeX}" y="${rangeY}" font-family="Noto Serif CJK SC, serif" font-size="${rangeFontSize}" font-weight="bold" fill="#c0392b" text-anchor="start">${rangeVal}</text>`);
      const labelX = rangeX + rangeFontSize + 4;
      const labelTopY = rangeY - rangeFontSize + labelFontSize;
      '攻击范围'.split('').forEach((ch, i) => {
        elems.push(`<text x="${labelX}" y="${labelTopY + i * (labelFontSize + 2)}" font-family="Noto Serif CJK SC, serif" font-size="${labelFontSize}" fill="#c0392b" text-anchor="start">${ch}</text>`);
      });
    }
    if (skillText) {
      const tx = Math.round(W * (LAYOUT_STANDARD.skillText.xPct - LAYOUT_STANDARD.skillText.wPct / 2));
      const ty = Math.round(H * LAYOUT_STANDARD.skillText.yStartPct);
      const tw = Math.round(W * LAYOUT_STANDARD.skillText.wPct);
      const th = Math.round(H * (LAYOUT_STANDARD.skillText.yEndPct - LAYOUT_STANDARD.skillText.yStartPct));
      // 半透明米黄背景(比技能区略大一圈)
      elems.push(`<rect x="${tx - 8}" y="${ty - 8}" width="${tw + 16}" height="${th + 16}" fill="rgb(245,235,215)" opacity="0.88" stroke="#8b6914" stroke-width="1" stroke-opacity="0.3" />`);
      // 小号字体(用户明确要求小号:原 th/3.5 过大,现为 th/8)
      const fontSize = Math.round(th / 8);
      const lineHeight = Math.round(fontSize * 1.35);
      const charsPerLine = Math.max(10, Math.floor(tw / fontSize));
      const lines: string[] = [];
      for (let i = 0; i < skillText.length; i += charsPerLine) lines.push(skillText.slice(i, i + charsPerLine));
      const totalH = lines.length * lineHeight;
      const startY = ty + Math.round((th - totalH) / 2) + fontSize;
      lines.forEach((line, idx) => {
        elems.push(`<text x="${tx + tw / 2}" y="${startY + idx * lineHeight}" font-family="Noto Serif CJK SC, serif" font-size="${fontSize}" fill="#2a1a0a" text-anchor="middle">${escapeXml(line)}</text>`);
      });
    }
  }

  // 底部牌类印章(非 basic 都有)
  const sealLayout = kind === 'mount' ? LAYOUT_MOUNT.seal : LAYOUT_STANDARD.seal;
  const sealX = Math.round(W * sealLayout.xPct);
  const sealY = Math.round(H * sealLayout.yPct);
  const sealW = Math.round(W * 0.12);
  const sealH = Math.round(H * 0.035);
  const sealFontSize = Math.round(sealH * 0.6);
  elems.push(`<rect x="${sealX - sealW / 2}" y="${sealY - sealH / 2}" width="${sealW}" height="${sealH}" fill="#c0392b" stroke="#8b0000" stroke-width="2" />`);
  elems.push(`<text x="${sealX}" y="${sealY + sealFontSize * 0.35}" font-family="Noto Serif CJK SC, serif" font-size="${sealFontSize}" font-weight="bold" fill="white" text-anchor="middle">${escapeXml(label)}</text>`);

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${elems.join('\n')}</svg>`;
}

// ─── 程序绘制边框 SVG(精致回纹+云纹+米黄背景) ────────
// 从 SVG 渲染一次到 border.png,所有卡牌复用,保证像素级一致。
// 边框宽 80px,回纹连续 pattern + 四角云纹章(直接内联) + 内外双线框。
function buildBorderSvg(): string {
  const bw = 80; // 边框宽度
  const outer = 4;  // 最外线距画布边缘
  const frameColor = '#6b4e1a';  // 深棕(回纹/外线)
  const goldColor = '#a8842a';   // 金色(内线/云纹)
  const bgLight = '#f5e6c8';     // 米黄背景
  const bgDark = '#e8d4a8';      // 深米黄(纹理点)
  const hui = 40; // 回纹单元
  // 单个角部云纹章(居中于 cx,cy)
  const cloudSeal = (cx: number, cy: number): string => `
    <circle cx="${cx}" cy="${cy}" r="27" fill="${bgLight}" stroke="${goldColor}" stroke-width="2.5"/>
    <circle cx="${cx}" cy="${cy}" r="21" fill="none" stroke="${frameColor}" stroke-width="1.2"/>
    <path d="M${cx-12},${cy+2} Q${cx-14},${cy-10} ${cx-2},${cy-12} Q${cx+10},${cy-13} ${cx+12},${cy-2} Q${cx+13},${cy+7} ${cx+5},${cy+11} Q${cx-1},${cy+12} ${cx-3},${cy+8} Q${cx-5},${cy+4} ${cx-1},${cy+2}" fill="none" stroke="${frameColor}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M${cx-8},${cy} Q${cx-4},${cy-5} ${cx+1},${cy-1}" fill="none" stroke="${goldColor}" stroke-width="1.4" stroke-linecap="round"/>`;
  const corners = [[bw/2,bw/2],[W-bw/2,bw/2],[bw/2,H-bw/2],[W-bw/2,H-bw/2]];
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="huiwen" x="0" y="0" width="${hui}" height="${hui}" patternUnits="userSpaceOnUse">
      <path d="M0,${hui/2} L${hui*0.3},${hui/2} L${hui*0.3},${hui*0.2} L${hui*0.7},${hui*0.2} L${hui*0.7},${hui*0.8} L${hui*0.3},${hui*0.8} L${hui*0.3},${hui/2} L${hui},${hui/2}" fill="none" stroke="${frameColor}" stroke-width="1.5"/>
    </pattern>
    <pattern id="paper" x="0" y="0" width="5" height="5" patternUnits="userSpaceOnUse">
      <rect width="5" height="5" fill="${bgLight}"/>
      <circle cx="1" cy="2" r="0.4" fill="${bgDark}" opacity="0.18"/>
      <circle cx="3" cy="4" r="0.3" fill="${bgDark}" opacity="0.12"/>
    </pattern>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#paper)"/>
  <path d="M0,0 H${W} V${H} H0 Z M${bw},${bw} H${W-bw} V${H-bw} H${bw} Z" fill="url(#huiwen)" fill-rule="evenodd"/>
  <rect x="${outer}" y="${outer}" width="${W-2*outer}" height="${H-2*outer}" fill="none" stroke="${frameColor}" stroke-width="2"/>
  <rect x="${bw-3}" y="${bw-3}" width="${W-2*(bw-3)}" height="${H-2*(bw-3)}" fill="none" stroke="${goldColor}" stroke-width="3"/>
  ${corners.map(([cx,cy])=>cloudSeal(cx,cy)).join('\n  ')}
</svg>`;
}

// ─── prompt:空边框模板(LLM 生成,存文件复用) ─────────────
function buildBorderPrompt(): string {
  return [
    `一张中式古典风格的空边框卡牌模板,竖版卡面。`,
    STYLE_ANCHOR,
    `整个画面是一张空白卡牌的边框和底色,中央完全留空,仅保留边框装饰与背景纹理。`,
    `四周边框采用中式云纹与回纹交织的装饰纹样,边框宽度约占卡面宽度的百分之五,纹样精致华丽,参照中国古代书籍装帧与画卷装裱的边框样式。`,
    `卡牌底色为陈年宣纸色,纸面带细微的纤维起伏与做旧质感。`,
    `边框四角点缀小型的云纹或卷草纹装饰节点,与边框纹样连为一体。`,
    `中央留空区域占卡面约八成五的面积,背景为纯一色的宣纸底,画面其他区域只呈现边框纹样与四角装饰。`,
    `整体风格古朴庄重,有书籍装帧的典雅与画卷装裱的精致感。`,
  ].join('\n\n');
}

// ─── 牌背模板(纯 SVG,所有牌共用一张) ───────────────
// 设计:与卡牌边框同一套回纹+云纹+米黄底,中央放大印章(朱砂红底白字"杀"),
// 上下留白处填云纹装饰。保证整副牌背面视觉一致。
function buildBackSvg(): string {
  const bw = 80;
  const outer = 4;
  const frameColor = '#6b4e1a';
  const goldColor = '#a8842a';
  const bgLight = '#f5e6c8';
  const bgDark = '#e8d4a8';
  const sealRed = '#8b1a1a';
  const sealRedDark = '#5c0f0f';
  const hui = 40;
  const cx = W / 2;
  const cy = H / 2;
  // 中央大印章直径占卡宽 55%
  const sealR = Math.round(W * 0.275);
  // 单角云纹章(与 buildBorderSvg 一致)
  const cloudSeal = (ccx: number, ccy: number): string => `
    <circle cx="${ccx}" cy="${ccy}" r="27" fill="${bgLight}" stroke="${goldColor}" stroke-width="2.5"/>
    <circle cx="${ccx}" cy="${ccy}" r="21" fill="none" stroke="${frameColor}" stroke-width="1.2"/>
    <path d="M${ccx-12},${ccy+2} Q${ccx-14},${ccy-10} ${ccx-2},${ccy-12} Q${ccx+10},${ccy-13} ${ccx+12},${ccy-2} Q${ccx+13},${ccy+7} ${ccx+5},${ccy+11} Q${ccx-1},${ccy+12} ${ccx-3},${ccy+8} Q${ccx-5},${ccy+4} ${ccx-1},${ccy+2}" fill="none" stroke="${frameColor}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M${ccx-8},${ccy} Q${ccx-4},${ccy-5} ${ccx+1},${ccy-1}" fill="none" stroke="${goldColor}" stroke-width="1.4" stroke-linecap="round"/>`;
  const corners = [[bw/2,bw/2],[W-bw/2,bw/2],[bw/2,H-bw/2],[W-bw/2,H-bw/2]];
  // 印章上方一条横向云纹带,下方对称
  const cloudBand = (yCenter: number): string => {
    const y = yCenter;
    const halfW = Math.round(W * 0.28);
    return `<path d="M${cx-halfW},${y} Q${cx-halfW*0.6},${y-30} ${cx},${y} Q${cx+halfW*0.6},${y+30} ${cx+halfW},${y}" fill="none" stroke="${goldColor}" stroke-width="2" stroke-linecap="round"/>
      <path d="M${cx-halfW*0.85},${y+6} Q${cx-halfW*0.4},${y+18} ${cx-halfW*0.1},${y+6}" fill="none" stroke="${frameColor}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M${cx+halfW*0.1},${y+6} Q${cx+halfW*0.4},${y+18} ${cx+halfW*0.85},${y+6}" fill="none" stroke="${frameColor}" stroke-width="1.5" stroke-linecap="round"/>`;
  };
  const sealTop = cy - sealR - 80;
  const sealBot = cy + sealR + 80;
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="huiwen" x="0" y="0" width="${hui}" height="${hui}" patternUnits="userSpaceOnUse">
      <path d="M0,${hui/2} L${hui*0.3},${hui/2} L${hui*0.3},${hui*0.2} L${hui*0.7},${hui*0.2} L${hui*0.7},${hui*0.8} L${hui*0.3},${hui*0.8} L${hui*0.3},${hui/2} L${hui},${hui/2}" fill="none" stroke="${frameColor}" stroke-width="1.5"/>
    </pattern>
    <pattern id="paper" x="0" y="0" width="5" height="5" patternUnits="userSpaceOnUse">
      <rect width="5" height="5" fill="${bgLight}"/>
      <circle cx="1" cy="2" r="0.4" fill="${bgDark}" opacity="0.18"/>
      <circle cx="3" cy="4" r="0.3" fill="${bgDark}" opacity="0.12"/>
    </pattern>
    <radialGradient id="sealGrad" cx="0.5" cy="0.4" r="0.7">
      <stop offset="0" stop-color="${sealRed}"/>
      <stop offset="1" stop-color="${sealRedDark}"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#paper)"/>
  <path d="M0,0 H${W} V${H} H0 Z M${bw},${bw} H${W-bw} V${H-bw} H${bw} Z" fill="url(#huiwen)" fill-rule="evenodd"/>
  <rect x="${outer}" y="${outer}" width="${W-2*outer}" height="${H-2*outer}" fill="none" stroke="${frameColor}" stroke-width="2"/>
  <rect x="${bw-3}" y="${bw-3}" width="${W-2*(bw-3)}" height="${H-2*(bw-3)}" fill="none" stroke="${goldColor}" stroke-width="3"/>
  ${corners.map(([ccx,ccy])=>cloudSeal(ccx,ccy)).join('\n  ')}
  ${cloudBand(sealTop)}
  <circle cx="${cx}" cy="${cy}" r="${sealR}" fill="url(#sealGrad)" stroke="${sealRedDark}" stroke-width="3"/>
  <circle cx="${cx}" cy="${cy}" r="${sealR-10}" fill="none" stroke="${bgLight}" stroke-width="2" opacity="0.7"/>
  <text x="${cx}" y="${cy + sealR*0.32}" font-family="Noto Serif CJK SC, Noto Sans CJK SC, serif" font-size="${Math.round(sealR*1.4)}" font-weight="900" fill="${bgLight}" text-anchor="middle" dominant-baseline="alphabetic">杀</text>
  ${cloudBand(sealBot)}
</svg>`;
}

// ─── 合成:边框文件 + 插画(带边缘渐变) + 文字层 ───────
// 边框宽 80px(与 buildBorderSvg 的 bw 一致),插画严格落在边框内。
// 插画边缘叠加半透明渐变(从透明到卡牌背景色),让插画自然融入边框。
const BORDER_WIDTH = 80;
const CARD_BG = '#f5e6c8'; // 卡牌背景色(与 buildBorderSvg bgLight 一致)

// 构造插画区尺寸的边缘渐变遂罩:中央透明,四周渐变为卡牌背景色。
// fadeWidth 为渐变宽度(像素)。
function buildArtFadeSvg(w: number, h: number, fadeWidth: number): string {
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${CARD_BG}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${CARD_BG}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${CARD_BG}" stop-opacity="0"/>
      <stop offset="1" stop-color="${CARD_BG}" stop-opacity="0.85"/>
    </linearGradient>
    <linearGradient id="leftFade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${CARD_BG}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${CARD_BG}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="rightFade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${CARD_BG}" stop-opacity="0"/>
      <stop offset="1" stop-color="${CARD_BG}" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${w}" height="${fadeWidth}" fill="url(#topFade)"/>
  <rect x="0" y="${h - fadeWidth}" width="${w}" height="${fadeWidth}" fill="url(#bottomFade)"/>
  <rect x="0" y="0" width="${fadeWidth}" height="${h}" fill="url(#leftFade)"/>
  <rect x="${w - fadeWidth}" y="0" width="${fadeWidth}" height="${h}" fill="url(#rightFade)"/>
</svg>`;
}

async function compose(artPath: string, titlePath: string, rankPath: string, outFile: string, textOverlay: string, kind: LayoutKind): Promise<number> {
  if (!existsSync(BORDER_FILE)) throw new Error(`边框模板不存在: ${BORDER_FILE}。请先运行: tsx scripts/gen-card.ts --gen-border`);

  // 插画区坐标(按布局选)
  const artLayout = kind === 'basic' ? LAYOUT_BASIC.art : kind === 'mount' ? LAYOUT_MOUNT.art : LAYOUT_STANDARD.art;
  const artX = BORDER_WIDTH;
  const artYStart = Math.round(H * artLayout.yStartPct);
  const artYEnd = Math.round(H * artLayout.yEndPct);
  const artW = W - 2 * BORDER_WIDTH;
  const artH = artYEnd - artYStart;

  // 1. 缩放插画到插画区尺寸(填满,轻微裁切)
  const artBuf = await sharp(artPath)
    .resize(artW, artH, { fit: 'cover', position: 'center' })
    .png()
    .toBuffer();

  // 2. 插画边缘渐变遂罩(与插画同尺寸,叠在插画上)
  const fadeWidth = Math.round(Math.min(artW, artH) * 0.08); // 8% 渐变宽度
  const fadeBuf = await sharp(Buffer.from(buildArtFadeSvg(artW, artH, fadeWidth))).png().toBuffer();
  const artWithFade = await sharp(artBuf).composite([{ input: fadeBuf, top: 0, left: 0 }]).png().toBuffer();

  // 3. 标题艺术字 PNG(缩放到布局区,居中顶部)
  const titleLayout = kind === 'basic' ? LAYOUT_BASIC.title : kind === 'mount' ? LAYOUT_MOUNT.title : LAYOUT_STANDARD.title;
  const titleW = Math.round(W * titleLayout.wPct);
  const titleH = Math.round(H * (titleLayout.yEndPct - titleLayout.yStartPct));
  const titleX = Math.round(W * titleLayout.xCenter - titleW / 2);
  const titleY = Math.round(H * titleLayout.yStartPct);
  const titleBuf = await sharp(titlePath).resize(titleW, titleH, { fit: 'contain', position: 'center' }).png().toBuffer();

  // 4. 点数艺术字 PNG(缩放到左上角布局区)
  const rankLayout = kind === 'basic' ? LAYOUT_BASIC.rank : kind === 'mount' ? LAYOUT_MOUNT.rank : LAYOUT_STANDARD.rank;
  const rankW = Math.round(W * (rankLayout.xEndPct - rankLayout.xStartPct));
  const rankH = Math.round(H * (rankLayout.yEndPct - rankLayout.yStartPct));
  const rankX = Math.round(W * rankLayout.xStartPct);
  const rankY = Math.round(H * rankLayout.yStartPct);
  const rankBuf = await sharp(rankPath).resize(rankW, rankH, { fit: 'contain', position: 'center' }).png().toBuffer();

  // 5. 其他文字层(花色符号+技能说明+印章,SVG 程序绘制)
  const textBuf = Buffer.from(textOverlay);

  // 6. 合成顺序(从下到上):边框底图 → 插画(边框内)→ 点数 → 标题 → 其他文字层
  await sharp(BORDER_FILE)
    .composite([
      { input: artWithFade, top: artYStart, left: artX },
      { input: rankBuf, top: rankY, left: rankX },
      { input: titleBuf, top: titleY, left: titleX },
      { input: textBuf, top: 0, left: 0 },
    ])
    .toFile(outFile);

  return statSync(outFile).size;
}

// ─── flash-lite 验证 ────────────────────────────────────────
async function verify(imgPath: string, refPath: string): Promise<string> {
  // 压缩到 500px 宽避免 413
  const tmpSmall = '/tmp/verify_small.jpg';
  await sharp(imgPath).resize(500).jpeg({ quality: 70 }).toFile(tmpSmall);
  const gen = readFileSync(tmpSmall).toString('base64');
  const ref = existsSync(refPath) ? readFileSync(refPath).toString('base64') : null;
  const content: any[] = [
    { type: 'text', text: '你是三国杀卡牌设计评审。下面第一张是生成的卡牌图,第二张是官方参考卡牌(若有)。简短(150字内)评价:1)标题含【】 2)左上角花色点数 3)左下角攻击范围(武器牌) 4)底部技能描述文字完整无错字 5)中央插画 6)底部牌类印章 7)整体相似度(高/中/低)。' },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${gen}` } },
  ];
  if (ref) {
    // 参考图也压缩
    const tmpRef = '/tmp/verify_ref_small.jpg';
    await sharp(refPath).resize(500).jpeg({ quality: 70 }).toFile(tmpRef);
    content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${readFileSync(tmpRef).toString('base64')}` } });
  }
  const body = JSON.stringify({ model: 'sensenova-6.7-flash-lite', messages: [{ role: 'user', content }], max_tokens: 400 });
  const res = await fetch(VISION_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body });
  const text = await res.text();
  if (!res.ok) return `验证失败 HTTP ${res.status}: ${text.slice(0, 300)}`;
  const json = JSON.parse(text);
  return json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning || '(空)';
}

function savePromptMd(outDir: string, n: string, prompt: string, meta: Record<string, unknown>): void {
  writeFileSync(join(outDir, `${n}.md`), `# ${n} 卡牌生成提示词\n\n## 基本信息\n\n${Object.entries(meta).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## 完整 Prompt\n\n${prompt}\n`);
}

// ─── 主流程 ───────────────────────────────────────

// 模式 1:从 SVG 渲染边框模板到文件(不调 LLM,保证像素级一致)
if (args['gen-border'] === true) {
  const svg = buildBorderSvg();
  console.log('=== 从 SVG 渲染边框模板 ===');
  console.log(`输出: ${BORDER_FILE}`);
  if (dryRun) { console.log(svg); process.exit(0); }
  try {
    await sharp(Buffer.from(svg)).png().toFile(BORDER_FILE);
    const bytes = statSync(BORDER_FILE).size;
    console.log(`已保存边框模板: ${BORDER_FILE} (${(bytes / 1024).toFixed(1)} KB)`);
    console.log('从 SVG 渲染,所有卡牌复用此文件,边框/背景像素级一致。');
  } catch (e) { console.error((e as Error).message); process.exit(1); }
  process.exit(0);
}

// 模式 1b:从 SVG 渲染牌背到文件(不调 LLM,所有牌共用一张)
if (args['gen-back'] === true) {
  const svg = buildBackSvg();
  const backFile = join(AI_DIR, 'back.png');
  console.log('=== 从 SVG 渲染牌背 ===');
  console.log(`输出: ${backFile}`);
  if (dryRun) { console.log(svg); process.exit(0); }
  try {
    await sharp(Buffer.from(svg)).png().toFile(backFile);
    const bytes = statSync(backFile).size;
    console.log(`已保存牌背: ${backFile} (${(bytes / 1024).toFixed(1)} KB)`);
  } catch (e) { console.error((e as Error).message); process.exit(1); }
  process.exit(0);
}

// 模式 2:批量遍历整个牌堆,spawn 自身进程生成每张牌(串行,错误隔离)
// 用法:tsx scripts/gen-card.ts --all [--limit N] [--skip-existing]
if (args['all'] === true) {
  console.log('=== 批量生成全牌堆 ===');
  const deck = createStandardDeck();
  // 按 name+suit+rank+damageType 去重(同组合的物理牌共享一张图)
  const seen = new Set<string>();
  const uniq: { name: string; suit: Suit; rank: string; damageType?: string }[] = [];
  for (const c of deck) {
    const key = `${c.name}|${c.suit}|${c.rank}|${c.damageType ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push({ name: c.name, suit: c.suit, rank: c.rank, damageType: c.damageType });
  }
  const limit = args.limit ? parseInt(args.limit, 10) : uniq.length;
  const skipExisting = args['skip-existing'] === true;
  const list = uniq.slice(0, limit);
  console.log(`总牌数:${deck.length},去重后独立牌面:${uniq.length},本次生成:${list.length}${skipExisting ? '(跳过已存在)' : ''}`);

  const results: { ok: number; skipped: number; failed: { card: string; err: string }[] } = { ok: 0, skipped: 0, failed: [] };
  const t0 = Date.now();
  for (let i = 0; i < list.length; i++) {
    const { name: n, suit: s, rank: r, damageType: dt } = list[i];
    const subDir = DEF_INDEX.get(n)?.type === '基本牌' ? 'basic' : DEF_INDEX.get(n)?.type === '装备牌' ? 'equipment' : 'trick';
    const outName = `${n}-${r}-${s}.png`;
    const outPath = join(AI_DIR, subDir, outName);
    if (skipExisting && existsSync(outPath)) {
      console.log(`\n[${i+1}/${list.length}] 跳过(已存在): ${subDir}/${outName}`);
      results.skipped++;
      continue;
    }
    const cmdArgs = [n, '--suit', s, '--rank', r, '--out-name', outName];
    if (dt) cmdArgs.push('--damageType', dt);
    console.log(`\n[${i+1}/${list.length}] 生成: ${subDir}/${outName} (${n} ${s}${r}${dt ? ' ' + dt : ''})`);
    // 用 tsx 执行自身(tsx 会解析 .ts 导入)
    // 父进程是 tsx 启动时,tsx CLI 在 node_modules/.bin 或全局 PATH 中
    const child = spawnSync('tsx', [fileURLToPath(import.meta.url), ...cmdArgs], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (child.status === 0) results.ok++;
    else {
      results.failed.push({ card: `${subDir}/${outName}`, err: `exit ${child.status}` });
      console.error(`[失败] ${subDir}/${outName} (exit ${child.status})`);
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== 批量完成 (${elapsed}s) ===`);
  console.log(`成功: ${results.ok}, 跳过: ${results.skipped}, 失败: ${results.failed.length}`);
  if (results.failed.length) {
    console.log('失败列表:');
    for (const f of results.failed) console.log(`  - ${f.card}: ${f.err}`);
    process.exit(1);
  }
  process.exit(0);
}

const name = args._[0];

if (!name) { console.error('用法: tsx scripts/gen-card.ts <牌名> 或 tsx scripts/gen-card.ts --gen-border'); process.exit(1); }

const def = DEF_INDEX.get(name);
if (!def) { console.error(`错误:牌名「${name}」未在源代码 CardDef 中找到。`); process.exit(1); }

const suitArg = args.suit;
const rankArg = args.rank;
const damageTypeOverride = args.damageType;
const defaultCard = firstOccurrence(name);
const suit: Suit = suitArg || defaultCard?.suit || '♠';
const rank: string = rankArg || defaultCard?.rank || '7';
const damageType: string | undefined = damageTypeOverride || defaultCard?.damageType;

const sub = def.type === '基本牌' ? 'basic' : def.type === '装备牌' ? 'equipment' : 'trick';
const outDir = join(AI_DIR, sub);
// 文件名后缀:damageType(火/雷杀的插画、成品与普通杀区分开)
const suffix = damageType ? `_${damageType}` : '';
const artFile = join(outDir, `${name}${suffix}.art.png`);
// 成品文件名:默认 <名><suffix>,可用 --out-name 覆盖(批量生成时用 [名]-[点]-[花色].png)
const outNameArg = args['out-name'];
const outFile = outNameArg ? join(outDir, outNameArg) : join(outDir, `${name}${suffix}.png`);
// 标题与点数艺术字 PNG 的缓存目录(按点数×颜色复用)
const TITLE_DIR = join(AI_DIR, '_titles');
const RANK_DIR = join(AI_DIR, '_ranks');
// 标题按 牌名+属性 区分(火杀/雷杀是不同标题)
const titleFile = join(TITLE_DIR, `${name}${damageType ? `_${damageType}` : ''}.png`);
// 点数按 点数+颜色 复用(13 点数× 2 颜色 = 最多 26 张)
const isRedSuit = suit === '♥' || suit === '♦';
const rankFile = join(RANK_DIR, `${rank}_${isRedSuit ? 'red' : 'black'}.png`);
const refFile = existsSync(join(ROOT, 'docs', 'card-refs', `${name}.png`))
  ? join(ROOT, 'docs', 'card-refs', `${name}.png`)
  : join(ROOT, 'public', 'cards', sub, `${name}.png`);

const kind = cardLayoutKind(def);
const artPrompt = buildArtPrompt(name, damageType, kind);
const titlePrompt = buildTitlePrompt(name, damageType);
const rankPrompt = buildRankPrompt(rank, isRedSuit);
const meta: Record<string, unknown> = {
  '牌名': name, '花色': `${suitName(suit)}(${suit})`, '点数': rank,
  '类型': def.type, '子类': def.subtype, '布局': kind,
};
if (def.range != null) meta['攻击范围'] = def.range;
if (damageType) meta['属性'] = damageType;
if (defaultCard) meta['牌堆首次出现'] = `${suit}${rank}`;
meta['尺寸'] = size;
const artLayout = kind === 'basic' ? LAYOUT_BASIC.art : kind === 'mount' ? LAYOUT_MOUNT.art : LAYOUT_STANDARD.art;
meta['插画区'] = `宽 ${W - 2 * BORDER_WIDTH} × 高 ${Math.round(H * (artLayout.yEndPct - artLayout.yStartPct))}`;
meta['插画生成尺寸'] = ART_SIZE_FOR_KIND[kind];
meta['边框模板'] = `${BORDER_FILE} ${existsSync(BORDER_FILE) ? '[存在]' : '[不存在,需先 --gen-border]'}`;
meta['技能描述'] = kind === 'mount' ? (def.subtype === '进攻马' ? '-1' : '+1') : (getCardDescription(name) || '(无)');
meta['标题艺术字'] = `${titleFile} ${existsSync(titleFile) ? '[存在]' : '[需生成]'}`;
meta['点数艺术字'] = `${rankFile} ${existsSync(rankFile) ? '[存在]' : '[需生成]'}`;
meta['插画输出'] = artFile;
meta['成品输出'] = outFile;
meta['参考(官方)'] = `${refFile} ${existsSync(refFile) ? '[存在]' : '[不存在]'}`;

console.log('=== 卡牌生成(分层合成) ===');
for (const [k, v] of Object.entries(meta)) console.log(`${k}: ${v}`);
console.log(`插画 prompt:\n${artPrompt}`);
console.log(`\n标题 prompt:\n${titlePrompt}`);
console.log(`\n点数 prompt:\n${rankPrompt}`);

if (dryRun) { console.log('\n[dry-run] 不调用 API'); savePromptMd(outDir, name, artPrompt, meta); process.exit(0); }

try {
  // 0. 标题艺术字 PNG:若不存在则 LLM 生成(每牌+属性一张,缓存复用)
  if (existsSync(titleFile)) {
    console.log(`\n标题艺术字已存在,复用: ${titleFile}`);
  } else {
    if (!apiKey) { console.error('错误:缺少 API Key。用 --api-key 或设置 SENSENOVA_API_KEY。'); process.exit(1); }
    const t0 = Date.now();
    const { url, usage } = await generate(titlePrompt, '2752x1536'); // 横版 16:9,适合三字水平排列
    console.log(`\n标题艺术字生成耗时: ${Date.now() - t0}ms, usage: ${JSON.stringify(usage)}`);
    const bytes = await download(url, titleFile);
    console.log(`已保存标题艺术字: ${titleFile} (${(bytes / 1024).toFixed(1)} KB)`);
  }

  // 0b. 点数艺术字 PNG:若不存在则 LLM 生成(按点数+颜色复用)
  if (existsSync(rankFile)) {
    console.log(`\n点数艺术字已存在,复用: ${rankFile}`);
  } else {
    if (!apiKey) { console.error('错误:缺少 API Key。用 --api-key 或设置 SENSENOVA_API_KEY。'); process.exit(1); }
    const t0 = Date.now();
    const { url, usage } = await generate(rankPrompt, '2048x2048'); // 正方形
    console.log(`\n点数艺术字生成耗时: ${Date.now() - t0}ms, usage: ${JSON.stringify(usage)}`);
    const bytes = await download(url, rankFile);
    console.log(`已保存点数艺术字: ${rankFile} (${(bytes / 1024).toFixed(1)} KB)`);
  }

  // 1. 插画:若 .art.png 已存在则复用(不调 LLM),否则 LLM 生成
  const artSize = ART_SIZE_FOR_KIND[kind];
  if (existsSync(artFile)) {
    console.log(`\n插画已存在,复用: ${artFile} (跳过 LLM,如需重新生成请删除该文件)`);
  } else {
    if (!apiKey) { console.error('错误:缺少 API Key。用 --api-key 或设置 SENSENOVA_API_KEY。'); process.exit(1); }
    const t0 = Date.now();
    const { url, usage } = await generate(artPrompt, artSize);
    console.log(`\n插画生成耗时: ${Date.now() - t0}ms, usage: ${JSON.stringify(usage)}`);
    const artBytes = await download(url, artFile);
    console.log(`已保存插画: ${artFile} (${(artBytes / 1024).toFixed(1)} KB)`);
  }

  // 2. 程序合成:边框 + 插画 + 点数 + 标题 + 其他文字层(花色/技能/印章)
  const textOverlay = buildTextOverlay(name, suit, rank, def, damageType, kind);
  const composedBytes = await compose(artFile, titleFile, rankFile, outFile, textOverlay, kind);
  console.log(`已合成成品: ${outFile} (${(composedBytes / 1024).toFixed(1)} KB)`);

  savePromptMd(outDir, `${name}${suffix}`, artPrompt, meta);
  console.log(`提示词已保存: ${join(outDir, `${name}.md`)}`);

  if (args.verify === true) {
    console.log('\n=== flash-lite 视觉验证 ===');
    const review = await verify(outFile, refFile);
    console.log(review);
  }
} catch (e) { console.error((e as Error).message); process.exit(1); }
