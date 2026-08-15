// src/client/hooks/useRoomHistory.ts — 房间对局历史的加载/删除/清空/录像下载。
// 进入等待大厅时加载列表;房间状态变化(对局结束回到等待)时自动刷新。
// 删除/清空成功后本地同步移除,避免再发一次列表请求。
// downloadLatestReplay:录像下载统一走服务端导出(客户端本地录制已下线)。

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, ApiError } from '../api/client';
import { createLogger } from '../utils/logger';
import type { GameHistoryEntry } from '../../server/gameHistory';

const log = createLogger('useRoomHistory');

/**
 * 从服务端导出最新一局录像并触发浏览器下载(录像统一走服务端导出,客户端不再本地录制)。
 *
 * 游戏结束时服务端 appendGameHistory 是 fire-and-forget 落盘,列表可能短暂为空:
 * 最多 retries 次轮询(间隔 intervalMs)。取 entries[0](时间降序,最新在前),
 * 用 anchor 指向 `?download=1` 下载端点触发浏览器下载(Content-Disposition 由服务端设置)。
 *
 * 返回 true=已触发下载;false=列表持续为空(调用方提示「录像生成中,请稍后再试」)。
 */
export async function downloadLatestReplay(
  roomId: string,
  opts: { retries?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const { retries = 5, intervalMs = 500 } = opts;
  for (let attempt = 0; attempt < retries; attempt++) {
    const r = await apiFetch<{ entries: GameHistoryEntry[] }>(
      `/api/rooms/${roomId}/history`,
    );
    const latest = r.entries[0];
    if (latest) {
      const a = document.createElement('a');
      a.href = `/api/rooms/${roomId}/history/${latest.id}?download=1`;
      a.click();
      return true;
    }
    if (attempt < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

export interface RoomHistory {
  entries: GameHistoryEntry[];
  loading: boolean;
  /** 最近一次操作的错误提示(删除/清空失败等) */
  error: string | null;
  refresh: () => Promise<void>;
  deleteEntry: (entryId: string) => Promise<boolean>;
  clearAll: () => Promise<boolean>;
}

export function useRoomHistory(
  roomId: string | null,
  playerId: string | null,
  /** 刷新键:值变化时重新加载(页面传 gameOver/stage 组合——对局结束、回到等待时刷新) */
  refreshKey?: string,
): RoomHistory {
  const [entries, setEntries] = useState<GameHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 防止 refresh 竞态:后到的响应覆盖先到的(roomId 切换场景) */
  const loadSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!roomId) {
      setEntries([]);
      return;
    }
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const r = await apiFetch<{ entries: GameHistoryEntry[] }>(
        `/api/rooms/${roomId}/history`,
      );
      if (loadSeqRef.current !== seq) return;
      setEntries(r.entries);
      setError(null);
    } catch (err) {
      if (loadSeqRef.current !== seq) return;
      const msg = err instanceof ApiError ? String(err.body ?? '加载失败') : '加载对局历史失败';
      log.error('加载对局历史失败', { roomId, error: String(err) });
      setError(msg);
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [roomId]);

  // 进入房间时加载 + 刷新键变化时重载(新一局结束 → gameOver/stage 变化)
  useEffect(() => {
    void refresh();
    // 对局结束瞬间 appendGameHistory 可能尚未落盘(服务端 fire-and-forget 写),
    // 延迟补一次刷新兜底竞态
    const t = setTimeout(() => void refresh(), 600);
    return () => clearTimeout(t);
  }, [refresh, refreshKey]);

  const deleteEntry = useCallback(
    async (entryId: string) => {
      if (!roomId || !playerId) return false;
      try {
        await apiFetch<void>(`/api/rooms/${roomId}/history/${entryId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId }),
        });
        setEntries((prev) => prev.filter((e) => e.id !== entryId));
        return true;
      } catch (err) {
        const body = (err as { body?: { error?: string } }).body;
        setError(body?.error ?? '删除历史失败');
        log.error('删除历史失败', { roomId, entryId, error: String(err) });
        return false;
      }
    },
    [roomId, playerId],
  );

  const clearAll = useCallback(async () => {
    if (!roomId || !playerId) return false;
    try {
      await apiFetch<void>(`/api/rooms/${roomId}/history`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
      setEntries([]);
      return true;
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      setError(body?.error ?? '清空历史失败');
      log.error('清空历史失败', { roomId, error: String(err) });
      return false;
    }
  }, [roomId, playerId]);

  return { entries, loading, error, refresh, deleteEntry, clearAll };
}
