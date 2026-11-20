// src/client/pages/multiplayer/ViewRequestChip.tsx
// 旁观视角申请的「同意/拒绝」审批小组件:approveView/rejectView 按钮对接线收敛于此。
// 两处消费语境不同——等待大厅(信息条内嵌按钮,靠 marginLeft 间距)与对局顶栏
// (金色胶囊,容器 gap 承担间距)——文案(label)、包装(wrapStyle)与按钮尺寸、
// 左距均由调用处传入,渲染结构逐字对齐两处原实现。
import type { CSSProperties, ReactNode } from 'react';
import { btnStyle, colors } from '../../theme';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';
import { btnVars } from './multiplayerStyles';

interface ViewRequestChipProps {
  /** 申请者(旁观者)id */
  spectatorId: string;
  /** 同意时授权查看的座次 */
  seat: number;
  /** 申请文案(含申请者名;两处语境不同) */
  label: ReactNode;
  /** 外层包装样式(等待大厅:输入底信息条;对局顶栏:金色胶囊) */
  wrapStyle: CSSProperties;
  /** 同意/拒绝按钮 padding(等待大厅 4px 12px / 顶栏 2px 8px) */
  btnPadding: string;
  /** 同意/拒绝按钮字号(等待大厅 12px / 顶栏 11px) */
  btnFontSize: string;
  /** 同意按钮左距(顶栏由容器 gap:4 承担,不传) */
  firstBtnMarginLeft?: string;
  /** 拒绝按钮左距(顶栏由容器 gap:4 承担,不传) */
  secondBtnMarginLeft?: string;
}

export function ViewRequestChip({
  spectatorId,
  seat,
  label,
  wrapStyle,
  btnPadding,
  btnFontSize,
  firstBtnMarginLeft,
  secondBtnMarginLeft,
}: ViewRequestChipProps) {
  const mp = useMultiplayerRoomCtx();
  return (
    <div style={wrapStyle}>
      {label}
      <button
        className={btnStyle}
        style={{ ...btnVars(colors.accent.green, { padding: btnPadding, fontSize: btnFontSize }), marginLeft: firstBtnMarginLeft }}
        onClick={() => mp.approveView(spectatorId, seat)}
      >同意</button>
      <button
        className={btnStyle}
        style={{ ...btnVars(colors.accent.red, { padding: btnPadding, fontSize: btnFontSize }), marginLeft: secondBtnMarginLeft }}
        onClick={() => mp.rejectView(spectatorId)}
      >拒绝</button>
    </div>
  );
}
