// src/client/pages/multiplayer/useLeaveAndNavigate.ts
// 从 StageScaffold.tsx 抽出,供组件文件遵守 react-refresh/only-export-components 规则。
/** 离开房间并返回首页:重连横幅「返回大厅」与各 stage 退出按钮的统一动作。 */
import { useNavigate } from 'react-router-dom';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';

export function useLeaveAndNavigate(): () => void {
  const mp = useMultiplayerRoomCtx();
  const navigate = useNavigate();
  return () => {
    mp.leaveRoom();
    void navigate('/');
  };
}
