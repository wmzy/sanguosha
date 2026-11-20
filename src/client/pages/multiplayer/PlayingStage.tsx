// src/client/pages/multiplayer/PlayingStage.tsx
// 对局分支(stage=playing 且已有 view):GameViewComponent 全量 props 挂载
// + 顶栏 headerSlot 的旁观视角申请审批入口 + 错误 toast。房间数据走 MultiplayerRoomCtx。
import { memberName } from '../../utils/memberNames';
import { GameViewComponent } from '../../components/GameView';
import { colors } from '../../theme';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';
import { StageScaffold } from './StageScaffold';
import { ViewRequestChip } from './ViewRequestChip';
import { gameWrap } from './multiplayerStyles';
import type { ActionMsg } from '../../types';

export function PlayingStage() {
  const mp = useMultiplayerRoomCtx();
  // 页面 stage 分发已保证仅在 playing 且有 view 时挂载本组件;此守卫仅为类型收窄
  if (!mp.view) return null;

  // 当前玩家座次(用于游戏进行中显示针对自己的旁观申请)
  const mySeat = mp.roomState ? (mp.roomState.seats ?? []).indexOf(mp.playerId ?? '') : -1;
  const pendingRequests = mp.roomState?.pendingViewRequests ?? {};
  // 针对当前玩家座次的旁观申请,游戏进行中在顶栏显示审批入口
  const myViewRequests = mySeat >= 0
    ? Object.entries(pendingRequests).filter(([, seat]) => seat === mySeat)
    : [];

  const handleAction = (action: ActionMsg) => mp.sendAction(action);

  return (
    <StageScaffold>
      <div className={gameWrap}>
        <GameViewComponent
          view={mp.view}
          onAction={handleAction}
          onReorderHand={mp.reorderHand}
          currentEvent={mp.currentEvent}
          ingestedEvents={mp.ingestedEvents}
          pendingCount={mp.pendingCount}
          onSkipEvents={mp.skipEvents}
          chatMessages={mp.chatMessages}
          chatConfig={mp.roomState?.config?.chat}
          onSendChat={mp.sendChat}
          disconnectedSeats={mp.disconnectedSeats}
          headerSlot={myViewRequests.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {myViewRequests.map(([sid]) => (
                <ViewRequestChip
                  key={sid}
                  spectatorId={sid}
                  seat={mySeat}
                  label={<>👁 {memberName(sid, mp.roomState?.playerNames)} 申请查看你的视角</>}
                  wrapStyle={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: colors.accent.gold, color: '#000', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' }}
                  btnPadding="2px 8px"
                  btnFontSize="11px"
                />
              ))}
            </div>
          ) : undefined}
        />
      </div>
    </StageScaffold>
  );
}
