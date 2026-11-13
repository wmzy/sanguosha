// gameViewStyles 跨文件共享的视觉 token(纯字符串值,不含 css 类)。
// 消费方式:
//   ① css`` 内插值 —— wyw-in-js 支持纯值插值(同 theme.ts 的 colors 用法);
//     注意类(class)插值不会内联规则,禁止(见 ChatPanel/InfoDock 内注释)。
//   ② --bead-* CSS 变量值 —— 由 HpBeadColumn 组件内联 style 注入
//     playerCardHpBeadFull 单类,实现满珠三档分色。
// 本文件不进 index.ts barrel(barrel 只聚合样式类导出)。

/** 体力满珠三档分色的 --bead-* 变量值:绿(剩余 >50%)/ 黄(>25%)/ 红(≤25%,濒危警示)。
 *  大卡(PlayerCardLarge)与座位卡(PlayerSeatView)共用同一套,消除此前两处镜像的三份色值。 */
export type HpBeadHue = 'green' | 'yellow' | 'red';
export type HpBeadVars = Record<
  '--bead-c1' | '--bead-c2' | '--bead-border' | '--bead-glow',
  string
>;

export const hpBeadPalette: Record<HpBeadHue, HpBeadVars> = {
  green: {
    '--bead-c1': '#7ec850',
    '--bead-c2': '#3e8f2e',
    '--bead-border': 'rgba(46, 94, 28, 0.9)',
    '--bead-glow': 'rgba(126, 200, 80, 0.45)',
  },
  yellow: {
    '--bead-c1': '#e8c84a',
    '--bead-c2': '#b8862a',
    '--bead-border': 'rgba(122, 88, 20, 0.9)',
    '--bead-glow': 'rgba(232, 200, 74, 0.45)',
  },
  red: {
    '--bead-c1': '#e85d4a',
    '--bead-c2': '#a8281a',
    '--bead-border': 'rgba(122, 30, 20, 0.9)',
    '--bead-glow': 'rgba(232, 93, 74, 0.5)',
  },
};

/** 金色候选态色系(distribute 候选/转化匹配等「可点选」高亮):手牌与装备卡共用。
 *  rgb 供各处以不同透明度组合 rgba(...)。 */
export const goldCandidateColors = {
  border: '#f1c40f',
  rgb: '241, 196, 15',
  /** 候选态光晕(distribute 候选手牌/装备同强度) */
  glow: 'rgba(241, 196, 15, 0.4)',
} as const;

/** 绿色选中态色系(已点选待提交:手牌回应/分配选中、装备已选):手牌与装备卡共用。
 *  发光强度与背景 alpha 按各场景微调,rgb 供组合 rgba(...)。 */
export const greenSelectedColors = {
  border: '#2ecc71',
  rgb: '46, 204, 113',
} as const;

/** 底部渐变蒙版生成器:to top,底部最实、中段过渡、顶部完全透明。
 *  牌面文字层(手牌/翻牌卡)与大卡底部紧凑区共用同一结构,色值与挡位按场景传入。 */
function bottomFadeGradient(
  rgb: string,
  bottomAlpha: string,
  midAlpha: string,
  midStop: string
): string {
  return `linear-gradient(to top, rgba(${rgb}, ${bottomAlpha}) 0%, rgba(${rgb}, ${midAlpha}) ${midStop}, rgba(${rgb}, 0) 100%)`;
}

/** 手牌文字层蒙版(纯黑) */
export const handCardMetaFade = bottomFadeGradient('0, 0, 0', '0.82', '0.55', '60%');
/** 翻牌动效/展示卡文字层蒙版(纯黑,底端略深) */
export const eventCardMetaFade = bottomFadeGradient('0, 0, 0', '0.85', '0.55', '60%');
/** 大卡底部紧凑区蒙版(暖黑) */
export const playerCardBottomFade = bottomFadeGradient('10, 8, 5', '0.9', '0.78', '72%');
