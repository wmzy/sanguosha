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
import type { RoomInfo } from '../../server/protocol';

export interface DebugLobbyController {
  /** 当前已加入的房间 ID(null = 未加入) */
  activeRoomId: string | null;
  debugRooms: RoomInfo[];
  error: string | null;
  playerCount: number;
  setPlayerCount: (n: number) => void;
  refreshRoomList: () => void;
  handleCreateDebugRoom: () => Promise<void>;
  handleDeleteRoom: () => void;
  handleJoinDebugRoom: (roomId: string) => void;
  handleDeleteDebugRoom: (roomId: string) => void;
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

  // initialRoomId:进入页面时自动加入指定房间
  const prevRoomRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialRoomId) return;
    if (prevRoomRef.current === initialRoomId) return;
    prevRoomRef.current = initialRoomId;
    setActiveRoomId(initialRoomId);
  }, [initialRoomId]);

  const refreshRoomList = useCallback(() => {
    void fetchRooms();
  }, [fetchRooms]);

  const handleCreateDebugRoom = useCallback(async () => {
    try {
      const data = await apiFetch<{ roomId: string }>('/api/debug-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerCount }),
      });
      storeSession(data.roomId, `debug-${data.roomId}-lobby`);
      window.history.replaceState(null, '', `/debug/${data.roomId}`);
      setActiveRoomId(data.roomId);
    } catch (err) {
      showErrorFor(err, '创建失败', setError);
    }
  }, [playerCount]);

  const handleDeleteRoom = useCallback(() => {
    if (!activeRoomId) return;
    apiFetch<void>(`/api/rooms/${activeRoomId}`, { method: 'DELETE' }).catch(() => {});
    clearSession();
    setActiveRoomId(null);
    navigate('/');
  }, [activeRoomId, navigate]);

  const handleJoinDebugRoom = useCallback((roomId: string) => {
    setActiveRoomId(roomId);
    window.history.replaceState(null, '', `/debug/${roomId}`);
  }, []);

  const handleDeleteDebugRoom = useCallback((roomId: string) => {
    apiFetch<void>(`/api/rooms/${roomId}`, { method: 'DELETE' })
      .then(() => fetchRooms())
      .catch((err) => showErrorFor(err, '删除失败', setError));
  }, [fetchRooms]);

  const handleExit = useCallback(() => {
    handleDeleteRoom();
  }, [handleDeleteRoom]);

  return {
    activeRoomId,
    debugRooms,
    error,
    playerCount,
    setPlayerCount,
    refreshRoomList,
    handleCreateDebugRoom,
    handleDeleteRoom,
    handleJoinDebugRoom,
    handleDeleteDebugRoom,
    handleExit,
  };
}
