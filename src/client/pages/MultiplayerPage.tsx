// src/client/pages/MultiplayerPage.tsx
// 多人游戏入口页(瘦编排):创建/加入房间 → 等待大厅 → 对局 → 结算。
// 本页只负责 hooks(useMultiplayerRoom/useRoomHistory/战报事件累计)、URL 同步、
// 404 分支与 stage 分发;各阶段 JSX 在 ./multiplayer/ 下的 Stage 子组件中,
// mp 经 MultiplayerRoomCtx 下发,重连横幅与错误 toast 由各 Stage 自行渲染。
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMultiplayerRoom } from '../hooks/useMultiplayerRoom';
import { useRoomHistory } from '../hooks/useRoomHistory';
import { useBattleStatsEvents } from '../utils/battleStats';
import { btnStyle, colors } from '../theme';
import { MultiplayerRoomProvider } from './multiplayer/MultiplayerRoomCtx';
import { LobbyStage } from './multiplayer/LobbyStage';
import { WaitingStage } from './multiplayer/WaitingStage';
import { SpectatingStage } from './multiplayer/SpectatingStage';
import { PlayingStage } from './multiplayer/PlayingStage';
import { EndedStage } from './multiplayer/EndedStage';
import { buttonRow, notFoundPage, notFoundCode, notFoundTitle, notFoundDesc, notFoundRoomId } from './multiplayer/multiplayerStyles';

export function MultiplayerPage() {
  const navigate = useNavigate();
  const { roomId: urlRoomId } = useParams<{ roomId?: string }>();
  const mp = useMultiplayerRoom(urlRoomId);
  // 对局历史:等待大厅展示;对局结束(gameOver)/回到等待(stage)时刷新
  const history = useRoomHistory(
    mp.roomId,
    mp.playerId,
    mp.gameOver ? 'over' : mp.stage,
  );

  // ── 战报统计(伤害/承伤/击杀/回合数)──
  // mp.ingestedEvents 是 ~80 条滑动窗口,结算时一次性统计会丢早期事件;
  // 这里按 seq 增量累计本局的战报相关事件(见 utils/battleStats.ts),
  // 对局中/旁观/结算阶段启用,game_reset 回 waiting 后自动清空。
  const battleEvents = useBattleStatsEvents(
    mp.ingestedEvents,
    mp.stage === 'playing' || mp.stage === 'spectating' || mp.stage === 'ended',
  );

  // 房间码进入 URL:建房/加入后同步到 /play/:roomId,便于分享直达
  useEffect(() => {
    if (mp.roomId && mp.roomId !== urlRoomId) {
      navigate(`/play/${mp.roomId}`, { replace: true });
    }
  }, [mp.roomId, urlRoomId, navigate]);

  // 房间不存在(URL 直达不存在的 roomId):显示 404 页面
  if (mp.notFound) {
    return (
      <div className={notFoundPage}>
        <div className={notFoundCode}>404</div>
        <div className={notFoundTitle}>房间不存在</div>
        <p className={notFoundDesc}>
          房间码 <span className={notFoundRoomId}>{urlRoomId}</span> 对应的房间可能已被关闭或从未创建。
        </p>
        <div className={buttonRow}>
          <button
            className={btnStyle}
            style={{ '--btn-bg': colors.accent.orange } as React.CSSProperties}
            onClick={() => {
              mp.leaveRoom();
              navigate('/play');
            }}
          >
            进入大厅
          </button>
          <button
            className={btnStyle}
            style={{ '--btn-bg': colors.disabled } as React.CSSProperties}
            onClick={() => navigate('/')}
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  // stage 分发(分支顺序与拆分前一致):
  // 旁观对局 → 对局 → 结算 → 等待大厅(玩家/旁观共用) → lobby。
  return (
    <MultiplayerRoomProvider value={mp}>
      {mp.stage === 'spectating' && mp.view ? (
        <SpectatingStage />
      ) : mp.stage === 'playing' && mp.view ? (
        <PlayingStage />
      ) : mp.stage === 'ended' || mp.gameOver ? (
        <EndedStage battleEvents={battleEvents} />
      ) : mp.stage === 'waiting' || mp.stage === 'spectating' ? (
        <WaitingStage history={history} />
      ) : (
        <LobbyStage />
      )}
    </MultiplayerRoomProvider>
  );
}
