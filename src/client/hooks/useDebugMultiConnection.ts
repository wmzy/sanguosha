// src/client/hooks/useDebugMultiConnection.ts
// Debug 多 WS 连接管理 hook。
//
// 重构后基于 HeadlessGameClient：每个座次一个 HGC 实例，hook 退化为协调器。
// StrictMode 安全：effect 管理自己的连接生命周期。
//
// N 连接 vs 1 连接:
//   N 连接:每个 viewer 独立传输,服务端按 viewer 分叉发 events,前端无需过滤
//   1 连接:所有 viewer 共享传输,服务端给所有 viewer 发 event,前端按 viewer 过滤
// 选择 N 连接:每个 viewer 是独立实体,传输层隔离更干净。

import { useState, useEffect, useRef, useCallback } from 'react';
import { HeadlessGameClient } from '../headless/HeadlessGameClient';
import { ReplayRecorder } from '../replay/recorder';
import type { ClientPhase } from '../headless/types';
import { useEventPlayback } from './useEventPlayback';
import { useMarkCharSelectSubmitted, useClearSubmittedCharSelects } from './SubmittedCharSelectCtx';
import { createLogger } from '../utils/logger';
import { logWsMessage, logUserAction } from '../utils/debugTelemetry';
import type { GameView } from '../../engine/types';
import { suitColor, type Suit } from '../../shared/types';
import type { ServerMessage, ClientMessage } from '../../server/protocol';
import type { ActionMsg } from '../types';

const log = createLogger('useDebugMultiConnection');

/** 判定牌在处理区停留时间(ms),供玩家看清花色点数后移除 */
const JUDGE_CARD_LINGER_MS = 2500;

export type { ActionMsg };

export interface UseDebugMultiConnectionParams {
  roomId: string;
  playerCount: number;
  perspective: number;
  onFirstView?: (viewer: number) => void;
}

/** 房间准备状态(配置阶段)。由 room_state 消息驱动更新。 */
export interface RoomState {
  readyPlayers: string[];
  playerIds: string[];
  hostId: string | null;
  maxPlayers: number;
  config: import('../../server/protocol').RoomConfig;
}

export function useDebugMultiConnection(params: UseDebugMultiConnectionParams): {
  views: Map<number, GameView>;
  currentEvent: import('./useEventPlayback').QueuedEvent | null;
  sendAction: (action: ActionMsg) => void;
  reorderHand: (order: string[]) => void;
  disconnectAll: () => void;
  getSeq: (seat: number) => number;
  /** 配置阶段:房间准备状态 */
  roomState: RoomState | null;
  /** 配置阶段:游戏是否已开始 */
  gameStarted: boolean;
  /** 游戏结束结果(null=进行中);收到后触发结算界面 */
  gameOver: { winner: string } | null;
  /** 配置阶段:座次→playerId 映射 */
  seatPlayerIds: Map<number, string>;
  /** 配置阶段:指定座次发送准备 */
  sendReady: (seat: number) => void;
  /** 配置阶段:发送开始游戏(任意座次连接) */
  sendStartGame: () => void;
  /** 发送重新开始游戏(再来一局) */
  sendRestart: () => void;
  /** 配置阶段:更新房间配置 */
  sendUpdateConfig: (config: import('../../server/protocol').RoomConfig) => void;
  /** 已连接座次数 */
  connectedCount: number;
  /** 正在重连的座次数(0=全部已连接) */
  reconnectingCount: number;
  /** 录像录制器:finalize 导出录像文件,hasData 检查是否有数据 */
  recorder: {
    finalize: (meta: import('../replay/types').ReplayMeta) => import('../replay/types').ReplayFile;
    hasData: () => boolean;
  };
} {
  const { roomId, playerCount, perspective } = params;
  // viewer index → HGC 实例
  const clientsRef = useRef<Map<number, HeadlessGameClient>>(new Map());
  const [views, setViews] = useState<Map<number, GameView>>(new Map());
  const [connectedCount, setConnectedCount] = useState(0);
  const [reconnectingCount, setReconnectingCount] = useState(0);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  /** 游戏结束结果(winner=胜方座次号字符串,或 '无人')。收到 gameOver 消息后设置。 */
  const [gameOver, setGameOver] = useState<{ winner: string } | null>(null);
  const [seatPlayerIds, setSeatPlayerIds] = useState<Map<number, string>>(new Map());
  /** 录像录制器:收集各座次 ViewEvent,游戏结束时导出 */
  const recorderRef = useRef<ReplayRecorder>(new ReplayRecorder());
  const playback = useEventPlayback();
  const playbackRef = useRef(playback);
  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);
  const perspectiveRef = useRef(perspective);
  useEffect(() => {
    perspectiveRef.current = perspective;
  }, [perspective]);
  const onFirstViewRef = useRef(params.onFirstView);
  useEffect(() => {
    onFirstViewRef.current = params.onFirstView;
  }, [params.onFirstView]);
  const markSubmitted = useMarkCharSelectSubmitted();
  const clearSubmitted = useClearSubmittedCharSelects();
  /** HGC 首次收到 initialView 的座次集合，用于触发 onFirstView（仅 viewer=0 一次） */
  const firstViewFiredRef = useRef(false);

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

  /** 查找某 viewer 对应的 HGC（viewer 字段可能被 room_joined.seatIndex 覆盖，故按 viewer 遍历） */
  const clientByViewer = useCallback((viewer: number): HeadlessGameClient | undefined => {
    return [...clientsRef.current.values()].find((c) => c.seatIndex === viewer);
  }, []);

  // ── 建立连接：N 个 HGC 实例 ──
  useEffect(() => {
    if (!roomId || playerCount < 2) return;
    clientsRef.current.clear();
    setViews(new Map());
    playbackRef.current.reset(0);
    recorderRef.current.reset();
    setConnectedCount(0);
    setReconnectingCount(0);
    setGameOver(null);
    setSeatPlayerIds(new Map());
    firstViewFiredRef.current = false;

    // StrictMode 安全：cleanup 后不再 join，避免幽灵连接占用座次
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    // 只通过 onPhaseChange 递增（WS 真正 open 时），不在 effect 体中立即加，避免 StrictMode 翻倍
    let connectionOpenCount = 0;

    /* eslint-disable no-loop-func -- 回调安全捕获 effect 作用域的 cancelled/connectionOpenCount 标志,cleanup 后才置 true */
    for (let i = 0; i < playerCount; i++) {
      const viewerIndex = i;
      const hgc = new HeadlessGameClient(wsUrl, {
        onView: (view, newEvents) => {
          if (cancelled) return;
          // 录制:所有座次的事件流都记录
          recorderRef.current.record(view.viewer, view, newEvents);
          setViews((prev) => {
            const next = new Map(prev);
            next.set(view.viewer, view);
            return next;
          });
          if (!firstViewFiredRef.current && view.viewer === 0) {
            firstViewFiredRef.current = true;
            onFirstViewRef.current?.(view.viewer);
          }
        },
        onPhaseChange: (phase: ClientPhase) => {
          if (cancelled) return;
          if (phase === 'playing') setGameStarted(true);
          // connectedCount 只在 WS 真正 open 时递增（与原始 hook 的 onopen 对齐）
          if (phase === 'lobby' || phase === 'playing') {
            connectionOpenCount++;
            setConnectedCount(connectionOpenCount);
          }
        },
        onGameOver: (winner: string) => {
          if (cancelled) return;
          setGameOver({ winner });
        },
        onRoomState: (state) => {
          if (cancelled || !state) return;
          setRoomState(state);
        },
        onError: () => {
          /* WS error 已由重连机制覆盖 */
        },
        onReconnectStateChange: (state) => {
          if (cancelled) return;
          setReconnectingCount((prev) => {
            if (state === 'reconnecting') return prev + 1;
            if (state === 'idle' && prev > 0) return prev - 1;
            return prev;
          });
        },
        onMessage: (msg: ServerMessage) => {
          if (cancelled) return;
          logWsMessage(viewerIndex, 'in', msg);
          handleDisplayMessage(viewerIndex, msg);
        },
      });
      clientsRef.current.set(viewerIndex, hgc);
      hgc.connect(roomId, viewerIndex);
      cleanups.push(() => {
        try {
          hgc.disconnect();
        } catch {
          /* */
        }
      });
    }
    /* eslint-enable no-loop-func */

    return () => {
      cancelled = true;
      for (const c of cleanups) c();
      clearSubmitted();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, playerCount, wsUrl]);

  /** 展示层消息增强：seatPlayerIds/game_reset/判定牌 processing 延迟/event playback。
   *  HGC 已维护 view；这里只做渲染相关的额外处理。 */
  const handleDisplayMessage = useCallback(
    (viewerIndex: number, msg: ServerMessage) => {
      switch (msg.type) {
        case 'room_joined': {
          // 与原始 hook 一致：用 viewerIndex（循环索引）而非 msg.seatIndex 做 key
          setSeatPlayerIds((prev) => {
            const next = new Map(prev);
            next.set(viewerIndex, msg.playerId);
            return next;
          });
          break;
        }
        case 'game_reset': {
          setGameOver(null);
          setGameStarted(false);
          recorderRef.current.reset();
          for (const [, c] of clientsRef.current) {
            /* HGC 内部已重置 view */ void c;
          }
          setViews(new Map());
          clearSubmitted();
          break;
        }
        case 'event': {
          // event playback：仅当前 perspective 的事件入队
          if (msg.view) {
            playbackRef.current.enqueue([{ seq: msg.seq, event: msg.view }]);
          }
          // 判定牌 processing 延迟展示：判定牌加入 processing 几秒后移除
          if (msg.view && (msg.view.atomType ?? msg.view.type) === '判定') {
            const judgeCardId = msg.view.cardId as string | undefined;
            const judgeCard = msg.view.card as
              | { name: string; suit: string; rank: string }
              | undefined;
            if (judgeCardId) {
              setViews((prev) => {
                const v = prev.get(viewerIndex);
                if (!v) return prev;
                if (!v.cardMap[judgeCardId] && judgeCard) {
                  v.cardMap[judgeCardId] = {
                    id: judgeCardId,
                    name: judgeCard.name,
                    suit: judgeCard.suit as GameView['cardMap'][string]['suit'],
                    color: suitColor(judgeCard.suit as Suit),
                    rank: judgeCard.rank,
                    type: '基本牌',
                  };
                }
                if (v.zones && !v.zones.processing.includes(judgeCardId)) {
                  v.zones.processing.push(judgeCardId);
                }
                return new Map(prev).set(viewerIndex, v);
              });
              setTimeout(() => {
                setViews((prev) => {
                  const v = prev.get(viewerIndex);
                  if (!v?.zones) return prev;
                  const idx = v.zones.processing.indexOf(judgeCardId);
                  if (idx < 0) return prev;
                  v.zones.processing.splice(idx, 1);
                  return new Map(prev).set(viewerIndex, v);
                });
              }, JUDGE_CARD_LINGER_MS);
            }
          }
          break;
        }
        default:
          break;
      }
    },
    [clearSubmitted],
  );

  /** 发送 action：走 ownerId 对应 viewer 的连接 */
  const sendAction = useCallback(
    (action: ActionMsg) => {
      const hgc = clientByViewer(action.ownerId);
      if (!hgc) {
        log.warn('no connection for viewer', action.ownerId);
        return;
      }
      // 选将 action 发出时标记该座次已提交，乐观清除 view.pending
      if (action.actionType === '选将') {
        markSubmitted(action.ownerId);
        setViews((prev) => {
          const seatView = prev.get(action.ownerId);
          if (!seatView?.pending) return prev;
          const next = new Map(prev);
          next.set(action.ownerId, { ...seatView, pending: null });
          return next;
        });
      }
      const clientMsg: ClientMessage = {
        type: 'action',
        action: { ...action, baseSeq: hgc.lastSeq },
        baseSeq: hgc.lastSeq,
      };
      logWsMessage(action.ownerId, 'out', clientMsg);
      logUserAction('action', action);
      // HGC.sendAction 会补 pendingSeq + baseSeq
      hgc.sendAction(action as import('../../engine/types').ClientMessage);
    },
    [clientByViewer, markSubmitted],
  );

  /** 整理手牌：走当前 perspective viewer 的连接 */
  const reorderHand = useCallback(
    (order: string[]) => {
      const hgc = clientByViewer(perspectiveRef.current);
      if (!hgc) return;
      const clientMsg: ClientMessage = { type: 'reorder_hand', order };
      logWsMessage(perspectiveRef.current, 'out', clientMsg);
      logUserAction('reorder', order);
      hgc.reorderHand(order);
    },
    [clientByViewer],
  );

  const disconnectAll = useCallback(() => {
    for (const [, hgc] of clientsRef.current) {
      try {
        hgc.disconnect();
      } catch {
        /* */
      }
    }
    clientsRef.current.clear();
    setViews(new Map());
    setConnectedCount(0);
    setReconnectingCount(0);
    setRoomState(null);
    setGameStarted(false);
    setSeatPlayerIds(new Map());
  }, []);

  const getSeq = useCallback(
    (viewer: number): number => {
      return clientByViewer(viewer)?.lastSeq ?? 0;
    },
    [clientByViewer],
  );

  // ── 配置阶段方法 ──
  const sendReady = useCallback((seat: number) => {
    const hgc = clientsRef.current.get(seat);
    if (!hgc) return;
    const msg: ClientMessage = { type: 'ready' };
    logWsMessage(seat, 'out', msg);
    logUserAction('ready', seat);
    hgc.sendReady();
  }, []);

  const sendStartGame = useCallback(() => {
    const hgc = clientsRef.current.get(0);
    if (!hgc) return;
    const msg: ClientMessage = { type: 'start_game' };
    logWsMessage(0, 'out', msg);
    logUserAction('start_game', null);
    hgc.sendStartGame();
  }, []);

  const sendRestart = useCallback(() => {
    const hgc = clientsRef.current.get(0);
    if (!hgc) return;
    const msg: ClientMessage = { type: 'restart_game' };
    logWsMessage(0, 'out', msg);
    logUserAction('restart_game', null);
    hgc.sendRestart();
  }, []);

  const sendUpdateConfig = useCallback((config: import('../../server/protocol').RoomConfig) => {
    const hgc = clientsRef.current.get(0);
    if (!hgc) return;
    const msg: ClientMessage = { type: 'update_room_config', config };
    logWsMessage(0, 'out', msg);
    logUserAction('update_config', config);
    hgc.sendUpdateConfig(config);
  }, []);

  return {
    views,
    currentEvent: playback.current,
    sendAction,
    reorderHand,
    disconnectAll,
    getSeq,
    roomState,
    gameStarted,
    gameOver,
    seatPlayerIds,
    sendReady,
    sendStartGame,
    sendRestart,
    sendUpdateConfig,
    connectedCount,
    reconnectingCount,
    recorder: {
      finalize: (meta) => recorderRef.current.finalize(meta),
      hasData: () => recorderRef.current.hasData(),
    },
  };
}
