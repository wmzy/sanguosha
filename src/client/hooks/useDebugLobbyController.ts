// src/hooks/useDebugLobbyController.ts — 调试大厅控制器 hook
//
// 新 ENGINE-DESIGN: 服务器发 GameView,客户端发 ClientMessage。
// 不再用 SequencedEvent / reduceGameState / GameAction。

import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from './useWebSocket';
import { storeSession, loadSession, clearSession } from '../utils/debugSession';
import { apiFetch, ApiError } from '../api/client';
import type { GameView, Json } from '../../engine/types';
import type { ServerMessage, RoomInfo } from '../../server/protocol';

/** 客户端发的 action(不含 baseSeq) */
interface ActionMsg {
  skillId: string;
  actionType: string;
  ownerId: number;
  params: Record<string, Json>;
}

export interface DebugLobbyController {
  connected: boolean;
  view: GameView | null;
  playerNames: string[];
  debugRooms: RoomInfo[];
  error: string | null;
  playerCount: number;
  setPlayerCount: (n: number) => void;
  sendAction: (action: ActionMsg) => void;
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

  const [view, setView] = useState<GameView | null>(null);
  const [playerNames, setPlayerNames] = useState<string[]>([]);
  const [debugRooms, setDebugRooms] = useState<RoomInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playerCount, setPlayerCount] = useState(5);
  const lastSeqRef = useRef(0);
  const viewRef = useRef<GameView | null>(null);


  useEffect(() => {
    if (connected) send({ type: 'list_rooms', filter: 'debug' });
  }, [connected, send]);

  // 加入房间: connected 时 initialRoomId 变化也触发
  // disconnect 时重置 prevRoomRef,确保重连后重新 join
  const prevRoomRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!connected) { prevRoomRef.current = undefined; return; }
    if (!initialRoomId) return;
    if (prevRoomRef.current === initialRoomId) return;
    prevRoomRef.current = initialRoomId;

    const session = loadSession();
    if (session?.roomId === initialRoomId) {
      send({ type: 'reconnect', playerId: session.playerId, lastSeq: lastSeqRef.current });
    } else {
      send({ type: 'join_debug_room', roomId: initialRoomId, lastSeq: lastSeqRef.current });
    }
  }, [connected, initialRoomId, send]);

  useEffect(() => { viewRef.current = view; }, [view]);

  // 消息处理
  useEffect(() => {
    const unsubscribe = onMessage((msg: ServerMessage) => {
      if (msg.type === 'debugGameState') {
        lastSeqRef.current = msg.lastSeq;
        setView(msg.state);
        // 从 GameView 推导 playerNames(调试模式 server 不单独下发)
        // GameView 没有 name 字段,用 index 编号
        if (playerNames.length === 0 && msg.state.players.length > 0) {
          setPlayerNames(msg.state.players.map((_, i) => `P${i + 1}`));
        }
      } else if (msg.type === 'initialView') {
        lastSeqRef.current = msg.lastSeq;
        setView(msg.state);
      } else if (msg.type === 'room_list') {
        setDebugRooms(msg.rooms);
      } else if (msg.type === 'room_joined') {
        storeSession(msg.roomId, msg.playerId);
        window.history.replaceState(null, '', `/debug/${msg.roomId}`);
      } else if (msg.type === 'error') {
        if (initialRoomId && !viewRef.current) {
          clearSession();
          navigate('/debug', { replace: true });
        } else {
          setError(msg.message);
          setTimeout(() => setError(null), 3000);
        }
      }
    });
    return unsubscribe;
  }, [onMessage, initialRoomId, navigate, playerNames.length]);

  // 发送 action(自动加 baseSeq)
  const sendAction = useCallback(
    (action: ActionMsg) => {
      send({ type: 'action', action: { ...action, baseSeq: lastSeqRef.current }, baseSeq: lastSeqRef.current });
    },
    [send],
  );

  const refreshRoomList = useCallback(() => send({ type: 'list_rooms', filter: 'debug' }), [send]);

  const handleCreateDebugRoom = useCallback(async () => {
    try {
      const data = await apiFetch<{ roomId: string }>('/api/debug-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerCount }),
      });
      // navigate 在同 path 下可能不触发路由切换。
      // 用 window.location.href 强制刷新，确保新组件挂载 + useEffect join 触发。
      window.location.href = `/debug/${data.roomId}`;
    } catch (err) {
      if (err instanceof ApiError) {
        setError((err.body as { error?: string }).error ?? '创建失败');
      } else {
        setError('网络错误');
      }
      setTimeout(() => setError(null), 3000);
    }
  }, [playerCount, navigate, send]);

  const handleDeleteRoom = useCallback(() => {
    const session = loadSession();
    if (session?.roomId) {
      apiFetch<void>(`/api/rooms/${session.roomId}`, { method: 'DELETE' }).catch(() => {});
    }
    clearSession();
    lastSeqRef.current = 0;
    setView(null);
    setPlayerNames([]);
    navigate('/');
  }, [navigate]);

  const handleJoinDebugRoom = useCallback(
    (roomId: string) => {
      lastSeqRef.current = 0;
      setPlayerNames([]);
      send({ type: 'join_debug_room', roomId });
    },
    [send],
  );

  const handleDeleteDebugRoom = useCallback(
    (roomId: string) => {
      apiFetch<void>(`/api/rooms/${roomId}`, { method: 'DELETE' })
        .then(() => send({ type: 'list_rooms', filter: 'debug' }))
        .catch(() => {});
    },
    [send],
  );

  const handleExit = useCallback(() => {
    handleDeleteRoom();
    navigate('/');
  }, [handleDeleteRoom, navigate]);

  return {
    connected,
    view,
    playerNames,
    debugRooms,
    error,
    playerCount,
    setPlayerCount,
    sendAction,
    refreshRoomList,
    handleCreateDebugRoom,
    handleDeleteRoom,
    handleJoinDebugRoom,
    handleDeleteDebugRoom,
    handleExit,
  };
}
