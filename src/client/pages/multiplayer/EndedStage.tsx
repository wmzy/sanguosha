// src/client/pages/multiplayer/EndedStage.tsx
// 结算分支(stage=ended 或 gameOver):有 view 时走 GameResultOverlay 富结算面板
// (战报由页面累计的 battleEvents 汇总为 stats 传入);无 view 回退简洁 gameOverBox 文案。
// 持有录像下载反馈 replayPending 与 handleDownloadReplay。房间数据走 MultiplayerRoomCtx。
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameResultOverlay } from '../../components/GameResultOverlay';
import { downloadLatestReplay } from '../../hooks/useRoomHistory';
import { summarizeBattleStats, useBattleStatsEvents } from '../../utils/battleStats';
import { btnStyle, colors } from '../../theme';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';
import { ErrorToast } from './ErrorToast';
import { ReconnectBanner } from './ReconnectBanner';
import { page, title, gameOverBox, winnerText, buttonRow } from './multiplayerStyles';

interface EndedStageProps {
  /** 本局累计的战报相关事件(页面 useBattleStatsEvents 产出,结算时汇总为战报) */
  battleEvents: ReturnType<typeof useBattleStatsEvents>;
}

export function EndedStage({ battleEvents }: EndedStageProps) {
  const mp = useMultiplayerRoomCtx();
  const navigate = useNavigate();

  // 录像生成中提示:服务端 appendGameHistory 落盘前列表为空时显示,3 秒自动消失
  const [replayPending, setReplayPending] = useState(false);
  useEffect(() => {
    if (!replayPending) return;
    const t = setTimeout(() => setReplayPending(false), 3000);
    return () => clearTimeout(t);
  }, [replayPending]);

  // 录像下载统一走服务端导出:取房间最新一条对局历史触发浏览器下载。
  // 按钮仅对局结束后可用(录像由服务端组装,不再依赖本地录制数据)。
  const handleDownloadReplay = useCallback(async () => {
    if (!mp.gameOver || !mp.roomId) return;
    const ok = await downloadLatestReplay(mp.roomId);
    if (!ok) setReplayPending(true);
  }, [mp.gameOver, mp.roomId]);

  const winner = mp.gameOver?.winner ?? '无人';
  // view 存在时用丰富的结算面板;缺失时回退到简洁文案。
  if (mp.view) {
    // 战报统计:仅结算阶段计算,从本局累计的战报事件汇总(无相关事件则传 undefined,列不渲染)
    const statsAll = summarizeBattleStats(battleEvents);
    const stats = Object.keys(statsAll).length > 0 ? statsAll : undefined;
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
        <GameResultOverlay
          winner={winner}
          players={mp.view.players}
          perspectiveIdx={mp.view.viewer}
          stats={stats}
          onRestart={mp.sendRestart}
          onExit={() => {
            mp.leaveRoom();
            navigate('/');
          }}
          onDownloadReplay={mp.gameOver ? handleDownloadReplay : undefined}
        />
        {/* 结算面板阶段的错误反馈,与其他 stage 分支行为一致 */}
        {mp.error && <ErrorToast message={mp.error} onClose={mp.clearError} />}
        {replayPending && <ErrorToast message="录像生成中，请稍后再试" />}
      </>
    );
  }
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
      <div className={page}>
        <h1 className={title}>游戏结束</h1>
        <div className={gameOverBox}>
          <p className={winnerText}>
            {winner === '无人' ? '平局' : `胜方：${winner}`}
          </p>
          <div className={buttonRow}>
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.green } as React.CSSProperties}
              onClick={mp.sendRestart}
            >
              再来一局
            </button>
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.blue } as React.CSSProperties}
              onClick={() => {
                mp.leaveRoom();
                navigate('/');
              }}
            >
              返回大厅
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
