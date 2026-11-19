// src/client/components/pillStyles.ts
// 全站「幽灵药丸」按钮体系的共享基类与色相变体。
// 此前同一套描边/999px 圆角/极淡底/#cfcabb 文字/金边 hover 样式在
// gameViewStyles/layout.ts(顶栏按钮)、RoomListPanel(房间操作按钮)、
// LobbyStage(表单主按钮)手抄多份,现收敛至单一出处;尺寸(色相/padding/字号)差异
// 仍由各使用处的本地类叠加。
//
// 组合约定(wyw-in-js 下 css`` 内插值其他 css 类不会内联其属性,见 multiplayerStyles 头注):
// - 以「基类字符串拼接 + 本地类」组合使用,如 `${ghostPill} ${mySize}`;
// - 样式表按模块依赖序输出:本模块先于使用方求值,使用方的本地类(如覆盖 color/line-height)
//   声明在后、按样式表顺序生效(同 multiplayerStyles.reconnectFailedOverlay 的顺序约定)。
import { css } from '@linaria/core';

/** 药丸形状基类:1px 实线描边(色由「面」变体定)+ 999px 圆角 + 指针 + 统一过渡。
 *  供幽灵面与 lobby 实心主按钮等不同「面」复用同一形状语言。 */
export const pillShape = css`
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s;
`;

/** 幽灵药丸中性面:白描边/极淡底/#cfcabb 文字,hover 转金边金底金字;含禁用态。
 *  不单独导出使用,只用于拼出 ghostPill。 */
const ghostPillFace = css`
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.03);
  color: #cfcabb;
  line-height: 1.5;
  &:hover {
    border-color: rgba(217, 180, 92, 0.65);
    color: #ecd9a8;
    background: rgba(217, 180, 92, 0.08);
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

/** 中性幽灵药丸(默认):形状基类 + 中性面;padding/字号/white-space 由使用处叠加 */
export const ghostPill = `${pillShape} ${ghostPillFace}`;

/** 金色变体(主操作:加入/进入):金边金字金底,hover 加亮(文字色沿用基类 hover 的 #ecd9a8) */
export const ghostPillGold = css`
  border-color: rgba(217, 180, 92, 0.55);
  color: #ecd9a8;
  background: rgba(217, 180, 92, 0.1);
  &:hover {
    border-color: rgba(240, 205, 120, 0.85);
    background: rgba(217, 180, 92, 0.18);
  }
`;

/** 蓝色变体(旁观/视角类):蓝边蓝字蓝底,hover 加亮并提亮文字 */
export const ghostPillBlue = css`
  border-color: rgba(82, 150, 220, 0.55);
  color: #7db8e8;
  background: rgba(52, 120, 200, 0.12);
  &:hover {
    border-color: rgba(120, 180, 240, 0.8);
    color: #a5ccf0;
    background: rgba(52, 120, 200, 0.22);
  }
`;

/** 红色变体(删除/危险):红边红字红底,hover 加亮并提亮文字 */
export const ghostPillRed = css`
  border-color: rgba(231, 76, 60, 0.5);
  color: #e89a8d;
  background: rgba(231, 76, 60, 0.1);
  &:hover {
    border-color: rgba(240, 120, 100, 0.75);
    color: #f4b8ad;
    background: rgba(231, 76, 60, 0.2);
  }
`;
