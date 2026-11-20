// src/client/pages/multiplayer/StageScaffold.tsx
// 舞台脚手架:收敛各 stage 重复的「重连横幅 + 错误 toast + 离房回大厅」接线。
// - useLeaveAndNavigate(独立文件):leaveRoom() + navigate('/'),重连横幅「返回大厅」与各处退出按钮共用。
// - StageErrorToast:mp.error 的条件错误 toast,摆放位置由调用处决定(lobby 无横幅也直接用)。
// - StageScaffold:ReconnectBanner + 舞台内容 + 尾部错误 toast;errorToast 用 prop 控制是否
//   渲染(EndedStage 无 view 分支保持原状不渲染),extraToasts 渲染在错误 toast 之后
//   (EndedStage 的「录像生成中」静态提示,保持原有 DOM 顺序)。
import type { ReactNode } from 'react';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';
import { ErrorToast } from './ErrorToast';
import { ReconnectBanner } from './ReconnectBanner';
import { useLeaveAndNavigate } from './useLeaveAndNavigate';

/** mp.error 的错误 toast:有错误时渲染(点击可关闭),无错误渲染 null。 */
export function StageErrorToast() {
  const mp = useMultiplayerRoomCtx();
  return mp.error ? <ErrorToast message={mp.error} onClose={mp.clearError} /> : null;
}

interface StageScaffoldProps {
  children: ReactNode;
  /** 是否渲染 mp.error 的错误 toast(默认 true;EndedStage 无 view 分支传 false 保持原状) */
  errorToast?: boolean;
  /** 渲染在错误 toast 之后的额外静态 toast(EndedStage 的「录像生成中」提示) */
  extraToasts?: ReactNode;
}

/** 舞台脚手架:顶部重连横幅 + 舞台内容 + 尾部错误 toast。 */
export function StageScaffold({ children, errorToast = true, extraToasts }: StageScaffoldProps) {
  const mp = useMultiplayerRoomCtx();
  const onLeave = useLeaveAndNavigate();
  return (
    <>
      <ReconnectBanner
        connectionState={mp.connectionState}
        reconnectAttempt={mp.reconnectAttempt}
        onCancel={mp.cancelReconnect}
        onLeave={onLeave}
      />
      {children}
      {errorToast && <StageErrorToast />}
      {extraToasts}
    </>
  );
}
