// 页面级布局样式:页面骨架 + Header + 主内容(战场区+右侧边栏) + 底部手牌区。
// 动画 keyframes 见 src/client/animations.css(由 main.tsx 全局引入)。
//
// 参照官方三国杀界面布局:
//   ┌─────────────────────────────────────────────────┐
//   │ topbar (固定高度,极简)                          │
//   ├──────────────────────────────────┬──────────────┤
//   │                                  │ 右侧边栏     │
//   │       battle-field (flex 1)      │ (固定宽250px)│
//   │   ┌─座位环绕中央─┐                │  日志+聊天   │
//   │   │  处理区/牌堆  │                │  tabs       │
//   │   └──────────────┘                │              │
//   │   [prompt 浮在战场底部]            │              │
//   ├──────────────────────────────────┴──────────────┤
//   │ bottombar (固定高度 160px):装备 | 手牌 | 我方武将 │
//   └─────────────────────────────────────────────────┘

import { css } from '@linaria/core';
import { colors } from '../../theme';

// ─── 页面骨架 ───
export const pageRoot = css`
  font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
  background-color: ${colors.bg.page};
  color: ${colors.text.primary};
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 武将卡统一高度:大卡(PlayerCardLarge)在底栏 align-self:stretch,
     其渲染高度 = bottomLayout 内容高度(content-box)。座位卡(PlayerSeatView)
     与之共用此值,保证两者像素级一致。宽高比 15:19 由各处 aspect-ratio 推导宽度。 */
  --hero-card-h: 200px;
`;

// ─── Header(顶部栏,固定高度) ───
export const headerBar = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex: 0 0 auto;
  padding: 6px 12px;
  background: linear-gradient(rgba(10, 10, 18, 0.72), rgba(6, 6, 12, 0.66));
  border-bottom: 1px solid rgba(196, 162, 84, 0.3);
  box-shadow: 0 1px 0 rgba(255, 232, 170, 0.04);
`;
/* ── 顶栏按钮体系:统一幽灵药丸(ghost pill) ──
   形状/字号/高度一致,仅以色相区分语义:中性(退出/查看)/蓝(视角)/绿(自动切换/快照)。 */
export const backBtn = css`
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  padding: 3px 12px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  color: #cfcabb;
  font-size: 12px;
  line-height: 1.5;
  transition: all 0.15s;
  &:hover {
    border-color: rgba(217, 180, 92, 0.65);
    color: #ecd9a8;
    background: rgba(217, 180, 92, 0.08);
  }
`;
export const headerCenter = css`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
`;
export const roundBadge = css`
  background: rgba(20, 34, 62, 0.85);
  border: 1px solid rgba(90, 130, 190, 0.3);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 11px;
  color: #8fa8c8;
`;
export const phaseBadge = css`
  background: linear-gradient(rgba(214, 118, 26, 0.9), rgba(180, 92, 16, 0.9));
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 11px;
  color: #fff;
  font-weight: bold;
  box-shadow: inset 0 1px 0 rgba(255, 220, 160, 0.25);
`;
export const currentPlayerText = css`
  color: #f0d78a;
  font-size: 12px;
  letter-spacing: 0.5px;
`;
export const headerRight = css`
  display: flex;
  gap: 6px;
  align-items: center;
`;
export const perspectiveBtn = css`
  border: 1px solid rgba(82, 150, 220, 0.55);
  border-radius: 999px;
  padding: 3px 12px;
  cursor: pointer;
  background: rgba(52, 120, 200, 0.12);
  color: #7db8e8;
  font-size: 12px;
  line-height: 1.5;
  transition: all 0.15s;
  &:hover {
    border-color: rgba(120, 180, 240, 0.8);
    background: rgba(52, 120, 200, 0.22);
  }
`;
export const goToBtn = css`
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  padding: 3px 12px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  color: #b7b2a4;
  font-size: 12px;
  line-height: 1.5;
  transition: all 0.15s;
  &:hover {
    border-color: rgba(217, 180, 92, 0.65);
    color: #ecd9a8;
    background: rgba(217, 180, 92, 0.08);
  }
`;

/** 顶部栏右侧工具组:资源包/音效等常驻游戏工具按钮(内嵌 headerBar 右上角) */
export const toolbarGroup = css`
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
`;

/** 工具组内的图标按钮(📦 等),风格与 headerBar 其他按钮一致 */
export const toolbarBtn = css`
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  padding: 3px 9px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  color: #cfcabb;
  font-size: 14px;
  line-height: 1;
  transition: all 0.15s;
  &:hover {
    border-color: rgba(217, 180, 92, 0.65);
    color: #ecd9a8;
    background: rgba(217, 180, 92, 0.08);
  }
`;

/** 资源包管理下拉浮层(相对 toolbarGroup,从按钮下方弹出) */
export const packDropdown = css`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 1000;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
`;

// ─── 主内容:左侧战场区 + 右侧边栏 ───
export const mainContent = css`
  flex: 1 1 auto;
  display: flex;
  flex-direction: row;
  min-height: 0;
  overflow: hidden;
`;

// 战场区:座位环绕中央(处理区/牌堆/弃牌堆 + CenterTable 操作区)
export const battleField = css`
  flex: 1 1 auto;
  position: relative;
  /* 桌面氛围:中央暖金顶光 + 边缘冷暗收拢(vignette),替代单层平光 */
  background:
    radial-gradient(ellipse 62% 55% at 50% 44%, rgba(112, 86, 44, 0.22), transparent 68%),
    radial-gradient(ellipse 90% 80% at 50% 50%, transparent 55%, rgba(4, 5, 12, 0.55) 100%);
  min-width: 0;
  overflow: hidden;

  /* 四角金色角饰:细 L 线,低透明度,给空旷四角以「装裱」感 */
  &::before {
    content: '';
    position: absolute;
    inset: 10px 14px;
    pointer-events: none;
    --orn: rgba(206, 172, 92, 0.22);
    background:
      linear-gradient(var(--orn), var(--orn)) left 0 top 0 / 30px 1px,
      linear-gradient(var(--orn), var(--orn)) left 0 top 0 / 1px 30px,
      linear-gradient(var(--orn), var(--orn)) right 0 top 0 / 30px 1px,
      linear-gradient(var(--orn), var(--orn)) right 0 top 0 / 1px 30px,
      linear-gradient(var(--orn), var(--orn)) left 0 bottom 0 / 30px 1px,
      linear-gradient(var(--orn), var(--orn)) left 0 bottom 0 / 1px 30px,
      linear-gradient(var(--orn), var(--orn)) right 0 bottom 0 / 30px 1px,
      linear-gradient(var(--orn), var(--orn)) right 0 bottom 0 / 1px 30px;
    background-repeat: no-repeat;
  }
`;

/** 中央牌堆/处理区 + 出牌历史条(须高于 ActionOverlay 9998,否则被盖住) */
export const centerTable = css`
  position: absolute;
  top: 48%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10000;
  width: min(560px, 92%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  & > * {
    pointer-events: auto;
  }
`;

/** 牌桌中心装饰:低透明度同心圆纹样,营造「桌面」氛围并填补中央空旷感。
 *  纯装饰层:不拦截任何交互(pointer-events:none),z-index 低于 centerTable。
 *  层次(自上而下):中心微光 → 绸缎放射细纹 → 主金环 + 副细环。 */
export const battleFieldDecor = css`
  position: absolute;
  top: 48%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(500px, 62vw);
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(circle, rgba(241, 196, 15, 0.055) 0%, transparent 56%),
    repeating-conic-gradient(rgba(255, 228, 158, 0.014) 0deg 3deg, transparent 3deg 7.5deg),
    radial-gradient(circle, transparent 63.6%, rgba(241, 196, 15, 0.11) 64%, rgba(241, 196, 15, 0.11) 64.7%, transparent 65.1%),
    radial-gradient(circle, transparent 67.4%, rgba(241, 196, 15, 0.055) 67.8%, rgba(241, 196, 15, 0.055) 68.2%, transparent 68.6%);
  pointer-events: none;
  z-index: 0;
`;

/** CenterTable 内的牌堆/处理区信息(非绝对定位) */
export const centerZoneInfo = css`
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  max-width: 100%;
`;

/** 座位区底部操作坞:提示 / 倒计时 / 主按钮(贴 seatArcContainer 底边) */
export const seatBottomDock = css`
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  z-index: 6;
  width: min(560px, 92%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  & > * {
    pointer-events: auto;
  }
`;

// 右侧边栏:固定宽 250px,承载日志+聊天(InfoDock 内嵌于此而非浮窗)
export const rightSidebar = css`
  flex: 0 0 250px;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.6);
  border-left: 1px solid #534629;
  min-height: 0;
  overflow: hidden;
`;

// ─── 底部手牌区(固定高度):装备 | 手牌 | 我方武将 ───
export const bottomLayout = css`
  flex: 0 0 auto;
  /* content-box:height 即内容高度,= 大卡 stretch 高度(= --hero-card-h);padding 额外 */
  height: var(--hero-card-h);
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 8px 12px 10px;
  border-top: 1px solid #534629;
  background: rgba(0, 0, 0, 0.5);
  position: relative;
  overflow: hidden;
  @media (max-width: 900px) {
    height: auto;
    flex-direction: column;
    align-items: stretch;
  }
`;
export const handColumn = css`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: flex-end;
  height: 100%;
`;

/** 手牌区左侧阶段条(出牌/弃牌等) */
export const phaseStrip = css`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;
export const phaseStripBadge = css`
  background: #c0392b;
  color: #fff;
  font-size: 11px;
  font-weight: bold;
  padding: 3px 8px;
  border-radius: 2px 8px 8px 2px;
  letter-spacing: 1px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
`;
