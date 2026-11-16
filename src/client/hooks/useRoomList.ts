// src/client/hooks/useRoomList.ts
// 房间列表共享 hook:拉取 /api/rooms?type=…、删除房间(DELETE /api/rooms/:id)后刷新。
// 多人大厅(multiplayer,5s 轮询 + 静默 console.warn)与调试大厅(debug,仅挂载拉取 +
// 错误横幅)共用;轮询节奏与失败处理差异全部经 options 参数表达。

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { RoomInfo } from '../../server/protocol';

export type RoomListType = 'debug' | 'multiplayer';

/** 失败回调:'fetch' = 拉列表失败,'delete' = 删房间失败;err 原样透传 */
export type RoomListErrorHandler = (operation: 'fetch' | 'delete', err: unknown) => void;

export interface UseRoomListOptions {
  /** 失败处理;缺省静默——仅 ApiError 打 console.warn,不打扰用户主流程 */
  onError?: RoomListErrorHandler;
  /** 自动刷新间隔 ms;0(缺省)= 仅挂载时拉取一次 */
  pollIntervalMs?: number;
}

/** 静默缺省(lobby 语义):非 ApiError 完全吞掉 */
function silentWarn(operation: 'fetch' | 'delete', err: unknown): void {
  if (err instanceof ApiError) {
    console.warn(operation === 'fetch' ? '获取房间列表失败' : '删除房间失败', err.status, err.body);
  }
}

export function useRoomList(type: RoomListType, options?: UseRoomListOptions) {
  const { onError = silentWarn, pollIntervalMs = 0 } = options ?? {};
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  // 最新回调 ref:调用方内联传 onError 不改变 fetchRooms 身份,不会触发重复拉取/重建轮询
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fetchRooms = useCallback(async () => {
    try {
      const list = await apiFetch<RoomInfo[]>(`/api/rooms?type=${type}`);
      setRooms(list);
    } catch (err) {
      onErrorRef.current('fetch', err);
    }
  }, [type]);

  // 挂载即拉取;pollIntervalMs > 0 时按间隔自动刷新
  useEffect(() => {
    void fetchRooms();
    if (pollIntervalMs <= 0) return;
    const timer = setInterval(() => void fetchRooms(), pollIntervalMs);
    return () => clearInterval(timer);
  }, [fetchRooms, pollIntervalMs]);

  /** 手动刷新(RoomListPanel「刷新列表」按钮) */
  const refresh = useCallback(() => {
    void fetchRooms();
  }, [fetchRooms]);

  /** 删除房间并刷新列表 */
  const removeRoom = useCallback(
    (roomId: string) => {
      apiFetch<void>(`/api/rooms/${roomId}`, { method: 'DELETE' })
        .then(() => fetchRooms())
        .catch((err: unknown) => {
          onErrorRef.current('delete', err);
        });
    },
    [fetchRooms],
  );

  return { rooms, refresh, removeRoom };
}
