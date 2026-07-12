// src/client/hooks/useMultiplayerRoom.ts
// 多人(普通房)单连接管理 hook。管理人类玩家自己座次的一个 HGC 实例。
// 与 useDebugMultiConnection 的区别:正式模式只连接玩家自己座次(1 个 WS),
// 座次在开局后由服务端按加入顺序分配,HGC 收到 initialView 时自动获取 view.viewer。
//
// 连接生命周期收敛到单一 command-driven effect:command 变化时创建 HGC+执行命令,
// cleanup 时 disconnect。StrictMode 安全(cleanup disconnect 后 effect 重跑完整重建)。
import { useState, useEffect, useRef, useCallback } from 'react';
import { HeadlessGameClient } from '../headless/HeadlessGameClient';
import type { ClientPhase, RoomState, ReconnectState } from '../headless/types';
import type { GameView } from '../../engine/types';
import type { ServerMessage, RoomConfig } from '../../server/protocol';
import type { ActionMsg } from '../types';
import { createLogger } from '../utils/logger';
import { ReplayRecorder } from '../replay/recorder';
import type { ReplayMeta } from '../replay/types';

const log = createLogger('useMultiplayerRoom');

export type MultiplayerStage = 'lobby' | 'waiting' | 'playing' | 'ended';

/** 连接状态(供 UI 显示连接/重连提示)。 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'failed';

/** 连接命令:驱动主 effect 建立/重建 HGC 连接。 */
type Command =
  | { type: 'idle' }
  | { type: 'autoJoin'; roomId: string }
  | { type: 'create'; name: string; maxPlayers: number; config?: RoomConfig }
  | { type: 'join'; roomId: string };

export interface MultiplayerRoom {
  stage: MultiplayerStage;
  roomId: string | null;
  playerId: string | null;
  roomState: RoomState | null;
  view: GameView | null;
  gameOver: { winner: string } | null;
  error: string | null;
  /** 是否房主 */
  isHost: boolean;
  /** 本人是否已准备 */
  ready: boolean;
  createRoom: (name: string, maxPlayers: number, config?: RoomConfig) => void;
  joinRoom: (roomId: string) => void;
  toggleReady: () => void;
  startGame: () => void;
  /** 游戏结束后再来一局:重置房间回「配置+准备」阶段(复用同一连接)。 */
  sendRestart: () => void;
  leaveRoom: () => void;
  sendAction: (action: ActionMsg) => void;
  reorderHand: (order: string[]) => void;
  /** 当前连接状态(供 UI 显示连接/重连提示) */
  connectionState: ConnectionState;
  /** 当前重连尝试次数(0=未在重连) */
  reconnectAttempt: number;
  /** 手动取消重连 */
  cancelReconnect: () => void;
  /** 录像录制器 */
  recorder: {
    finalize: (meta: ReplayMeta) => import('../replay/types').ReplayFile;
    hasData: () => boolean;
  };
}

export function useMultiplayerRoom(initialRoomId?: string): MultiplayerRoom {
  const [stage, setStage] = useState<MultiplayerStage>('lobby');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [gameOver, setGameOver] = useState<{ winner: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // 初始命令:有 initialRoomId 则自动 join(分享链接直达)
  const [command, setCommand] = useState<Command>(() =>
    initialRoomId ? { type: 'autoJoin', roomId: initialRoomId } : { type: 'idle' },
  );

  const hgcRef = useRef<HeadlessGameClient | null>(null);
  const recorderRef = useRef<ReplayRecorder>(new ReplayRecorder());

  const serverUrl = window.location.origin;

  const isHost = roomState?.hostId === playerId && playerId !== null;

  // ── 主连接 effect:command 变化时创建 HGC + 执行命令 + cleanup disconnect ──
  // StrictMode 安全:cleanup 断开后,StrictMode 重跑 effect 会完整重建。
  useEffect(() => {
    if (command.type === 'idle') {
      hgcRef.current = null;
      return;
    }

    const hgc = new HeadlessGameClient(serverUrl, {
      onView: (v, newEvents) => {
        // 录制:单座次事件流
        recorderRef.current.record(v.viewer, v, newEvents);
        setView(v);
        if (v.viewer >= 0) setStage('playing');
      },
      onRoomState: (rs) => setRoomState(rs),
      onPhaseChange: (phase: ClientPhase) => {
        if (phase === 'lobby') setConnectionState('connected');
        if (phase === 'playing') setStage('playing');
        if (phase === 'ended') setStage('ended');
      },
      onGameOver: (winner) => setGameOver({ winner }),
      onError: () => {
        /* WS error 已由 onclose → 重连机制覆盖 */
      },
      onReconnectStateChange: (state: ReconnectState, attempt: number) => {
        setReconnectAttempt(attempt);
        if (state === 'idle') setConnectionState('connected');
        else if (state === 'reconnecting') setConnectionState('reconnecting');
        else if (state === 'failed') setConnectionState('failed');
      },
      onMessage: (msg: ServerMessage) => {
        // 再来一局:服务端 resetToLobby 广播 game_reset,清除结算界面回到准备阶段。
        // HGC 内部已重置 view/gameOverWinner,这里同步 React state(roomId/playerId 保留)。
        if (msg.type === 'game_reset') {
          setGameOver(null);
          setView(null);
          setReady(false);
          setStage('waiting');
          recorderRef.current.reset();
        }
        if (msg.type === 'error') {
          setError(msg.message);
          setTimeout(() => setError(null), 3000);
        }
      },
    });
    hgcRef.current = hgc;

    // 按命令执行(连接命令在 HGC 内部排队,open 后 flush)
    if (command.type === 'create') {
      hgc.createRoom(command.name, command.maxPlayers, command.config);
      setStage('waiting');
    } else if (command.type === 'join' || command.type === 'autoJoin') {
      hgc.joinRoom(command.roomId);
      setStage('waiting');
    }

    return () => {
      try {
        hgc.disconnect();
      } catch {
        /* */
      }
      hgcRef.current = null;
    };
  }, [command, serverUrl]);

  // 从 HGC getter 同步 roomId/playerId(收到 room_joined 后更新,无独立回调)
  useEffect(() => {
    if (stage !== 'waiting' && stage !== 'playing') return;
    const hgc = hgcRef.current;
    if (!hgc) return;
    const id = setInterval(() => {
      if (hgc.roomId && hgc.roomId !== roomId) setRoomId(hgc.roomId);
      if (hgc.playerId && hgc.playerId !== playerId) setPlayerId(hgc.playerId);
    }, 200);
    return () => clearInterval(id);
  }, [stage, roomId, playerId]);

  const createRoom = useCallback((name: string, maxPlayers: number, config?: RoomConfig) => {
    setError(null);
    setGameOver(null);
    setView(null);
    setReady(false);
    setRoomState(null);
    setCommand({
      type: 'create',
      name: name || `房间${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      maxPlayers,
      config,
    });
    log.info('createRoom', { name, maxPlayers });
  }, []);

  const joinRoom = useCallback((targetRoomId: string) => {
    setError(null);
    setGameOver(null);
    setView(null);
    setReady(false);
    setRoomState(null);
    setCommand({ type: 'join', roomId: targetRoomId });
    log.info('joinRoom', { roomId: targetRoomId });
  }, []);

  const toggleReady = useCallback(() => {
    const hgc = hgcRef.current;
    if (!hgc) return;
    hgc.sendReady();
    setReady(true);
  }, []);

  const startGame = useCallback(() => {
    const hgc = hgcRef.current;
    if (!hgc) return;
    hgc.sendStartGame();
    log.info('startGame');
  }, []);

  const sendRestart = useCallback(() => {
    const hgc = hgcRef.current;
    if (!hgc) return;
    hgc.sendRestart();
    log.info('sendRestart');
  }, []);

  const leaveRoom = useCallback(() => {
    setCommand({ type: 'idle' });
    setStage('lobby');
    setRoomId(null);
    setRoomState(null);
    setView(null);
    setGameOver(null);
    setReady(false);
    setPlayerId(null);
  }, []);

  const sendAction = useCallback((action: ActionMsg) => {
    const hgc = hgcRef.current;
    if (!hgc) return;
    // HGC.sendAction 内部用 lastSeq 覆盖 baseSeq/pendingSeq，此处 baseSeq:0 仅占位
    hgc.sendAction({ ...action, ownerId: hgc.seatIndex, baseSeq: 0 });
  }, []);

  const reorderHand = useCallback((order: string[]) => {
    const hgc = hgcRef.current;
    if (!hgc) return;
    hgc.reorderHand(order);
  }, []);

  const cancelReconnect = useCallback(() => {
    hgcRef.current?.cancelReconnect();
  }, []);

  return {
    stage,
    roomId,
    playerId,
    roomState,
    view,
    gameOver,
    error,
    isHost,
    ready,
    createRoom,
    joinRoom,
    toggleReady,
    startGame,
    sendRestart,
    leaveRoom,
    sendAction,
    reorderHand,
    connectionState,
    reconnectAttempt,
    cancelReconnect,
    recorder: {
      finalize: (meta) => recorderRef.current.finalize(meta),
      hasData: () => recorderRef.current.hasData(),
    },
  };
}
