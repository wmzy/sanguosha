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

/** 四角 L 角饰生成器:8 层实色 linear-gradient 角件(每角横臂+竖臂各一层),
 *  供元素 background 叠层使用(层叠顺序:左上/右上/左下/右下,先横后竖)。
 *  color 可传 CSS 变量(如 var(--orn));offset 为角件离各边的距离,arm/thickness
 *  为臂长与线宽。消费者:charSelect 面板角饰、layout 战场区四角装裱线。 */
export function cornerBracket(
  color: string,
  offset = '0',
  arm = '16px',
  thickness = '2px',
): string {
  const g = `linear-gradient(${color}, ${color})`;
  return [
    `${g} left ${offset} top ${offset} / ${arm} ${thickness} no-repeat`,
    `${g} left ${offset} top ${offset} / ${thickness} ${arm} no-repeat`,
    `${g} right ${offset} top ${offset} / ${arm} ${thickness} no-repeat`,
    `${g} right ${offset} top ${offset} / ${thickness} ${arm} no-repeat`,
    `${g} left ${offset} bottom ${offset} / ${arm} ${thickness} no-repeat`,
    `${g} left ${offset} bottom ${offset} / ${thickness} ${arm} no-repeat`,
    `${g} right ${offset} bottom ${offset} / ${arm} ${thickness} no-repeat`,
    `${g} right ${offset} bottom ${offset} / ${thickness} ${arm} no-repeat`,
  ].join(',\n      ');
}

/** 标题两侧饰线(—◆— 意向)生成器:近文字端一枚亮色方钻 + 向外渐隐细线。
 *  供标题 ::before/::after 的 background 层使用;::after 由调用处 scaleX(-1) 镜像。
 *  diamondColor/lineColor 为方钻与渐隐线颜色,diamondSize/lineThickness/lineInset
 *  为方钻边长、线宽与线短量(calc(100% - lineInset))。消费者:charSelect 选将标题、
 *  multiplayerStyles 等待大厅页标题。 */
export function ornamentTitle(
  diamondColor: string,
  lineColor: string,
  diamondSize = '5px',
  lineThickness = '2px',
  lineInset = '9px',
): string {
  return [
    `linear-gradient(${diamondColor}, ${diamondColor}) right center / ${diamondSize} ${diamondSize} no-repeat`,
    `linear-gradient(90deg, transparent, ${lineColor}) left center / calc(100% - ${lineInset}) ${lineThickness} no-repeat`,
  ].join(',\n      ');
}

/** 身份章色板:主公金/忠臣蓝/反贼红/内奸紫。座位卡名牌身份章(seat.ts 的
 *  seatIdentity* 系列)与角色大卡身份章(actionBar 的 playerCardStamp* 别名)共用,
 *  色板单一来源,两卡不再各持一份色值。 */
export const identityStampPalette = {
  lord: { background: '#d4a017', color: '#3a2400' },
  loyalist: { background: '#3f6fb5', color: '#fff' },
  rebel: { background: '#b03a30', color: '#fff' },
  renegade: { background: '#8e5aa8', color: '#fff' },
} as const;

/** 死亡立绘滤镜(灰度 + 压亮):座位卡与大卡共用结构,亮度按卡型
 *  (座位卡 0.7 / 大卡 0.6)。filter 为单属性,不能用「base 类 + 变体类」组合
 *  (后者会整体覆盖前者),故以值共享。 */
const deadPortraitFilter = (brightness: number) => `grayscale(1) brightness(${brightness})`;
export const seatDeadPortraitFilter = deadPortraitFilter(0.7);
export const largeCardDeadPortraitFilter = deadPortraitFilter(0.6);
