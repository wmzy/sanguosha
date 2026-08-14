// src/client/hooks/useDebugLobbyController.ts
// 调试大厅控制器 hook — 管理房间列表/创建/删除(非游戏内逻辑)。
//
// 游戏内逻辑(view/action/多 WS 连接)由 useDebugMultiConnection 处理。
// 本 hook 只负责:房间列表刷新(REST)、创建 debug 房(REST)、删除房间(REST)、错误提示。
// 已加入房间后,DebugLobby 用 useDebugMultiConnection 管理游戏连接。

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { storeSession, clearSession } from '../utils/debugSession';
import { apiFetch, ApiError } from '../api/client';
import { isRoomNotFound } from '../utils/roomErrors';
import type { RoomInfo } from '../../server/protocol';

export interface DebugLobbyController {
  /** 当前已加入的房间 ID(null = 未加入) */
  activeRoomId: string | null;
  debugRooms: RoomInfo[];
  error: string | null;
  /** 创建房间请求进行中(POST /api/debug-room 期间为 true,防重复提交) */
  isCreating: boolean;
  playerCount: number;
  setPlayerCount: (n: number) => void;
  refreshRoomList: () => void;
  handleCreateDebugRoom: () => Promise<void>;
  handleDeleteRoom: () => void;
  handleJoinDebugRoom: (roomId: string) => void;
  handleDeleteDebugRoom: (roomId: string) => void;
  /** 房间连接失败(如房间已被服务端回收,join 404):清理会话回调试大厅并提示。 */
  handleRoomGone: (err?: unknown) => void;
  handleExit: () => void;
}

function showErrorFor(err: unknown, fallback: string, setter: (s: string | null) => void) {
  if (err instanceof ApiError) {
    setter((err.body as { error?: string }).error ?? fallback);
  } else {
    setter(fallback);
  }
  setTimeout(() => setter(null), 3000);
}

export function useDebugLobbyController(initialRoomId?: string): DebugLobbyController {
  const navigate = useNavigate();

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [debugRooms, setDebugRooms] = useState<RoomInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playerCount, setPlayerCount] = useState(5);
  const [isCreating, setIsCreating] = useState(false);

  const fetchRooms = useCallback(async () => {
    try {
      const rooms = await apiFetch<RoomInfo[]>('/api/rooms?type=debug');
      setDebugRooms(rooms);
    } catch (err) {
      showErrorFor(err, '获取房间列表失败', setError);
    }
  }, []);

  // 初始加载房间列表
  useEffect(() => {
    void fetchRooms();
  }, [fetchRooms]);

  // initialRoomId:从 URL 进入时自动加入指定房间,并从房间信息恢复 playerCount。
  // 刷新后 playerCount 会重置为默认值(5),若实际房间是 3 人,会创建错误数量的连接。
  const prevRoomRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialRoomId) return;
    if (prevRoomRef.current === initialRoomId) return;
    prevRoomRef.current = initialRoomId;

    // 从房间信息恢复 playerCount(用 maxPlayers,即游戏人数)
    void apiFetch<{ maxPlayers: number }>(`/api/rooms/${initialRoomId}`)
      .then((info) => {
        setPlayerCount(info.maxPlayers);
        storeSession(initialRoomId, `debug-${initialRoomId}-url`);
        setActiveRoomId(initialRoomId);
      })
      .catch(() => {
        // 房间不存在或会话已结束:回退到调试大厅列表
        navigate('/debug', { replace: true });
      });
  }, [initialRoomId, navigate]);

  const refreshRoomList = useCallback(() => {
    void fetchRooms();
  }, [fetchRooms]);

  const handleCreateDebugRoom = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const data = await apiFetch<{ roomId: string }>('/api/debug-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerCount }),
      });
      storeSession(data.roomId, `debug-${data.roomId}-lobby`);
      navigate(`/debug/${data.roomId}`, { replace: true });
      setActiveRoomId(data.roomId);
    } catch (err) {
      showErrorFor(err, '创建失败', setError);
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, playerCount, navigate]);

  /** 房间连接失败(房间被服务端回收/关闭,join 404):
   *  清理 debugSession、退出房间状态并回调试大厅,同时给出错误提示,
   *  避免 UI 永远卡在「0/N 已连接」且无任何反馈。 */
  const handleRoomGone = useCallback(
    (err?: unknown) => {
      const message =
        err == null || isRoomNotFound(err)
          ? '房间已不存在或已关闭'
          : err instanceof Error
            ? err.message
            : String(err);
      clearSession();
      // 重置 URL 自动加入的去重标记,允许用户再次进入同一路径
      prevRoomRef.current = undefined;
      setActiveRoomId(null);
      setError(message);
      setTimeout(() => setError(null), 3000);
      navigate('/debug', { replace: true });
    },
    [navigate],
  );

  const handleDeleteRoom = useCallback(() => {
    if (!activeRoomId) return;
    apiFetch<void>(`/api/rooms/${activeRoomId}`, { method: 'DELETE' }).catch(() => {});
    clearSession();
    setActiveRoomId(null);
    navigate('/');
  }, [activeRoomId, navigate]);

  const handleJoinDebugRoom = useCallback((roomId: string) => {
    setActiveRoomId(roomId);
    navigate(`/debug/${roomId}`, { replace: true });
  }, [navigate]);

  const handleDeleteDebugRoom = useCallback(
    (roomId: string) => {
      apiFetch<void>(`/api/rooms/${roomId}`, { method: 'DELETE' })
        .then(() => fetchRooms())
        .catch((err) => showErrorFor(err, '删除失败', setError));
    },
    [fetchRooms],
  );

  const handleExit = useCallback(() => {
    handleDeleteRoom();
  }, [handleDeleteRoom]);

  return {
    activeRoomId,
    debugRooms,
    error,
    isCreating,
    playerCount,
    setPlayerCount,
    refreshRoomList,
    handleCreateDebugRoom,
    handleDeleteRoom,
    handleJoinDebugRoom,
    handleDeleteDebugRoom,
    handleRoomGone,
    handleExit,
  };
}
