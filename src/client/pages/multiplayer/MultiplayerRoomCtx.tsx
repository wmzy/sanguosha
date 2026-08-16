// src/client/pages/multiplayer/MultiplayerRoomCtx.tsx
// 多人房间上下文:把 useMultiplayerRoom() 的完整返回值 mp 下发给各 stage 子组件,
// 消除 MultiplayerPage → Stage 的重复 prop 透传。
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { MultiplayerRoom } from '../../hooks/useMultiplayerRoom';

const MultiplayerRoomContext = createContext<MultiplayerRoom | null>(null);

/** 以 mp(= useMultiplayerRoom() 返回值)供给子树。 */
export function MultiplayerRoomProvider({
  value,
  children,
}: {
  value: MultiplayerRoom;
  children: ReactNode;
}) {
  return <MultiplayerRoomContext.Provider value={value}>{children}</MultiplayerRoomContext.Provider>;
}

/** 取当前多人房间上下文;必须在 <MultiplayerRoomProvider> 内使用。 */
export function useMultiplayerRoomCtx(): MultiplayerRoom {
  const mp = useContext(MultiplayerRoomContext);
  if (!mp) {
    throw new Error('useMultiplayerRoomCtx 必须在 <MultiplayerRoomProvider> 内使用');
  }
  return mp;
}
