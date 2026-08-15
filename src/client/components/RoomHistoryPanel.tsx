// src/client/components/RoomHistoryPanel.tsx — 房间对局历史面板。
// 挂载在等待大厅:查看本房间历史对局结果,重放/下载录像;房主可删除单条或清空全部。
// 数据来自 GET /api/rooms/:id/history(useRoomHistory);重放拉取录像文件后
// 走 /replay 路由(与本地录像文件回放同一页面,state 传 ReplayFile)。

import { useState, useCallback } from 'react';
import { css, cx } from '@linaria/core';
import { useNavigate } from 'react-router-dom';
import { colors, btnStyle } from '../theme';
import { IDENTITY_COLORS } from './gameViewConstants';
import type { RoomHistory } from '../hooks/useRoomHistory';
import type { GameHistoryEntry } from '../../server/gameHistory';
import type { ReplayFile } from '../replay/types';

const panel = css`
  margin-top: 18px;
  border-top: 1px solid rgba(241, 196, 15, 0.14);
  padding-top: 14px;
`;

const headerRow = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
`;

const headerTitle = css`
  font-size: 15px;
  font-weight: bold;
  color: ${colors.accent.gold};
  cursor: pointer;
  user-select: none;
`;

const headerCount = css`
  font-size: 12px;
  color: ${colors.text.muted};
`;

const headerSpacer = css`
  flex: 1;
`;

const headerBtn = css`
  padding: 3px 10px;
  font-size: 12px;
`;

const list = css`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const item = css`
  background: ${colors.bg.input};
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 10px 12px;
`;

const itemTop = css`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const resultBadge = css`
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: bold;
  color: #000;
  white-space: nowrap;
`;

const itemMeta = css`
  font-size: 12px;
  color: ${colors.text.muted};
  white-space: nowrap;
`;

const itemOps = css`
  margin-left: auto;
  display: flex;
  gap: 6px;
`;

const playersRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
`;

const playerChip = css`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.06);
  color: ${colors.text.secondary};
`;

const emptyText = css`
  font-size: 13px;
  color: ${colors.text.muted};
  padding: 4px 0;
`;

const errorText = css`
  font-size: 12px;
  color: ${colors.accent.red};
  margin-bottom: 6px;
`;

/** 阵营文案 → 徽章色(与 GameResultOverlay 的胜方身份色语义一致) */
const WINNER_COLOR: Record<string, string> = {
  主公方: IDENTITY_COLORS['主公'] ?? '#FFD700',
  反贼: IDENTITY_COLORS['反贼'] ?? '#E74C3C',
  内奸: IDENTITY_COLORS['内奸'] ?? '#9B59B6',
};

/** MM-DD HH:mm */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 对局时长:X 分钟(超 1 小时显示 X 小时 Y 分) */
function formatDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} 分钟`;
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`;
}

interface RoomHistoryPanelProps {
  roomId: string | null;
  playerId: string | null;
  history: RoomHistory;
  /** 是否房主(房主才显示删除/清空) */
  isHost: boolean;
}

export function RoomHistoryPanel({ roomId, playerId, history, isHost }: RoomHistoryPanelProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(true);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  const handleReplay = useCallback(
    async (entryId: string) => {
      if (!roomId) return;
      setReplaying(entryId);
      setReplayError(null);
      try {
        const file = await fetch(`/api/rooms/${roomId}/history/${entryId}`);
        if (!file.ok) throw new Error(`HTTP ${file.status}`);
        const data = (await file.json()) as ReplayFile;
        navigate('/replay', { state: { file: data } });
      } catch {
        setReplayError('加载录像失败,该录像可能已被删除');
      } finally {
        setReplaying(null);
      }
    },
    [roomId, navigate],
  );

  const handleDownload = useCallback(
    (entryId: string) => {
      if (!roomId) return;
      window.open(`/api/rooms/${roomId}/history/${entryId}?download=1`, '_blank');
    },
    [roomId],
  );

  const handleDelete = useCallback(
    async (entryId: string) => {
      if (!window.confirm('确定删除这条对局记录吗?录像将一并删除。')) return;
      await history.deleteEntry(entryId);
    },
    [history],
  );

  const handleClear = useCallback(async () => {
    if (!window.confirm('确定清空全部对局历史吗?所有录像将一并删除。')) return;
    await history.clearAll();
  }, [history]);

  const { entries, loading, error } = history;

  return (
    <div className={panel}>
      <div className={headerRow}>
        <span className={headerTitle} onClick={() => setExpanded((v) => !v)}>
          {expanded ? '▾' : '▸'} 对局历史
        </span>
        <span className={headerCount}>
          {loading ? '加载中…' : entries.length > 0 ? `${entries.length} 局` : ''}
        </span>
        <span className={headerSpacer} />
        <button
          className={cx(btnStyle, headerBtn)}
          style={{ '--btn-bg': colors.bg.panel } as React.CSSProperties}
          onClick={() => void history.refresh()}
          title="刷新历史列表"
        >
          刷新
        </button>
        {isHost && entries.length > 0 && (
          <button
            className={cx(btnStyle, headerBtn)}
            style={{ '--btn-bg': colors.accent.darkRed } as React.CSSProperties}
            onClick={() => void handleClear()}
          >
            清空历史
          </button>
        )}
      </div>
      {error && <div className={errorText}>{error}</div>}
      {replayError && <div className={errorText}>{replayError}</div>}
      {expanded && (
        <div className={list}>
          {entries.length === 0 && !loading && <div className={emptyText}>暂无对局记录</div>}
          {entries.map((entry) => (
            <HistoryItem
              key={entry.id}
              entry={entry}
              playerId={playerId}
              isHost={isHost}
              replaying={replaying === entry.id}
              onReplay={() => void handleReplay(entry.id)}
              onDownload={() => handleDownload(entry.id)}
              onDelete={() => void handleDelete(entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryItem({
  entry,
  playerId,
  isHost,
  replaying,
  onReplay,
  onDownload,
  onDelete,
}: {
  entry: GameHistoryEntry;
  playerId: string | null;
  isHost: boolean;
  replaying: boolean;
  onReplay: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const winnerColor = WINNER_COLOR[entry.winnerLabel] ?? colors.text.muted;
  return (
    <div className={item}>
      <div className={itemTop}>
        <span
          className={resultBadge}
          style={{ backgroundColor: winnerColor, color: entry.winnerLabel === '主公方' ? '#000' : '#fff' }}
        >
          {entry.winnerLabel === '主公方' ? '主公方胜' : entry.winnerLabel === '平局' ? '平局' : entry.winnerLabel === '中断' ? '已中断' : `${entry.winnerLabel}胜`}
        </span>
        <span className={itemMeta}>{entry.gameMode}</span>
        <span className={itemMeta}>{formatTime(entry.endedAt)}</span>
        <span className={itemMeta}>{formatDuration(entry.endedAt - entry.startedAt)}</span>
        <div className={itemOps}>
          {entry.hasReplay && (
            <>
              <button
                className={cx(btnStyle, headerBtn)}
                style={{ '--btn-bg': colors.accent.blue } as React.CSSProperties}
                disabled={replaying}
                onClick={onReplay}
              >
                {replaying ? '加载中…' : '重放'}
              </button>
              <button
                className={cx(btnStyle, headerBtn)}
                style={{ '--btn-bg': colors.bg.panel } as React.CSSProperties}
                onClick={onDownload}
                title="下载录像文件"
              >
                下载
              </button>
            </>
          )}
          {isHost && (
            <button
              className={cx(btnStyle, headerBtn)}
              style={{ '--btn-bg': colors.accent.darkRed } as React.CSSProperties}
              onClick={onDelete}
              title="删除这条记录"
            >
              删除
            </button>
          )}
        </div>
      </div>
      <div className={playersRow}>
        {entry.players.map((p) => (
          <span
            key={p.seat}
            className={playerChip}
            style={{
              ...(p.playerId === playerId ? { outline: '1px solid rgba(241,196,15,0.6)' } : {}),
              ...(p.won === false ? { opacity: 0.55 } : {}),
            }}
            title={`${p.playerId.slice(0, 8)} · ${p.character || '未知'} · ${p.identity}${p.won === null ? '' : p.won ? ' · 胜' : ' · 负'}`}
          >
            <span style={{ color: IDENTITY_COLORS[p.identity] ?? colors.text.muted }}>
              {p.identity || '?'}
            </span>
            <span>{p.character || '未知'}</span>
            {p.won !== null && (
              <span style={{ color: p.won ? colors.accent.green : colors.text.muted }}>
                {p.won ? '胜' : '负'}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
