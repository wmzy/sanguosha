// src/client/hooks/useDebugLobbyController.ts
// 调试大厅控制器 hook — 管理房间列表/创建/删除(非游戏内逻辑)。
//
// 游戏内逻辑(view/action/多 WS 连接)由 useDebugMultiConnection 处理。
// 本 hook 只负责:房间列表刷新、创建 debug 房、删除房间、错误提示。
// 已加入房间后,DebugLobby 用 useDebugMultiConnection 管理游戏连接。

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from './useWebSocket';
import { storeSession, loadSession, clearSession } from '../utils/debugSession';
import { apiFetch, ApiError } from '../api/client';
import type { ServerMessage, RoomInfo } from '../../server/protocol';

export interface DebugLobbyController {
  /** 控制用 WS 连接(房间列表/创建,非游戏连接) */
  connected: boolean;
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

export function useDebugLobbyController(initialRoomId?: string): DebugLobbyController {
  const navigate = useNavigate();
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected, send, onMessage } = useWebSocket(wsUrl);

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [debugRooms, setDebugRooms] = useState<RoomInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playerCount, setPlayerCount] = useState(5);

  useEffect(() => {
    if (connected) send({ type: 'list_rooms', filter: 'debug' });
  }, [connected, send]);

  // initialRoomId:进入页面时自动加入指定房间
  const prevRoomRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!connected) { prevRoomRef.current = undefined; return; }
    if (!initialRoomId) return;
    if (prevRoomRef.current === initialRoomId) return;
    prevRoomRef.current = initialRoomId;
    setActiveRoomId(initialRoomId);
  }, [connected, initialRoomId]);

  // 消息处理:只处理房间列表/错误(游戏消息由多连接 hook 处理)
  useEffect(() => {
    const unsubscribe = onMessage((msg: ServerMessage) => {
      if (msg.type === 'room_list') {
        setDebugRooms(msg.rooms);
      } else if (msg.type === 'error') {
        setError(msg.message);
        setTimeout(() => setError(null), 3000);
      }
    });
    return unsubscribe;
  }, [onMessage]);

  const refreshRoomList = useCallback(() => send({ type: 'list_rooms', filter: 'debug' }), [send]);

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
      if (err instanceof ApiError) {
        setError((err.body as { error?: string }).error ?? '创建失败');
      } else {
        setError('网络错误');
      }
      setTimeout(() => setError(null), 3000);
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
      .then(() => send({ type: 'list_rooms', filter: 'debug' }))
      .catch(() => {});
  }, [send]);

  const handleExit = useCallback(() => {
    handleDeleteRoom();
  }, [handleDeleteRoom]);

  return {
    connected,
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
