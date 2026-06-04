// src/hooks/useDebugLobbyController.ts — 调试大厅控制器 hook
//
// T10 拆分：把 DebugLobby 中的所有"非视图"逻辑（WebSocket 生命周期 +
// 消息分发 + 事件 handler + perspective 跟随 + 业务 state reducer）
// 收拢到一个 hook 中。父组件只负责调用 hook + 路由到子组件视图。
//
// 返回值：
//   - connected       : WebSocket 连接状态
//   - state           : 业务游戏状态（GameState | null）
//   - ui              : UI 状态聚合（见 useDebugRoom）
//   - setters         : UI 状态 setter 集合
//   - sendGameAction  : 把 GameAction 包装成 ws 消息发出
//   - handlers        : 各种点击 handler 集合

import { useEffect, useReducer, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from './useWebSocket';
import { useDebugRoom, type DebugUiState } from './useDebugRoom';
import { rotatePlayers } from '../utils/rotatePlayers';
import { getSingleActivePlayer } from '../utils/activePlayer';
import { storeSession, loadSession, clearSession } from '../utils/debugSession';
import { apiFetch, ApiError } from '../api/client';
import { reduceGameState } from '../../engine/view/reducer';
import type { GameAction, GameState, ServerEvent } from '../../engine/types';
import type { SequencedEvent, ServerMessage } from '../../server/protocol';

type DebugAction =
  | { type: 'reset'; state: GameState; lastAppliedSeq: number }
  | { type: 'applyEvents'; events: SequencedEvent[]; lastSeq: number };

function debugReducer(state: GameState | null, action: DebugAction): GameState | null {
  if (action.type === 'reset') return action.state;
  if (action.type === 'applyEvents') {
    if (!state || action.events.length === 0) return state;
    const bare: ServerEvent[] = action.events.map(({ seq: _seq, ...rest }) => rest);
    return reduceGameState(state, bare);
  }
  return state;
}

export interface DebugLobbyController {
  connected: boolean;
  state: GameState | null;
  ui: DebugUiState;
  setPlayerCount: (n: number) => void;
  setPerspective: (p: string) => void;
  setPlayerOrder: (order: string[]) => void;
  setSelectedCardId: (id: string | null) => void;
  setSelectedTarget: (t: string | null) => void;
  toggleSelectedForDiscard: (id: string) => void;
  clearSelectedForDiscard: () => void;
  toggleSelectedSkillCard: (id: string) => void;
  clearSelectedSkillCards: () => void;
  sendGameAction: (action: GameAction) => void;
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
  const wsUrl = useMemo(() => `${wsProtocol}//${window.location.host}/ws`, [wsProtocol]);
  const { connected, send, onMessage, connect } = useWebSocket(wsUrl);

  const [state, dispatch] = useReducer(debugReducer, null as GameState | null);
  const stateRef = useRef<GameState | null>(null);
  const lastAppliedSeqRef = useRef(0);

  const {
    ui,
    setPlayerCount,
    setError,
    setDebugRooms,
    setActionLog,
    appendAction,
    setPerspective,
    setPlayerOrder,
    setSelectedCardId,
    setSelectedTarget,
    toggleSelectedForDiscard,
    clearSelectedForDiscard,
    toggleSelectedSkillCard,
    clearSelectedSkillCards,
    reset,
  } = useDebugRoom();

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (connected) send({ type: 'list_rooms', filter: 'debug' });
  }, [connected, send]);

  const lastConnectedRef = useRef(false);
  useEffect(() => {
    const becameConnected = connected && !lastConnectedRef.current;
    lastConnectedRef.current = connected;
    if (!becameConnected || !initialRoomId) return;

    const session = loadSession();
    if (session?.roomId === initialRoomId) {
      send({ type: 'reconnect', playerId: session.playerId, lastSeq: lastAppliedSeqRef.current });
    } else {
      send({ type: 'join_debug_room', roomId: initialRoomId, lastSeq: lastAppliedSeqRef.current });
    }
  }, [connected, initialRoomId, send]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const unsubscribe = onMessage((msg: ServerMessage) => {
      if (msg.type === 'debugGameState') {
        lastAppliedSeqRef.current = msg.lastSeq;
        dispatch({ type: 'reset', state: msg.state, lastAppliedSeq: msg.lastSeq });
        setActionLog([{ action: { type: 'startGame' }, clientSeq: 1 }]);
        if (!ui.perspective && msg.state.currentPlayer) {
          setPerspective(msg.state.currentPlayer);
          setPlayerOrder(rotatePlayers(msg.state.playerOrder, msg.state.currentPlayer));
        }
      } else if (msg.type === 'events') {
        const fresh: SequencedEvent[] = msg.events.filter((e) => e.seq > lastAppliedSeqRef.current);
        if (fresh.length === 0) return;
        const maxSeq = fresh[fresh.length - 1].seq;
        lastAppliedSeqRef.current = maxSeq;
        dispatch({ type: 'applyEvents', events: fresh, lastSeq: maxSeq });
      } else if (msg.type === 'room_list') {
        setDebugRooms(msg.rooms);
      } else if (msg.type === 'room_joined') {
        storeSession(msg.roomId, msg.playerId);
        window.history.replaceState(null, '', `/debug/${msg.roomId}`);
      } else if (msg.type === 'error') {
        if (initialRoomId && !stateRef.current) {
          clearSession();
          navigate('/debug', { replace: true });
        } else {
          setError(msg.message);
          setTimeout(() => setError(null), 3000);
        }
      }
    });
    return unsubscribe;
  }, [
    onMessage,
    ui.perspective,
    initialRoomId,
    navigate,
    setActionLog,
    setDebugRooms,
    setError,
    setPerspective,
    setPlayerOrder,
  ]);

  useEffect(() => {
    if (!state) return;
    const active = getSingleActivePlayer(state);
    if (active && active !== ui.perspective) {
      setPerspective(active);
      setPlayerOrder(rotatePlayers(state.playerOrder, active));
    }
  }, [state, ui.perspective, setPerspective, setPlayerOrder]);

  const sendGameAction = useCallback(
    (action: GameAction) => {
      appendAction(action);
      send({ type: 'action', action });
    },
    [appendAction, send],
  );

  const refreshRoomList = useCallback(() => send({ type: 'list_rooms', filter: 'debug' }), [send]);

  const handleCreateDebugRoom = useCallback(async () => {
    try {
      const data = await apiFetch<{ roomId: string }>('/api/debug-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerCount: ui.playerCount }),
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
  }, [ui.playerCount, navigate, setError]);

  const handleDeleteRoom = useCallback(() => {
    const session = loadSession();
    if (session?.roomId) {
      apiFetch<void>(`/api/rooms/${session.roomId}`, { method: 'DELETE' }).catch(() => {});
    }
    clearSession();
    lastAppliedSeqRef.current = 0;
    reset();
    navigate('/');
  }, [reset, navigate]);

  const handleJoinDebugRoom = useCallback(
    (roomId: string) => {
      lastAppliedSeqRef.current = 0;
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
    state,
    ui,
    setPlayerCount,
    setPerspective,
    setPlayerOrder,
    setSelectedCardId,
    setSelectedTarget,
    toggleSelectedForDiscard,
    clearSelectedForDiscard,
    toggleSelectedSkillCard,
    clearSelectedSkillCards,
    sendGameAction,
    refreshRoomList,
    handleCreateDebugRoom,
    handleDeleteRoom,
    handleJoinDebugRoom,
    handleDeleteDebugRoom,
    handleExit,
  };
}
