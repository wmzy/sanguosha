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
import { apiFetch } from '../api/client';
import { useAuth } from './useAuth';
import { isRoomNotFound } from '../utils/roomErrors';
import { useEventPlayback } from './useEventPlayback';
import { appendIngestedEvents } from '../utils/appendIngestedEvents';

const log = createLogger('useMultiplayerRoom');

export type MultiplayerStage = 'lobby' | 'waiting' | 'playing' | 'ended' | 'spectating';

/** 连接状态(供 UI 显示连接/重连提示)。 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'failed';

/** 连接命令:驱动主 effect 建立/重建 HGC 连接。 */
type Command =
  | { type: 'idle' }
  | { type: 'autoJoin'; roomId: string; password?: string }
  | { type: 'create'; name: string; maxPlayers: number; config?: RoomConfig; roomType?: 'normal' | 'quick'; password?: string }
  | { type: 'join'; roomId: string; password?: string }
  | { type: 'spectate'; roomId: string; password?: string }

/** 待输入密码的加入请求(弹窗展示,确认后携带密码重试)。 */
export interface PasswordPrompt {
  roomId: string;
  /** 加入方式:玩家或旁观 */
  mode: 'join' | 'spectate';
  /** 重试次数(用于错误提示文案) */
  error?: string | null;
};

export interface MultiplayerRoom {
  stage: MultiplayerStage;
  roomId: string | null;
  playerId: string | null;
  roomState: RoomState | null;
  view: GameView | null;
  gameOver: { winner: string } | null;
  error: string | null;
  /** 手动关闭错误 toast(点击 toast 关闭) */
  clearError: () => void;
  /** 房间不存在(URL 直达不存在的 roomId) */
  notFound: boolean;
  /** 是否房主 */
  isHost: boolean;
  /** 是否为旁观者 */
  isSpectator: boolean;
  /** 本人是否已准备 */
  ready: boolean;
  /** 创建房间请求进行中(供创建表单禁用防重复提交) */
  isCreating: boolean;
  createRoom: (name: string, maxPlayers: number, config?: RoomConfig, roomType?: 'normal' | 'quick', password?: string) => void;
  joinRoom: (roomId: string, password?: string) => void;
  joinAsSpectator: (roomId: string, password?: string) => void;
  /** 待输入房间密码的加入请求(非空时 UI 显示密码弹窗) */
  passwordPrompt: PasswordPrompt | null;
  /** 密码弹窗确认:携带密码重试加入 */
  submitRoomPassword: (password: string) => void;
  /** 密码弹窗取消 */
  cancelRoomPassword: () => void;
  toggleReady: () => void;
  startGame: () => void;
  /** 游戏结束后再来一局:重置房间回「配置+准备」阶段(复用同一连接)。 */
  sendRestart: () => void;
  leaveRoom: () => void;
  sendAction: (action: ActionMsg) => void;
  reorderHand: (order: string[]) => void;
  /** 切换身份（等待中） */
  switchRole: (role: 'player' | 'spectator', seat?: number) => void;
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
  /** 房主踢出指定成员（玩家或旁观者），仅等待中 */
  kickPlayer: (targetPlayerId: string) => void;
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
  /** 游戏中已断线的座次集合(view player index),前端据此显示离线角标 */
  disconnectedSeats: Set<number>;
  /** 当前播放的事件(供 GameViewComponent 中央动效展示:他人出牌/判定翻牌等) */
  currentEvent: import('./useEventPlayback').QueuedEvent | null;
  /** 刚入队的事件批次:出牌历史条立即消费(不等播放队列) */
  ingestedEvents: import('./useEventPlayback').QueuedEvent[];
  /** 待播事件队列积压数(>1 时 GameView 横幅显示「+N 排队中」角标) */
  pendingCount: number;
  /** 一键清空事件播放积压(横幅角标 ⏭,立即对齐到最新事件) */
  skipEvents: () => void;
  /** 当前重连尝试次数(0=未在重连) */
  reconnectAttempt: number;
  /** 手动取消重连 */
  cancelReconnect: () => void;
}

export function useMultiplayerRoom(initialRoomId?: string): MultiplayerRoom {
  const [stage, setStage] = useState<MultiplayerStage>('lobby');
  const [roomId, setRoomId] = useState<string | null>(null);
  // 身份来自登录会话(RRequireAuth 门禁保证 user 已就绪):userId 即 playerId。
  const auth = useAuth();
  const playerId = auth.user?.id ?? null;
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  /** 从 HGC 同步的旁观者标志(joinAsSpectator 的 REST 响应立即生效,无需等 SSE room_state)。 */
  const [hgcIsSpectator, setHgcIsSpectator] = useState(false);
  // 命令 effect 内同步旁观标志(闭包直调,避免依赖漂移)
  const setSpectatorFlag = useCallback(setHgcIsSpectator, []);
  const [view, setView] = useState<GameView | null>(null);
  const [gameOver, setGameOver] = useState<{ winner: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 错误 toast 的自动消失计时器:必须可清除——连发错误时若沿用旧的 setTimeout,
  // 前一个计时器会提前清掉后一个 toast;卸载时也要清理避免泄漏。
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 清除待执行的自动消失计时器(不改变当前已显示的 error 内容)。 */
  const clearErrorTimer = useCallback(() => {
    if (errorTimerRef.current !== null) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);
  /** 显示错误 toast,3 秒后自动消失;新错误到来先取消旧计时器,保证每条都展示完整时长。 */
  const showError = useCallback(
    (msg: string) => {
      clearErrorTimer();
      setError(msg);
      errorTimerRef.current = setTimeout(() => {
        errorTimerRef.current = null;
        setError(null);
      }, 3000);
    },
    [clearErrorTimer],
  );
  /** 手动关闭错误 toast(供 UI 点击关闭)。 */
  const clearError = useCallback(() => {
    clearErrorTimer();
    setError(null);
  }, [clearErrorTimer]);
  // 卸载清理:防止计时器回调对已卸载组件 setState。
  useEffect(() => clearErrorTimer, [clearErrorTimer]);
  /** 房间不存在(URL 直达 /play/:roomId 但房间已销毁) */
  const [notFound, setNotFound] = useState(false);
  /** 创建房间请求进行中(createRoom 发起 → create 命令 settle) */
  const [isCreating, setIsCreating] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  /** 收到的座位交换请求 */
  const [incomingSeatSwap, setIncomingSeatSwap] = useState<
    { requesterId: string; requesterSeat: number; targetSeat: number; expiresAt: number } | null
  >(null);
  /** 游戏中已断线的座次(game view player index 集合),供座位卡显示离线标识 */
  const [disconnectedSeats, setDisconnectedSeats] = useState<Set<number>>(new Set());
  /** 待输入房间密码的加入请求 */
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(null);

  // 初始命令:有 initialRoomId 则自动 join(分享链接直达)
  const [command, setCommand] = useState<Command>(() =>
    initialRoomId ? { type: 'autoJoin', roomId: initialRoomId } : { type: 'idle' },
  );

  const hgcRef = useRef<HeadlessGameClient | null>(null);

  // 事件播放队列:把后端 event 消息按 seq 入队,逐个暴露给 GameViewComponent 中央动效。
  // 用 ref 在 onMessage 闭包中取最新 playback,避免闭包竞态。
  const playback = useEventPlayback();
  const playbackRef = useRef(playback);
  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);
  /** 出牌历史:由 onView.newEvents 驱动(与播放队列解耦) */
  const [ingestedEvents, setIngestedEvents] = useState<
    import('./useEventPlayback').QueuedEvent[]
  >([]);
  const historySeqRef = useRef(0);

  const serverUrl = window.location.origin;

  const isHost = roomState?.hostId === playerId && playerId !== null;
  // isSpectator 合并两个来源:
  // 1. hgcIsSpectator — joinAsSpectator 的 REST 响应立即置位,无需等 SSE room_state
  // 2. roomState.spectatorIds — 服务端 room_state 确认(等待大厅内的旁观者,stage 仍为 waiting)
  const isSpectator =
    hgcIsSpectator || (!!playerId && (roomState?.spectatorIds.includes(playerId) ?? false));
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
        setView(v);
        // 出牌历史:追加批次(不可替换——WS 连发时 React 会合并 setState 丢掉中间的打出)
        if (newEvents.length > 0) {
          setIngestedEvents((prev) =>
            appendIngestedEvents(prev, newEvents, () => ++historySeqRef.current),
          );
        }
        // 旁观者始终留在 spectating stage，不因 viewer>=0 跳转
        if (v.viewer >= 0 && !hgc.isSpectator) setStage('playing');
      },
      onRoomState: (rs) => setRoomState(rs),
      onPhaseChange: (phase: ClientPhase) => {
        if (phase === 'lobby') setConnectionState('connected');
        // 旁观者游戏开始时进入 spectating（看旁观视图），玩家进入 playing
        if (phase === 'playing') setStage(hgc.isSpectator ? 'spectating' : 'playing');
        if (phase === 'ended' && !hgc.isSpectator) setStage('ended');
      },
      onGameOver: (winner) => setGameOver({ winner }),
      onError: (err) => {
        // 操作类失败（ready/start/chat/config 等服务端 4xx）——显示错误提示。
        // WS 断连走 onReconnectStateChange，不会进入这里。
        const msg = err instanceof Error ? err.message : String(err);
        log.error('room op failed', { error: msg });
        showError(msg);
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
      // 连接身份事件驱动同步(HGC 在 REST 建房/加房响应、room_joined、role_changed 时回调),
      // 替代原先的 200ms getter 轮询。函数式 setState 避免闭包过期;空值不清空本地状态
      // (清空由 leaveRoom/player_kicked 显式负责),与原轮询语义一致。
      onIdentityChange: ({ roomId: newRoomId }) => {
        if (newRoomId) setRoomId((prev) => (prev === newRoomId ? prev : newRoomId));
      },
      onMessage: (msg: ServerMessage) => {
        // 再来一局:服务端 resetToLobby 广播 game_reset,清除结算界面回到准备阶段。
        // HGC 内部已重置 view/gameOverWinner,这里同步 React state(roomId/playerId 保留)。
        if (msg.type === 'game_started') {
          // 每局游戏是独立的聊天会话:开局时清空上一局的消息
          setChatMessages([]);
          setDisconnectedSeats(new Set());
        }
        if (msg.type === 'game_reset') {
          setGameOver(null);
          setView(null);
          
          setStage('waiting');
          setChatMessages([]);
          setIngestedEvents([]);
          historySeqRef.current = 0;
          playbackRef.current.reset(0);
          setDisconnectedSeats(new Set());
        }
        if (msg.type === 'event' && msg.view) {
          // 事件播放:他人出牌/判定翻牌等中央动效(供 GameViewComponent 中央展示)
          playbackRef.current.enqueue([{ seq: msg.seq, event: msg.view }]);
        }
        if (msg.type === 'error') {
          showError(msg.message);
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
        // 自己被房主移出：断开连接（避免自动重连），返回大厅并提示
        if (msg.type === 'player_kicked' && msg.playerId === hgc.playerId) {
          hgc.disconnect();
          setCommand({ type: 'idle' });
          setStage('lobby');
          setRoomId(null);
          setRoomState(null);
          setHgcIsSpectator(false);
          setView(null);
          setGameOver(null);
          setChatMessages([]);
          setIncomingSeatSwap(null);
          playbackRef.current.reset(0);
          setDisconnectedSeats(new Set());
          // 持久提示(不自动消失):先清掉可能在途的自动消失计时器,避免旧 timer 提前清掉它
          clearErrorTimer();
          setError('你已被房主移出房间');
        }
        // 玩家断线/重连:维护离线座次集合,供座位卡显示离线角标
        if (msg.type === 'player_disconnected' && msg.seatIndex >= 0) {
          setDisconnectedSeats((prev) => {
            if (prev.has(msg.seatIndex)) return prev;
            const next = new Set(prev);
            next.add(msg.seatIndex);
            return next;
          });
        }
        if (msg.type === 'player_reconnected' && msg.seatIndex >= 0) {
          setDisconnectedSeats((prev) => {
            if (!prev.has(msg.seatIndex)) return prev;
            const next = new Set(prev);
            next.delete(msg.seatIndex);
            return next;
          });
        }
        // 身份切换同步 stage：
        // - spectator→player：切回等待大厅（无论原 stage 是 waiting 还是 spectating）
        // - player→spectator：保持当前 stage（等待大厅内旁观不切换视图）
        if (msg.type === 'role_changed' && msg.playerId === hgc.playerId) {
          if (msg.newRole === 'player') setStage('waiting');
        }
      },
    });
    hgcRef.current = hgc;

    // 按命令执行(连接命令在 HGC 内部排队,open 后 flush)
    // playerId 不再本地传:服务端从会话(Cookie)解析 userId,body.playerId 已被忽略
    if (command.type === 'create') {
      hgc.createRoom(command.name, command.maxPlayers, command.config, undefined, command.roomType, command.password)
        .catch((err) => {
          if (hgcRef.current !== hgc) return;
          const msg = err instanceof Error ? err.message : String(err);
          log.error('createRoom failed', { error: msg });
          clearErrorTimer();
          setError(msg);
          setStage('lobby');
        })
        .finally(() => {
          // 创建 settle(成功进入 waiting / 失败回 lobby)后解除按钮禁用。
          // cleanup 后的迟到 settle 不再触碰当前状态。
          if (hgcRef.current === hgc) setIsCreating(false);
        });
      setStage('waiting');
    } else if (command.type === 'join' || command.type === 'autoJoin') {
      hgc.joinRoom(command.roomId, undefined, command.password).catch((err) => {
        if (hgcRef.current !== hgc) return;
        const status = (err as { status?: number })?.status;
        const msg = err instanceof Error ? err.message : String(err);
        log.error('joinRoom failed', { status, error: msg });
        // 有密码房间且未携带/密码错误 → 弹密码输入框,确认后带密码重试。
        // autoJoin(URL 直达)与手动 join 都走此路径;仅 403(密码错误)触发,
        // 其他失败(游戏已开始/房间已满)维持原有降级逻辑。
        if (status === 403) {
          setPasswordPrompt({ roomId: command.roomId, mode: 'join', error: command.password ? '密码错误，请重试' : null });
          setStage('lobby');
          return;
        }
        // URL 直达(/play/:roomId)时:
        // 房间不存在(404) → notFound。
        // 其他失败(游戏已开始/房间已满)→ 自动降级为旁观者加入。
        // 理由:URL 直达的核心诉求是"进入房间";无法以玩家身份进入时,旁观是
        // 唯一可行的进入方式。这也修复了"先旁观再刷新反复回到错误页"的死循环
        // (刷新只触发 autoJoin 玩家加入,旁观状态不会被 URL 记住)。
        // 旁观加入无人数上限,不会因容量失败(仅 404)。
        if (command.type === 'autoJoin') {
          if (isRoomNotFound(err)) setNotFound(true);
          else setCommand({ type: 'spectate', roomId: command.roomId });
        } else {
          clearErrorTimer();
          setError(msg);
          setStage('lobby');
        }
      });
      setStage('waiting');
    } else if (command.type === 'spectate') {
      setSpectatorFlag(true);
      hgc.joinAsSpectator(command.roomId, undefined, command.password).catch((err) => {
        if (hgcRef.current !== hgc) return;
        const status = (err as { status?: number })?.status;
        const msg = err instanceof Error ? err.message : String(err);
        log.error('joinAsSpectator failed', { status, error: msg });
        if (status === 403) {
          setPasswordPrompt({ roomId: command.roomId, mode: 'spectate', error: command.password ? '密码错误，请重试' : null });
          setStage('lobby');
          return;
        }
        if (isRoomNotFound(err)) setNotFound(true);
        else {
          clearErrorTimer();
          setError(msg);
          setStage('lobby');
        }
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

  const createRoom = useCallback((name: string, maxPlayers: number, config?: RoomConfig, roomType?: 'normal' | 'quick', password?: string) => {
    setError(null);
    setGameOver(null);
    setView(null);
    setPasswordPrompt(null);
    setRoomState(null);
    setHgcIsSpectator(false);
    setIsCreating(true);
    setCommand({
      type: 'create',
      name: name || `房间${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      maxPlayers,
      config,
      roomType,
      password,
    });
    log.info('createRoom', { name, maxPlayers, roomType });
  }, []);

  const joinRoom = useCallback((targetRoomId: string, password?: string) => {
    setError(null);
    setGameOver(null);
    setView(null);
    setPasswordPrompt(null);
    setRoomState(null);
    setHgcIsSpectator(false);
    setCommand({ type: 'join', roomId: targetRoomId, password });
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
    setIsCreating(false);
    setPasswordPrompt(null);
    setRoomId(null);
    setRoomState(null);
    setHgcIsSpectator(false);
    setView(null);
    setGameOver(null);

    setChatMessages([]);
    setIncomingSeatSwap(null);
    playbackRef.current.reset(0);
    setDisconnectedSeats(new Set());
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

  const joinAsSpectator = useCallback((targetRoomId: string, password?: string) => {
    setError(null);
    setGameOver(null);
    setView(null);
    setPasswordPrompt(null);
    setRoomState(null);
    setCommand({ type: 'spectate', roomId: targetRoomId, password });
    log.info('joinAsSpectator', { roomId: targetRoomId });
  }, []);

  // ── 房间密码弹窗 ──

  /** 密码弹窗确认:按原方式携带密码重试。 */
  const submitRoomPassword = useCallback((password: string) => {
    const prompt = passwordPrompt;
    if (!prompt || !password) return;
    if (prompt.mode === 'spectate') joinAsSpectator(prompt.roomId, password);
    else joinRoom(prompt.roomId, password);
  }, [passwordPrompt, joinRoom, joinAsSpectator]);

  /** 密码弹窗取消:回大厅。 */
  const cancelRoomPassword = useCallback(() => {
    setPasswordPrompt(null);
    setStage('lobby');
  }, []);

  const switchRole = useCallback((role: 'player' | 'spectator', seat?: number) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    const payload: Record<string, unknown> = { playerId: hgc.playerId, role };
    if (seat !== undefined) payload.seat = seat;
    apiFetch<void>(`/api/rooms/${hgc.roomId}/switch-role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err) => {
      log.error('switchRole failed', { error: String(err) });
      const body = (err as { body?: { error?: string } }).body;
      showError(body?.error ?? (role === 'spectator' ? '切换为旁观者失败' : '加入游戏失败（房间可能已满）'));
    });
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

  const kickPlayer = useCallback((targetPlayerId: string) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    apiFetch<void>(`/api/rooms/${hgc.roomId}/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: hgc.playerId, targetPlayerId }),
    }).catch((err) => log.error('kickPlayer failed', { error: String(err) }));
  }, []);

  return {
    stage,
    roomId,
    playerId,
    roomState,
    view,
    gameOver,
    error,
    clearError,
    notFound,
    isHost,
    isSpectator,
    ready,
    isCreating,
    createRoom,
    joinRoom,
    joinAsSpectator,
    passwordPrompt,
    submitRoomPassword,
    cancelRoomPassword,
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
    kickPlayer,
    incomingSeatSwap,
    chatMessages,
    sendChat,
    updateConfig,
    connectionState,
    disconnectedSeats,
    reconnectAttempt,
    cancelReconnect,
    currentEvent: playback.current,
    ingestedEvents,
    pendingCount: playback.pendingCount,
    skipEvents: playback.skipAll,
  };
}
