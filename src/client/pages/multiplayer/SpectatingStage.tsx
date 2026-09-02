// src/client/pages/multiplayer/SpectatingStage.tsx
// 旁观对局分支(stage=spectating 且已有 view):旁观控制条(已授权提示/申请查看下拉/退出)
// + GameViewComponent 只读挂载 + 错误 toast。房间数据走 MultiplayerRoomCtx。
import { useNavigate } from 'react-router-dom';
import { memberName } from '../../utils/memberNames';
import { GameViewComponent } from '../../components/GameView';
import { btnStyle, inputStyle, colors } from '../../theme';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';
import { ErrorToast } from './ErrorToast';
import { ReconnectBanner } from './ReconnectBanner';
import { gameWrap } from './multiplayerStyles';

export function SpectatingStage() {
  const mp = useMultiplayerRoomCtx();
  const navigate = useNavigate();
  // 页面 stage 分发已保证仅在 spectating 且有 view 时挂载本组件;此守卫仅为类型收窄
  if (!mp.view) return null;
  // 旁观者申请查看某玩家视角的下拉
  const viewGrants = mp.roomState?.viewGrants ?? {};
  const myGrant = mp.playerId ? viewGrants[mp.playerId] : undefined;
  // 构建玩家名称列表（座次序号 → playerId）
  const playerIds = mp.roomState?.playerIds ?? [];
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
      <div
        className={gameWrap}
        style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}
      >
        {/* 旁观者控制条 */}
        <div style={{ padding: '8px 16px', background: colors.bg.panel, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ color: colors.accent.gold, fontWeight: 'bold' }}>👁 旁观中</span>
          <span style={{ color: colors.text.muted, fontSize: '13px' }}>
            {myGrant !== undefined ? `已授权查看 P${myGrant} 视角` : '公开视图'}
          </span>
          {/* 申请查看下拉 */}
          {myGrant === undefined && (
            <>
              <select
                className={inputStyle}
                style={{ width: 'auto', fontSize: '13px' }}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value && mp.playerId) {
                    // 只发送申请，不直接切换
                    const seat = Number(e.target.value);
                    mp.requestView(seat);
                    e.target.value = '';
                  }
                }}
              >
                <option value="" disabled>申请查看视角…</option>
                {playerIds.map((pid, i) => (
                  <option key={pid} value={i}>P{i} {memberName(pid, mp.roomState?.playerNames)}</option>
                ))}
              </select>
            </>
          )}
          <button
            className={btnStyle}
            style={{ '--btn-bg': colors.disabled, '--btn-padding': '4px 12px', '--btn-font-size': '12px' } as React.CSSProperties}
            onClick={() => {
              mp.leaveRoom();
              navigate('/');
            }}
          >
            退出
          </button>
        </div>
        {/* 玩家视角的审批提示（仅当该玩家也在页面上时可见——但旁观者只看自己，所以审批由 playing 阶段处理） */}
        <GameViewComponent
          view={mp.view}
          onAction={() => {}}
          onReorderHand={() => {}}
          fit="fill"
          currentEvent={mp.currentEvent}
          ingestedEvents={mp.ingestedEvents}
          pendingCount={mp.pendingCount}
          onSkipEvents={mp.skipEvents}
          disconnectedSeats={mp.disconnectedSeats}
        />
        {/* 对局中操作被后端拒绝时的错误反馈(此前该分支静默无提示) */}
        {mp.error && <ErrorToast message={mp.error} onClose={mp.clearError} />}
      </div>
    </>
  );
}
