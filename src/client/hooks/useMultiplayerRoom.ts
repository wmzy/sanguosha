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
import { useHgcPlayback, normalizeHgcError } from './useHgcPlayback';

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

export interface MultiplayerRoomOpts {
  /** URL 直达时强制以旁观者身份进入(?spectate=1)。演示/观战链接使用。 */
  forceSpectate?: boolean;
}

/**
 * resetRoomState 的重置语义(六处本地状态重置入口的真实差异,不得强行统一):
 * - { kind: 'join' }:重新发起加入(createRoom/joinRoom/joinAsSpectator 前)——
 *   清错误、密码弹窗、房间快照与旁观标志;asSpectator 例外(旁观标志由 spectate
 *   命令 effect 立即置位,不必先清)。保留聊天/播放(同房间重试不闪空)。
 * - { kind: 'round' }:game_reset 再来一局——清对局视图、结算、聊天、播放与
 *   离线座次;保留房间快照与身份(配置/准备状态跨局沿用)。
 * - { kind: 'leave' }:离开房间(主动退出/被踢)——回大厅并清房间身份、房间快照、
 *   对局状态与座位交换请求;播放仅清队列(出牌历史不动,与原实现一致)。
 */
type RoomResetOpts =
  | { kind: 'join'; asSpectator?: boolean }
  | { kind: 'round' }
  | { kind: 'leave' };

export function useMultiplayerRoom(
  initialRoomId?: string,
  opts: MultiplayerRoomOpts = {},
): MultiplayerRoom {
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

  // 初始命令:有 initialRoomId 则自动 join(分享链接直达);
  // forceSpectate(?spectate=1)优先走旁观,不占座、不会因房间满员而失败。
  const [command, setCommand] = useState<Command>(() =>
    initialRoomId
      ? opts.forceSpectate
        ? { type: 'spectate', roomId: initialRoomId }
        : { type: 'autoJoin', roomId: initialRoomId }
      : { type: 'idle' },
  );

  const hgcRef = useRef<HeadlessGameClient | null>(null);

  // 事件播放队列 + 出牌历史(与 useDebugMultiConnection 共用簿记,见 useHgcPlayback)。
  // 旁观者用 compact 模式：不补播历史动效，始终展示最新事件（AI 对局节奏快）。
  const {
    playbackRef,
    ingestedEvents,
    ingestEvents,
    enqueueEvent,
    resetPlayback,
    currentEvent,
    pendingCount,
    skipEvents,
  } = useHgcPlayback({ compact: hgcIsSpectator });

  /** 六处入口(game_reset/player_kicked/create/join/leave/spectate)共用的本地状态重置。 */
  const resetRoomState = useCallback((opts: RoomResetOpts) => {
    // 所有入口共通:丢弃上一局视图与结算
    setView(null);
    setGameOver(null);
    switch (opts.kind) {
      case 'join':
        setError(null);
        setPasswordPrompt(null);
        setRoomState(null);
        if (!opts.asSpectator) setHgcIsSpectator(false);
        break;
      case 'round':
        setStage('waiting');
        setChatMessages([]);
        resetPlayback();
        setDisconnectedSeats(new Set());
        break;
      case 'leave':
        setStage('lobby');
        setRoomId(null);
        setRoomState(null);
        setHgcIsSpectator(false);
        setChatMessages([]);
        setIncomingSeatSwap(null);
        playbackRef.current.reset(0);
        setDisconnectedSeats(new Set());
        break;
    }
  }, [resetPlayback]);

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
        if (hgcRef.current !== hgc) return;
        setView(v);
        // 出牌历史:追加批次(与播放队列解耦,空批次自动跳过)
        ingestEvents(newEvents);
        // 旁观者始终留在 spectating stage，不因 viewer>=0 跳转
        if (v.viewer >= 0 && !hgc.isSpectator) setStage('playing');
      },
      onRoomState: (rs) => { if (hgcRef.current !== hgc) return; setRoomState(rs); },
      onPhaseChange: (phase: ClientPhase) => {
        if (hgcRef.current !== hgc) return;
        if (phase === 'lobby') setConnectionState('connected');
        // 旁观者游戏开始时进入 spectating（看旁观视图），玩家进入 playing
        if (phase === 'playing') setStage(hgc.isSpectator ? 'spectating' : 'playing');
        if (phase === 'ended' && !hgc.isSpectator) setStage('ended');
      },
      onGameOver: (winner) => { if (hgcRef.current !== hgc) return; setGameOver({ winner }); },
      onError: (err) => {
        if (hgcRef.current !== hgc) return;
        // 操作类失败（ready/start/chat/config 等服务端 4xx）——显示错误提示。
        // WS 断连走 onReconnectStateChange，不会进入这里。
        const msg = normalizeHgcError(err);
        log.error('room op failed', { error: msg });
        showError(msg);
      },
      onReconnectStateChange: (state: ReconnectState) => {
        if (hgcRef.current !== hgc) return;
        // EventSource 自动重连不暴露尝试次数;ReconnectBanner 的「第 N 次」文案用 1/0 映射
        setReconnectAttempt(state === 'reconnecting' ? 1 : 0);
        if (state === 'idle') setConnectionState('connected');
        else if (state === 'reconnecting') setConnectionState('reconnecting');
        else if (state === 'failed') setConnectionState('failed');
      },
      onChat: (messages: ChatMessage[], source: 'chat' | 'history') => {
        if (hgcRef.current !== hgc) return;
        setChatMessages((prev) => {
          // chat 是增量追加;chat_history 是全量替换(重连/开局后服务端重发完整历史,
          // 按来源显式区分,避免「历史恰为 1 条」被当增量追加造成重复)
          if (source === 'chat') {
            return [...prev, ...messages];
          }
          return messages;
        });
      },
      onIdentityChange: ({ roomId: newRoomId, isSpectator: newIsSpectator }) => {
        if (hgcRef.current !== hgc) return;
        // URL 只同步 roomId；旁观标志从 HGC 与服务端 room_state 双重确认。
        if (newRoomId) setRoomId((prev) => (prev === newRoomId ? prev : newRoomId));
        setHgcIsSpectator(newIsSpectator);
      },
      onMessage: (msg: ServerMessage) => {
        if (hgcRef.current !== hgc) return;
        // 再来一局:服务端 resetToLobby 广播 game_reset,清除结算界面回到准备阶段。
        // HGC 内部已重置 view/gameOverWinner,这里同步 React state(roomId/playerId 保留)。
        if (msg.type === 'game_started') {
          // 每局游戏是独立的聊天会话:开局时清空上一局的消息
          setChatMessages([]);
          setDisconnectedSeats(new Set());
        }
        if (msg.type === 'game_reset') {
          resetRoomState({ kind: 'round' });
        }
        if (msg.type === 'event' && msg.view) {
          // 事件播放:他人出牌/判定翻牌等中央动效(供 GameViewComponent 中央展示)
          enqueueEvent(msg.seq, msg.view);
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
          resetRoomState({ kind: 'leave' });
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
          setHgcIsSpectator(msg.newRole === 'spectator');
          if (msg.newRole === 'player') setStage('waiting');
        }
      },
    });
    hgcRef.current = hgc;

    /** 错误 toast + 回大厅(join/create 失败的公共收尾)。 */
    const errorToLobby = (msg: string) => {
      clearErrorTimer();
      setError(msg);
      setStage('lobby');
    };
    /**
     * join/spectate 两条加入路径的公共失败处理链:
     * 403 → 密码弹窗回大厅;其余(房间不存在/已开局/满员等)交各路径决策(onFailure)。
     */
    const handleJoinError = (
      err: unknown,
      join: { label: string; roomId: string; mode: 'join' | 'spectate'; password?: string },
      onFailure: (err: unknown, msg: string) => void,
    ) => {
      if (hgcRef.current !== hgc) return;
      const status = (err as { status?: number })?.status;
      const msg = normalizeHgcError(err);
      log.error(join.label, { status, error: msg });
      // 有密码房间且未携带/密码错误 → 弹密码输入框,确认后带密码重试。
      // autoJoin(URL 直达)/手动 join/旁观加入都走此路径;仅 403(密码错误)触发,
      // 其他失败(游戏已开始/房间已满)维持各路径原有降级逻辑。
      if (status === 403) {
        setPasswordPrompt({ roomId: join.roomId, mode: join.mode, error: join.password ? '密码错误，请重试' : null });
        setStage('lobby');
        return;
      }
      onFailure(err, msg);
    };

    // 按命令执行(连接命令在 HGC 内部排队,open 后 flush)
    // playerId 不再本地传:服务端从会话(Cookie)解析 userId,body.playerId 已被忽略
    if (command.type === 'create') {
      void hgc.createRoom(command.name, command.maxPlayers, command.config, undefined, command.roomType, command.password)
        .then(() => {
          if (hgcRef.current !== hgc) return;
          setStage('waiting');
        })
        .catch((err) => {
          if (hgcRef.current !== hgc) return;
          const msg = normalizeHgcError(err);
          log.error('createRoom failed', { error: msg });
          errorToLobby(msg);
        })
        .finally(() => {
          // 创建 settle(成功进入 waiting / 失败回 lobby)后解除按钮禁用。
          // cleanup 后的迟到 settle 不再触碰当前状态。
          if (hgcRef.current === hgc) setIsCreating(false);
        });
      setStage('waiting');
    } else if (command.type === 'join' || command.type === 'autoJoin') {
      hgc.joinRoom(command.roomId, undefined, command.password).catch((err) =>
        handleJoinError(
          err,
          { label: 'joinRoom failed', roomId: command.roomId, mode: 'join', password: command.password },
          command.type === 'autoJoin'
            ? // URL 直达(/play/:roomId)时:
              // 房间不存在(404) → notFound。
              // 其他失败(游戏已开始/房间已满)→ 自动降级为旁观者加入。
              // 理由:URL 直达的核心诉求是"进入房间";无法以玩家身份进入时,旁观是
              // 唯一可行的进入方式。这也修复了"先旁观再刷新反复回到错误页"的死循环
              // (刷新只触发 autoJoin 玩家加入,旁观状态不会被 URL 记住)。
              // 旁观加入无人数上限,不会因容量失败(仅 404)。
              (e) => (isRoomNotFound(e) ? setNotFound(true) : setCommand({ type: 'spectate', roomId: command.roomId }))
            : (_, msg) => errorToLobby(msg),
        ),
      );
      setStage('waiting');
    } else if (command.type === 'spectate') {
      setSpectatorFlag(true);
      hgc.joinAsSpectator(command.roomId, undefined, command.password).catch((err) =>
        handleJoinError(
          err,
          { label: 'joinAsSpectator failed', roomId: command.roomId, mode: 'spectate', password: command.password },
          (e, msg) => (isRoomNotFound(e) ? setNotFound(true) : errorToLobby(msg)),
        ),
      );
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
  }, [command, serverUrl, resetRoomState]);

  const createRoom = useCallback((name: string, maxPlayers: number, config?: RoomConfig, roomType?: 'normal' | 'quick', password?: string) => {
    resetRoomState({ kind: 'join' });
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
  }, [resetRoomState]);

  const joinRoom = useCallback((targetRoomId: string, password?: string) => {
    resetRoomState({ kind: 'join' });
    setCommand({ type: 'join', roomId: targetRoomId, password });
    log.info('joinRoom', { roomId: targetRoomId });
  }, [resetRoomState]);

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
    setNotFound(false);
    setIsCreating(false);
    setPasswordPrompt(null);
    resetRoomState({ kind: 'leave' });
  }, [resetRoomState]);

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
    resetRoomState({ kind: 'join', asSpectator: true });
    setCommand({ type: 'spectate', roomId: targetRoomId, password });
    log.info('joinAsSpectator', { roomId: targetRoomId });
  }, [resetRoomState]);

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

  /**
   * 房间操作 REST POST 统一封装:JSON body + 失败日志。
   * 操作结果经 SSE(room_state/role_changed 等)广播同步,默认失败仅 log.error;
   * 需要向用户提示的调用(switchRole)传 onErr 追加 UI 反馈。
   */
  const postRoomApi = useCallback((
    path: string,
    body: Record<string, unknown>,
    errLabel: string,
    onErr?: (err: unknown) => void,
  ) => {
    apiFetch<void>(`/api/rooms/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((err) => {
      log.error(errLabel, { error: String(err) });
      onErr?.(err);
    });
  }, []);

  const switchRole = useCallback((role: 'player' | 'spectator', seat?: number) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    const payload: Record<string, unknown> = { playerId: hgc.playerId, role };
    if (seat !== undefined) payload.seat = seat;
    postRoomApi(`${hgc.roomId}/switch-role`, payload, 'switchRole failed', (err) => {
      const body = (err as { body?: { error?: string } }).body;
      showError(body?.error ?? (role === 'spectator' ? '切换为旁观者失败' : '加入游戏失败（房间可能已满）'));
    });
  }, [postRoomApi, showError]);

  const requestView = useCallback((targetSeat: number) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    postRoomApi(`${hgc.roomId}/request-view`, { spectatorId: hgc.playerId, targetSeat }, 'requestView failed');
  }, [postRoomApi]);

  const approveView = useCallback((spectatorId: string, targetSeat: number) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    postRoomApi(`${hgc.roomId}/approve-view`, { spectatorId, targetSeat }, 'approveView failed');
  }, [postRoomApi]);

  const rejectView = useCallback((spectatorId: string) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId) return;
    postRoomApi(`${hgc.roomId}/reject-view`, { spectatorId }, 'rejectView failed');
  }, [postRoomApi]);

  const revokeView = useCallback((spectatorId: string) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId) return;
    postRoomApi(`${hgc.roomId}/revoke-view`, { spectatorId }, 'revokeView failed');
  }, [postRoomApi]);

  // ── 座位操作 ──

  const moveSeat = useCallback((targetSeat: number) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    postRoomApi(`${hgc.roomId}/seat`, { playerId: hgc.playerId, targetSeat }, 'moveSeat failed');
  }, [postRoomApi]);

  const requestSeatSwap = useCallback((targetSeat: number) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    postRoomApi(`${hgc.roomId}/seat-swap/request`, { playerId: hgc.playerId, targetSeat }, 'requestSeatSwap failed');
  }, [postRoomApi]);

  const respondSeatSwap = useCallback((requesterId: string, accept: boolean) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    postRoomApi(`${hgc.roomId}/seat-swap/respond`, { playerId: hgc.playerId, requesterId, accept }, 'respondSeatSwap failed');
    setIncomingSeatSwap(null);
  }, [postRoomApi]);

  const kickPlayer = useCallback((targetPlayerId: string) => {
    const hgc = hgcRef.current;
    if (!hgc?.roomId || !hgc.playerId) return;
    postRoomApi(`${hgc.roomId}/kick`, { playerId: hgc.playerId, targetPlayerId }, 'kickPlayer failed');
  }, [postRoomApi]);

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
    currentEvent,
    ingestedEvents,
    pendingCount,
    skipEvents,
  };
}
