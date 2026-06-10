// src/hooks/useDebugLobbyController.ts — 调试大厅控制器 hook
//
// 新 ENGINE-DESIGN: 服务器发 GameView,客户端发 ClientMessage。
// 不再用 SequencedEvent / reduceGameState / GameAction。

import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from './useWebSocket';
import { storeSession, loadSession, clearSession } from '../utils/debugSession';
import { apiFetch, ApiError } from '../api/client';
import type { GameView, ClientMessage as EngineClientMessage } from '../../engine/types';
import type { ServerMessage, RoomInfo } from '../../server/protocol';

export interface DebugLobbyController {
  connected: boolean;
  view: GameView | null;
  playerNames: string[];
  debugRooms: RoomInfo[];
  error: string | null;
  playerCount: number;
  setPlayerCount: (n: number) => void;
  sendAction: (action: EngineClientMessage) => void;
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
  const { connected, send, onMessage, connect } = useWebSocket(wsUrl);

  const [view, setView] = useState<GameView | null>(null);
  const [playerNames, setPlayerNames] = useState<string[]>([]);
  const [debugRooms, setDebugRooms] = useState<RoomInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playerCount, setPlayerCount] = useState(5);
  const lastSeqRef = useRef(0);
  const viewRef = useRef<GameView | null>(null);

  useEffect(() => { connect(); }, [connect]);

  useEffect(() => {
    if (connected) send({ type: 'list_rooms', filter: 'debug' });
  }, [connected, send]);

  // 自动重连
  const lastConnectedRef = useRef(false);
  useEffect(() => {
    const becameConnected = connected && !lastConnectedRef.current;
    lastConnectedRef.current = connected;
    if (!becameConnected || !initialRoomId) return;

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

  // 发送 action
  const sendAction = useCallback(
    (action: EngineClientMessage) => {
      send({ type: 'action', action, baseSeq: lastSeqRef.current });
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
      navigate(`/debug/${data.roomId}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError((err.body as { error?: string }).error ?? '创建失败');
      } else {
        setError('网络错误');
      }
      setTimeout(() => setError(null), 3000);
    }
  }, [playerCount, navigate]);

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
