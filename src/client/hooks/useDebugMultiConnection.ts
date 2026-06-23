// src/client/hooks/useDebugMultiConnection.ts
// Debug 多 WS 连接管理 hook。
//
// Debug 模型:每个座次一个独立 WS 连接,服务端无特例。
// StrictMode 安全:effect 实例管理自己的连接生命周期。
//
// N 连接 vs 1 连接:
//   N 连接:每个 viewer 独立传输,服务端按 viewer 分叉发 events,前端无需过滤
//   1 连接:所有 viewer 共享传输,服务端给所有 viewer 发 events,前端按 viewer 过滤
// 选择 N 连接:每个 viewer 是独立实体,传输层隔离更干净。

import { useState, useEffect, useRef, useCallback } from 'react';
import { viewReducer, applyNotify } from '../view/reducer';
import { useEventPlayback } from './useEventPlayback';
import { useMarkCharSelectSubmitted, useClearSubmittedCharSelects } from './SubmittedCharSelectCtx';
import { createLogger } from '../utils/logger';
import type { GameView, Json, ViewEvent } from '../../engine/types';
import type { ServerMessage, GameEventEnvelope, ClientMessage } from '../../server/protocol';

const log = createLogger('useDebugMultiConnection');

export interface ActionMsg {
  skillId: string;
  actionType: string;
  ownerId: number;
  params: Record<string, Json>;
  preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>;
}

export interface UseDebugMultiConnectionParams {
  roomId: string;
  playerCount: number;
  perspective: number;
  onFirstView?: (viewer: number) => void;
}

interface SeatInfo {
  ws: WebSocket;
  viewer: number;
  view: GameView | null;
  lastSeq: number;
}

export function useDebugMultiConnection(
  params: UseDebugMultiConnectionParams,
): {
  views: Map<number, GameView>;
  currentEvent: import('./useEventPlayback').QueuedEvent | null;
  sendAction: (action: ActionMsg) => void;
  reorderHand: (order: string[]) => void;
  disconnectAll: () => void;
} {
  const { roomId, playerCount, perspective } = params;
  // 座次 → 连接信息(key = viewer index)
  const seatsRef = useRef<Map<number, SeatInfo>>(new Map());
  const [views, setViews] = useState<Map<number, GameView>>(new Map());
  const [connectedCount, setConnectedCount] = useState(0);
  const playback = useEventPlayback();
  const playbackRef = useRef(playback);
  useEffect(() => { playbackRef.current = playback; }, [playback]);
  const perspectiveRef = useRef(perspective);
  useEffect(() => { perspectiveRef.current = perspective; }, [perspective]);
  const onFirstViewRef = useRef(params.onFirstView);
  useEffect(() => { onFirstViewRef.current = params.onFirstView; }, [params.onFirstView]);
  const markSubmitted = useMarkCharSelectSubmitted();
  const clearSubmitted = useClearSubmittedCharSelects();

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

  /** 处理消息(稳定引用,通过 ref 读动态值) */
  const handleMessage = useCallback((seatViewer: number, msg: ServerMessage) => {
    if (msg.type === 'initialView') {
      const seat = seatsRef.current.get(seatViewer);
      if (!seat) return;
      seat.view = msg.state;
      seat.lastSeq = msg.lastSeq;
      setViews(prev => {
        const next = new Map(prev);
        next.set(msg.viewer, msg.state);
        return next;
      });
      if (onFirstViewRef.current && msg.viewer === 0) {
        onFirstViewRef.current(0);
      }
    } else if (msg.type === 'events') {
      const seat = seatsRef.current.get(seatViewer);
      if (!seat?.view) return;
      // 直接原地突变 seat.view——reducer(applyView/applyNotify)本身就是突变模型,
      // 不用 structuredClone(它在 view 含函数引用如 cardFilter.filter 时会抛 DOMException)。
      // setViews 创建新 Map 保证 React 检测到状态变更。
      const eventsToPlay: Array<{ seq: number; event: ViewEvent }> = [];
      for (const env of (msg.events as GameEventEnvelope[])) {
        if (env.viewEvent) {
          viewReducer(seat.view, env.viewEvent);
          eventsToPlay.push({ seq: env.seq, event: env.viewEvent });
        }
        if (env.notify) {
          applyNotify(seat.view, env.notify);
        }
      }
      if (msg.events.length > 0) {
        seat.lastSeq = msg.events[msg.events.length - 1].seq;
      }
      // events 消息携带权威 pending 倒计时 → 覆盖 applyView 的 fallback 值
      if (msg.pending !== undefined && msg.pending !== null && seat.view.pending) {
        seat.view.pending.deadline = msg.pending.deadline;
        seat.view.pending.totalMs = msg.pending.totalMs;
      }
      // turnDeadline 权威下发
      if (msg.turnDeadline !== undefined) {
        seat.view.turnDeadline = msg.turnDeadline;
        if (msg.turnTotalMs !== undefined) {
          seat.view.turnTotalMs = msg.turnTotalMs;
        }
      }
      setViews(prev => {
        const next = new Map(prev);
        next.set(msg.viewer, seat.view!);
        return next;
      });
      if (msg.viewer === perspectiveRef.current) {
        playbackRef.current.enqueue(eventsToPlay);
      }
    } else if (msg.type === 'actionRejected') {
      log.warn('action rejected for viewer', seatViewer);
    }
  }, []);

  // N 连接:StrictMode 安全
  useEffect(() => {
    if (!roomId || playerCount < 2) return;
    seatsRef.current.clear();
    setViews(new Map());
    playbackRef.current.reset(0);
    setConnectedCount(0);

    // StrictMode 安全:cleanup 后不再发 join,避免幽灵连接占用座次
    let cancelled = false;

    const cleanups: Array<() => void> = [];
    for (let i = 0; i < playerCount; i++) {
      const viewerIndex = i;
      const ws = new WebSocket(wsUrl);
      const seat: SeatInfo = { ws, viewer: viewerIndex, view: null, lastSeq: 0 };
      seatsRef.current.set(viewerIndex, seat);

      ws.onopen = () => {
        if (cancelled) { try { ws.close(); } catch { /* */ } return; }
        ws.send(JSON.stringify({ type: 'join_debug_room', roomId } as ClientMessage));
        setConnectedCount(prev => prev + 1);
      };
      ws.onmessage = (event) => {
        if (cancelled) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerMessage;
        } catch (e) {
          log.warn('JSON 解析失败:', e);
          return;
        }
        // handleMessage 的异常不吞掉——让它在 console 显示完整错误信息,
        // 而不是伪装成无害的 'parse error' 导致问题难以排查。
        handleMessage(viewerIndex, msg);
      };
      ws.onclose = () => {
        setConnectedCount(prev => Math.max(0, prev - 1));
      };
      ws.onerror = () => {};

      cleanups.push(() => { try { ws.close(); } catch { /* */ } });
    }

    return () => {
      cancelled = true;
      for (const c of cleanups) c();
      clearSubmitted();
    };
  }, [roomId, playerCount, wsUrl, handleMessage]);

  /** 发送 action:走 ownerId 对应的连接 */
  const sendAction = useCallback((action: ActionMsg) => {
    const seat = seatsRef.current.get(action.ownerId);
    if (!seat || seat.ws.readyState !== WebSocket.OPEN) {
      log.warn('no open connection for viewer', action.ownerId);
      return;
    }
    // 选将 action 发出时标记该座次已提交,乐观清除 view.pending
    // (防止 pendingResolved 延迟导致重选 UI,同时让 isWaitingToSelect 返回 false)
    if (action.actionType === '选将') {
      markSubmitted(action.ownerId);
      if (seat.view?.pending) {
        seat.view.pending = null;
        setViews(prev => {
          const next = new Map(prev);
          next.set(action.ownerId, seat.view!);
          return next;
        });
      }
    }
    // respond action 携带 pendingSeq（当前 view.pending 对应的窗口 seq）
    const pendingSeq = seat.view?.pending ? seat.lastSeq : undefined;
    seat.ws.send(JSON.stringify({
      type: 'action',
      action: { ...action, baseSeq: seat.lastSeq, pendingSeq },
      baseSeq: seat.lastSeq,
    } as ClientMessage));
  }, []);

  /** 整理手牌:走当前 perspective 的连接 */
  const reorderHand = useCallback((order: string[]) => {
    const seat = seatsRef.current.get(perspectiveRef.current);
    if (!seat || seat.ws.readyState !== WebSocket.OPEN) return;
    seat.ws.send(JSON.stringify({ type: 'reorder_hand', order } as ClientMessage));
  }, []);

  const disconnectAll = useCallback(() => {
    for (const [, seat] of seatsRef.current) {
      try { seat.ws.close(); } catch { /* */ }
    }
    seatsRef.current.clear();
    setViews(new Map());
    setConnectedCount(0);
  }, []);

  return {
    views,
    currentEvent: playback.current,
    sendAction,
    reorderHand,
    disconnectAll,
  };
}
