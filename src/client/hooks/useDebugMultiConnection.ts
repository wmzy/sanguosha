// src/client/hooks/useDebugMultiConnection.ts
// Debug 多 WS 连接管理 hook。
//
// Debug 模型:每个座次一个独立 WS 连接,服务端无特例。
// StrictMode 安全:effect 实例管理自己的连接生命周期。
//
// N 连接 vs 1 连接:
//   N 连接:每个 viewer 独立传输,服务端按 viewer 分叉发 events,前端无需过滤
//   1 连接:所有 viewer 共享传输,服务端给所有 viewer 发 event,前端按 viewer 过滤
// 选择 N 连接:每个 viewer 是独立实体,传输层隔离更干净。

import { useState, useEffect, useRef, useCallback } from 'react';
import { viewReducer } from '../view/reducer';
import { useEventPlayback } from './useEventPlayback';
import { useMarkCharSelectSubmitted, useClearSubmittedCharSelects } from './SubmittedCharSelectCtx';
import { createLogger } from '../utils/logger';
import type { GameView, Json } from '../../engine/types';
import type { ServerMessage, ClientMessage } from '../../server/protocol';

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
  getSeq: (seat: number) => number;
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
      seat.viewer = msg.state.viewer;
      seat.lastSeq = msg.lastSeq;
      setViews(prev => {
        const next = new Map(prev);
        next.set(msg.state.viewer, msg.state);
        return next;
      });
      if (onFirstViewRef.current && seatViewer === 0) {
        onFirstViewRef.current(msg.state.viewer);
      }
    } else if (msg.type === 'event') {
      const seat = seatsRef.current.get(seatViewer);
      if (!seat?.view) return;
      // 处理 notify 事件(pendingResolved):清除该 viewer 的 view.pending
      // target 匹配或为广播型(TARGET_BROADCAST=-2)即清除。这与引擎 notifyPendingResolved 对齐。
      if (msg.notify) {
        if (msg.notify.eventType === 'pendingResolved') {
          const target = (msg.notify.data as { target?: number }).target;
          if (target !== undefined && (target === seat.viewer || target < 0) && seat.view.pending) {
            seat.view.pending = null;
          }
        }
      }
      // 处理 view 事件(atom apply):原地突变 + 权威 deadline 覆盖
      if (msg.view) {
        // 直接原地突变 seat.view——reducer(applyView)本身就是突变模型,
        // 不用 structuredClone(它在 view 含函数引用如 cardFilter.filter 时会抛 DOMException)。
        // setViews 创建新 Map 保证 React 检测到状态变更。
        viewReducer(seat.view, msg.view, msg.timestamp);
      }
      // 更新 lastSeq
      seat.lastSeq = msg.seq;
      // 权威 deadline 覆盖:pending 优先写入 view.pending,否则写入 view.deadline
      if (msg.deadline !== undefined) {
        if (msg.deadline !== null && seat.view.pending) {
          seat.view.pending.deadline = msg.deadline.deadline;
          seat.view.pending.totalMs = msg.deadline.totalMs;
        }
        // view.deadline 用于出牌/弃牌阶段(无 pending 时)
        seat.view.deadline = msg.deadline !== null ? msg.deadline.deadline : null;
        seat.view.deadlineTotalMs = msg.deadline !== null ? msg.deadline.totalMs : 0;
      }
      setViews(prev => {
        const next = new Map(prev);
        next.set(seat.viewer, seat.view!);
        return next;
      });
      if (msg.view && seat.viewer === perspectiveRef.current) {
        playbackRef.current.enqueue([{ seq: msg.seq, event: msg.view }]);
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

  /** 发送 action:走 ownerId 对应 viewer 的连接 */
  const sendAction = useCallback((action: ActionMsg) => {
    // seatsRef 按循环索引 key,遍历按实际 viewer 字段查找
    const seat = [...seatsRef.current.values()].find(s => s.viewer === action.ownerId);
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
    // 非阻塞 pending（如出牌窗口）期间主动出牌/用技不应携带 pendingSeq
    // （否则 server 会用 slot.createdSeq 校验不匹配而拒绝）
    const pending = seat.view?.pending;
    const pendingSeq = pending?.isBlocking ? seat.lastSeq : undefined;
    seat.ws.send(JSON.stringify({
      type: 'action',
      action: { ...action, baseSeq: seat.lastSeq, pendingSeq },
      baseSeq: seat.lastSeq,
    } as ClientMessage));
  }, []);

  /** 整理手牌:走当前 perspective viewer 的连接 */
  const reorderHand = useCallback((order: string[]) => {
    // seatsRef 按循环索引 key,遍历按实际 viewer 字段查找
    const seat = [...seatsRef.current.values()].find(s => s.viewer === perspectiveRef.current);
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

  const getSeq = useCallback((viewer: number): number => {
    // seatsRef 按循环索引 key,遍历按实际 viewer 字段查找
    const seat = [...seatsRef.current.values()].find(s => s.viewer === viewer);
    return seat?.lastSeq ?? 0;
  }, []);

  return {
    views,
    currentEvent: playback.current,
    sendAction,
    reorderHand,
    disconnectAll,
    getSeq,
  };
}
