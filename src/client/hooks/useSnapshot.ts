// src/client/hooks/useSnapshot.ts
// Debug 快照 hook:封装 POST 创建快照 + PATCH 追加描述。
// 不触碰 WS 连接、不调 sendAction、不改游戏渲染状态树——只读旁路。
import { useState, useCallback } from 'react';
import type { GameView } from '../../engine/types';
import { collectTelemetry } from '../utils/debugTelemetry';

export interface UseSnapshotResult {
  /** 是否正在保存中(POST 进行中,按钮应禁用) */
  saving: boolean;
  /** 错误信息(有则 toast 显示) */
  error: string | null;
  /** 已保存的 snapshotId(成功后用于 PATCH 描述) */
  lastSnapshotId: string | null;
  /** 已保存的文件路径(成功后显示给用户) */
  lastSnapshotPath: string | null;
  /** 创建快照:收集各座次 view/seq + perspective,POST 到后端 */
  createSnapshot: (params: {
    roomId: string;
    perspective: number;
    views: Map<number, GameView>;
    getSeqForView: (seat: number) => number;
  }) => Promise<string | null>;
  /** 追加描述到最近一次快照 */
  patchDescription: (snapshotId: string, description: string) => Promise<boolean>;
  /** 清除错误 */
  clearError: () => void;
}

export function useSnapshot(): UseSnapshotResult {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  const [lastSnapshotPath, setLastSnapshotPath] = useState<string | null>(null);

  const createSnapshot = useCallback(
    async (params: {
      roomId: string;
      perspective: number;
      views: Map<number, GameView>;
      getSeqForView: (seat: number) => number;
    }): Promise<string | null> => {
      setSaving(true);
      setError(null);
      try {
        const frontendSeqs: Record<string, number> = {};
        const frontendViews: Record<string, GameView> = {};
        for (const [seat, view] of params.views) {
          frontendSeqs[String(seat)] = params.getSeqForView(seat);
          frontendViews[String(seat)] = view;
        }
        const resp = await fetch('/api/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: params.roomId,
            perspective: params.perspective,
            frontendSeqs,
            frontendViews,
            telemetry: collectTelemetry(),
          }),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.error ?? `保存失败 (${resp.status})`);
        }
        const data = (await resp.json()) as { snapshotId: string };
        setLastSnapshotId(data.snapshotId);
        setLastSnapshotPath(`data/snapshots/${data.snapshotId}/`);
        return data.snapshotId;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const patchDescription = useCallback(
    async (snapshotId: string, description: string): Promise<boolean> => {
      setError(null);
      try {
        const resp = await fetch(`/api/snapshot/${snapshotId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description }),
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.error ?? `描述保存失败 (${resp.status})`);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    saving,
    error,
    lastSnapshotId,
    lastSnapshotPath,
    createSnapshot,
    patchDescription,
    clearError,
  };
}
