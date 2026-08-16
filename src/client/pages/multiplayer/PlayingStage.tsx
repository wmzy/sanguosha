// src/client/pages/multiplayer/PlayingStage.tsx
// 对局分支(stage=playing 且已有 view):GameViewComponent 全量 props 挂载
// + 顶栏 headerSlot 的旁观视角申请审批入口 + 错误 toast。房间数据走 MultiplayerRoomCtx。
import { useNavigate } from 'react-router-dom';
import { GameViewComponent } from '../../components/GameView';
import { btnStyle, colors } from '../../theme';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';
import { ErrorToast } from './ErrorToast';
import { ReconnectBanner } from './ReconnectBanner';
import { gameWrap } from './multiplayerStyles';
import type { ActionMsg } from '../../types';

export function PlayingStage() {
  const mp = useMultiplayerRoomCtx();
  const navigate = useNavigate();
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
    <>
      <ReconnectBanner
        connectionState={mp.connectionState}
        reconnectAttempt={mp.reconnectAttempt}
        onCancel={mp.cancelReconnect}
        onLeave={() => {
          mp.leaveRoom();
          navigate('/');
        }}
      />
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
                <span
                  key={sid}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: colors.accent.gold, color: '#000',
                    padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold',
                  }}
                >
                  👁 {sid.slice(0, 8)} 申请查看你的视角
                  <button
                    className={btnStyle}
                    style={{ '--btn-bg': colors.accent.green, '--btn-padding': '2px 8px', '--btn-font-size': '11px' } as React.CSSProperties}
                    onClick={() => mp.approveView(sid, mySeat)}
                  >同意</button>
                  <button
                    className={btnStyle}
                    style={{ '--btn-bg': colors.accent.red, '--btn-padding': '2px 8px', '--btn-font-size': '11px' } as React.CSSProperties}
                    onClick={() => mp.rejectView(sid)}
                  >拒绝</button>
                </span>
              ))}
            </div>
          ) : undefined}
        />
        {/* 对局中操作被后端拒绝时的错误反馈(此前该分支静默无提示) */}
        {mp.error && <ErrorToast message={mp.error} onClose={mp.clearError} />}
      </div>
    </>
  );
}
