// src/client/hooks/useMultiplayerRoom.ts
// 多人(普通房)单连接管理 hook。管理人类玩家自己座次的一个 HGC 实例。
// 与 useDebugMultiConnection 的区别:正式模式只连接玩家自己座次(1 个 WS),
// 座次在开局后由服务端按加入顺序分配,HGC 收到 initialView 时自动获取 view.viewer。
//
// 连接生命周期收敛到单一 command-driven effect:command 变化时创建 HGC+执行命令,
// cleanup 时 disconnect。StrictMode 安全(cleanup disconnect 后 effect 重跑完整重建)。
import { useState, useEffect, useRef, useCallback } from 'react';
import { HeadlessGameClient } from '../headless/HeadlessGameClient';
import type { ClientPhase, RoomState } from '../headless/types';
import type { GameView } from '../../engine/types';
import type { ServerMessage, RoomConfig } from '../../server/protocol';
import type { ActionMsg } from '../types';
import { createLogger } from '../utils/logger';

const log = createLogger('useMultiplayerRoom');

export type MultiplayerStage = 'lobby' | 'waiting' | 'playing' | 'ended';

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
  leaveRoom: () => void;
  sendAction: (action: ActionMsg) => void;
  reorderHand: (order: string[]) => void;
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

  // 初始命令:有 initialRoomId 则自动 join(分享链接直达)
  const [command, setCommand] = useState<Command>(() =>
    initialRoomId ? { type: 'autoJoin', roomId: initialRoomId } : { type: 'idle' },
  );

  const hgcRef = useRef<HeadlessGameClient | null>(null);

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

  const isHost = roomState?.hostId === playerId && playerId !== null;

  // ── 主连接 effect:command 变化时创建 HGC + 执行命令 + cleanup disconnect ──
  // StrictMode 安全:cleanup 断开后,StrictMode 重跑 effect 会完整重建。
  useEffect(() => {
    if (command.type === 'idle') {
      hgcRef.current = null;
      return;
    }

    const hgc = new HeadlessGameClient(wsUrl, {
      onView: (v) => {
        setView(v);
        if (v.viewer >= 0) setStage('playing');
      },
      onRoomState: (rs) => setRoomState(rs),
      onPhaseChange: (phase: ClientPhase) => {
        if (phase === 'playing') setStage('playing');
        if (phase === 'ended') setStage('ended');
      },
      onGameOver: (winner) => setGameOver({ winner }),
      onError: () => { /* 一期不重连 */ },
      onMessage: (msg: ServerMessage) => {
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
      try { hgc.disconnect(); } catch { /* */ }
      hgcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, wsUrl]);

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
    setCommand({ type: 'create', name: name || `房间${Math.random().toString(36).slice(2, 6).toUpperCase()}`, maxPlayers, config });
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

  return {
    stage, roomId, playerId, roomState, view, gameOver, error, isHost, ready,
    createRoom, joinRoom, toggleReady, startGame, leaveRoom, sendAction, reorderHand,
  };
}
