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
import type { ChatMessage } from '../headless/types';
import { createLogger } from '../utils/logger';
import { ReplayRecorder } from '../replay/recorder';
import type { ReplayMeta } from '../replay/types';
import { apiFetch } from '../api/client';
import { getPlayerId } from '../utils/playerIdentity';

const log = createLogger('useMultiplayerRoom');

export type MultiplayerStage = 'lobby' | 'waiting' | 'playing' | 'ended' | 'spectating';

/** 连接状态(供 UI 显示连接/重连提示)。 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'failed';

/** 连接命令:驱动主 effect 建立/重建 HGC 连接。 */
type Command =
  | { type: 'idle' }
  | { type: 'autoJoin'; roomId: string }
  | { type: 'create'; name: string; maxPlayers: number; config?: RoomConfig; roomType?: 'normal' | 'quick' }
  | { type: 'join'; roomId: string }
  | { type: 'spectate'; roomId: string };

export interface MultiplayerRoom {
  stage: MultiplayerStage;
  roomId: string | null;
  playerId: string | null;
  roomState: RoomState | null;
  view: GameView | null;
  gameOver: { winner: string } | null;
  error: string | null;
  /** 房间不存在(URL 直达不存在的 roomId) */
  notFound: boolean;
  /** 是否房主 */
  isHost: boolean;
  /** 是否为旁观者 */
  isSpectator: boolean;
  /** 本人是否已准备 */
  ready: boolean;
  createRoom: (name: string, maxPlayers: number, config?: RoomConfig, roomType?: 'normal' | 'quick') => void;
  joinRoom: (roomId: string) => void;
  joinAsSpectator: (roomId: string) => void;
  toggleReady: () => void;
  startGame: () => void;
  /** 游戏结束后再来一局:重置房间回「配置+准备」阶段(复用同一连接)。 */
  sendRestart: () => void;
  leaveRoom: () => void;
  sendAction: (action: ActionMsg) => void;
  reorderHand: (order: string[]) => void;
  /** 切换身份（等待中） */
  switchRole: (role: 'player' | 'spectator') => void;
  /** 旁观者申请查看指定座次 */
  requestView: (targetSeat: number) => void;
  /** 玩家审批通过 */
  approveView: (spectatorId: string, targetSeat: number) => void;
  /** 玩家拒绝申请 */
  rejectView: (spectatorId: string) => void;
  /** 玩家撤销已授权 */
  revokeView: (spectatorId: string) => void;
  /** 移动到空座位（仅等待中） */
  moveSeat: (targetSeat: number) => void;
  /** 请求与目标座位的玩家交换座位 */
  requestSeatSwap: (targetSeat: number) => void;
  /** 响应座位交换请求 */
  respondSeatSwap: (requesterId: string, accept: boolean) => void;
  /** 当前收到的座位交换请求 (收到的请求者 id 和目标座次) */
  incomingSeatSwap: { requesterId: string; requesterSeat: number; targetSeat: number; expiresAt: number } | null;
  /** 聊天消息列表 */
  chatMessages: ChatMessage[];
  /** 发送聊天消息 */
  sendChat: (text: string) => void;
  /** 更新房间配置（房主） */
  updateConfig: (config: RoomConfig, maxPlayers?: number) => void;
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
  // 门禁已确保身份设置;大厅阶段也需 playerId 供「我的」tab 过滤。
  const [playerId, setPlayerId] = useState<string | null>(getPlayerId());
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [gameOver, setGameOver] = useState<{ winner: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 房间不存在(URL 直达 /play/:roomId 但房间已销毁) */
  const [notFound, setNotFound] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  /** 收到的座位交换请求 */
  const [incomingSeatSwap, setIncomingSeatSwap] = useState<
    { requesterId: string; requesterSeat: number; targetSeat: number; expiresAt: number } | null
  >(null);

  // 初始命令:有 initialRoomId 则自动 join(分享链接直达)
  const [command, setCommand] = useState<Command>(() =>
    initialRoomId ? { type: 'autoJoin', roomId: initialRoomId } : { type: 'idle' },
  );

  const hgcRef = useRef<HeadlessGameClient | null>(null);
  const recorderRef = useRef<ReplayRecorder>(new ReplayRecorder());

  const serverUrl = window.location.origin;

  const isHost = roomState?.hostId === playerId && playerId !== null;
  const isSpectator = stage === 'spectating';
  // ready 从服务端 room_state 派生，而非本地状态。这样服务端 reset 后自动同步。
  const ready = !!playerId && !!(roomState?.readyPlayers.includes(playerId));

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
        // 旁观者始终留在 spectating stage，不因 viewer>=0 跳转
        if (v.viewer >= 0 && !hgc.isSpectator) setStage('playing');
      },
      onRoomState: (rs) => setRoomState(rs),
      onPhaseChange: (phase: ClientPhase) => {
        if (phase === 'lobby') setConnectionState('connected');
        if (phase === 'playing' && !hgc.isSpectator) setStage('playing');
        if (phase === 'ended' && !hgc.isSpectator) setStage('ended');
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
      onChat: (messages: ChatMessage[]) => {
        setChatMessages((prev) => {
          // chat_history 是批量全量替换,chat 是增量追加
          // 根据消息数量判断：如果收到的是单条,则追加；如果超过1条且第一条时间戳早于已有消息,说明是历史全量
          if (messages.length === 1) {
            return [...prev, ...messages];
          }
          return messages;
        });
      },
      onMessage: (msg: ServerMessage) => {
        // 再来一局:服务端 resetToLobby 广播 game_reset,清除结算界面回到准备阶段。
        // HGC 内部已重置 view/gameOverWinner,这里同步 React state(roomId/playerId 保留)。
        if (msg.type === 'game_started') {
          // 每局游戏是独立的聊天会话:开局时清空上一局的消息
          setChatMessages([]);
        }
        if (msg.type === 'game_reset') {
          setGameOver(null);
          setView(null);
          
          setStage('waiting');
          setChatMessages([]);
          recorderRef.current.reset();
        }
        if (msg.type === 'error') {
          setError(msg.message);
          setTimeout(() => setError(null), 3000);
        }
        // 座位交换请求：仅当目标是当前玩家时显示通知
        if (msg.type === 'seat_swap_request' && msg.targetPlayerId === hgc.playerId) {
          setIncomingSeatSwap({
            requesterId: msg.requesterId,
            requesterSeat: msg.requesterSeat,
            targetSeat: msg.targetSeat,
            expiresAt: msg.expiresAt,
          });
        }
        // 座位交换结果：清除通知
        if (msg.type === 'seat_swap_result') {
          setIncomingSeatSwap(null);
        }
      },
    });
    hgcRef.current = hgc;

    // 按命令执行(连接命令在 HGC 内部排队,open 后 flush)
    // playerId 取自本地身份(门禁已确保设置);未设置时 undefined → 服务端自动生成
    const pid = getPlayerId() ?? undefined;
    if (command.type === 'create') {
      hgc.createRoom(command.name, command.maxPlayers, command.config, pid, command.roomType).catch((err) => {
        if (hgcRef.current !== hgc) return;
        const msg = err instanceof Error ? err.message : String(err);
        log.error('createRoom failed', { error: msg });
        setError(msg);
        setStage('lobby');
      });
      setStage('waiting');
    } else if (command.type === 'join' || command.type === 'autoJoin') {
      hgc.joinRoom(command.roomId, pid).catch((err) => {
        if (hgcRef.current !== hgc) return;
        const status = (err as { status?: number })?.status;
        const msg = err instanceof Error ? err.message : String(err);
        log.error('joinRoom failed', { status, error: msg });
        // URL 直达且房间不存在：显示 404 页面
        if (command.type === 'autoJoin' && status === 404) {
          setNotFound(true);
        } else {
          setError(msg);
          setStage('lobby');
        }
      });
      setStage('waiting');
    } else if (command.type === 'spectate') {
      hgc.joinAsSpectator(command.roomId, pid).catch((err) => {
        if (hgcRef.current !== hgc) return;
        const msg = err instanceof Error ? err.message : String(err);
        log.error('joinAsSpectator failed', { error: msg });
        setError(msg);
        setStage('lobby');
      });
      setStage('spectating');
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

  const createRoom = useCallback((name: string, maxPlayers: number, config?: RoomConfig, roomType?: 'normal' | 'quick') => {
    setError(null);
    setGameOver(null);
    setView(null);
    
    setRoomState(null);
    setCommand({
      type: 'create',
      name: name || `房间${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      maxPlayers,
      config,
      roomType,
    });
    log.info('createRoom', { name, maxPlayers, roomType });
  }, []);

  const joinRoom = useCallback((targetRoomId: string) => {
    setError(null);
    setGameOver(null);
    setView(null);
    
    setRoomState(null);
    setCommand({ type: 'join', roomId: targetRoomId });
    log.info('joinRoom', { roomId: targetRoomId });
  }, []);

  const toggleReady = useCallback(() => {
    const hgc = hgcRef.current;
    if (!hgc) return;
    if (ready) {
      void hgc.sendCancelReady();
    } else {
      void hgc.sendReady();
    }
  }, [ready]);

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
    setNotFound(false);
    setRoomId(null);
    setRoomState(null);
    setView(null);
    setGameOver(null);
    
    setPlayerId(null);
    setChatMessages([]);
    setIncomingSeatSwap(null);
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

  const sendChat = useCallback((text: string) => {
    const hgc = hgcRef.current;
    if (!hgc) return;
    void hgc.sendChat(text);
  }, []);

  const updateConfig = useCallback((config: RoomConfig, maxPlayers?: number) => {
    const hgc = hgcRef.current;
    if (!hgc) return;
    void hgc.sendUpdateConfig(config, maxPlayers);
  }, []);

  // ── 旁观者方法 ──

  const joinAsSpectator = useCallback((targetRoomId: string) => {
    setError(null);
    setGameOver(null);
    setView(null);
    
    setRoomState(null);
    setCommand({ type: 'spectate', roomId: targetRoomId });
    log.info('joinAsSpectator', { roomId: targetRoomId });
  }, []);

  const switchRole = useCallback((role: 'player' | 'spectator') => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    apiFetch<void>(`/api/rooms/${hgc.roomId}/switch-role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: hgc.playerId, role }),
    }).catch((err) => log.error('switchRole failed', { error: String(err) }));
  }, []);

  const requestView = useCallback((targetSeat: number) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    apiFetch<void>(`/api/rooms/${hgc.roomId}/request-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spectatorId: hgc.playerId, targetSeat }),
    }).catch((err) => log.error('requestView failed', { error: String(err) }));
  }, []);

  const approveView = useCallback((spectatorId: string, targetSeat: number) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    apiFetch<void>(`/api/rooms/${hgc.roomId}/approve-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spectatorId, targetSeat }),
    }).catch((err) => log.error('approveView failed', { error: String(err) }));
  }, []);

  const rejectView = useCallback((spectatorId: string) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId) return;
    apiFetch<void>(`/api/rooms/${hgc.roomId}/reject-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spectatorId }),
    }).catch((err) => log.error('rejectView failed', { error: String(err) }));
  }, []);

  const revokeView = useCallback((spectatorId: string) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId) return;
    apiFetch<void>(`/api/rooms/${hgc.roomId}/revoke-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spectatorId }),
    }).catch((err) => log.error('revokeView failed', { error: String(err) }));
  }, []);

  // ── 座位操作 ──

  const moveSeat = useCallback((targetSeat: number) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    apiFetch<void>(`/api/rooms/${hgc.roomId}/seat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: hgc.playerId, targetSeat }),
    }).catch((err) => log.error('moveSeat failed', { error: String(err) }));
  }, []);

  const requestSeatSwap = useCallback((targetSeat: number) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    apiFetch<void>(`/api/rooms/${hgc.roomId}/seat-swap/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: hgc.playerId, targetSeat }),
    }).catch((err) => log.error('requestSeatSwap failed', { error: String(err) }));
  }, []);

  const respondSeatSwap = useCallback((requesterId: string, accept: boolean) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    apiFetch<void>(`/api/rooms/${hgc.roomId}/seat-swap/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: hgc.playerId, requesterId, accept }),
    }).catch((err) => log.error('respondSeatSwap failed', { error: String(err) }));
    setIncomingSeatSwap(null);
  }, []);

  return {
    stage,
    roomId,
    playerId,
    roomState,
    view,
    gameOver,
    error,
    notFound,
    isHost,
    isSpectator,
    ready,
    createRoom,
    joinRoom,
    joinAsSpectator,
    toggleReady,
    startGame,
    sendRestart,
    leaveRoom,
    sendAction,
    reorderHand,
    switchRole,
    requestView,
    approveView,
    rejectView,
    revokeView,
    moveSeat,
    requestSeatSwap,
    respondSeatSwap,
    incomingSeatSwap,
    chatMessages,
    sendChat,
    updateConfig,
    connectionState,
    reconnectAttempt,
    cancelReconnect,
    recorder: {
      finalize: (meta) => recorderRef.current.finalize(meta),
      hasData: () => recorderRef.current.hasData(),
    },
  };
}
