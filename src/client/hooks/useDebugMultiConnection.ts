// src/client/hooks/useDebugMultiConnection.ts
// Debug 多 WS 连接管理 hook。
//
// Debug 模型:每个座次一个独立 WS 连接(多 WS),服务端无特例。
// 本 hook 管理 N 个 WebSocket 连接的生命周期,持 views: Map<viewer, GameView>。
//
// 连接建立流程:
//   1. 前端 POST /api/debug-room 拿 roomId(playerCount 决定)
//   2. 开 N 个 WS 连接,每个发 join_debug_room,服务端 assignDebugSeat 分配座次
//   3. 每个连接收 initialView(建立 baseline)和 events(增量更新)
//   4. 按 perspective 取 views.get(perspective) 渲染
//
// action 发送:走当前 perspective 对应的连接(ownerId = perspective)。
//
// 稳定性关键:所有 callback 用空依赖 + ref 读取动态值(perspective/playback),
// 避免 callback 引用变化触发 effect 重跑 → 重连风暴。

import { useState, useEffect, useRef, useCallback } from 'react';
import { viewReducer } from '../view/reducer';
import { useEventPlayback } from './useEventPlayback';
import { createLogger } from '../utils/logger';
import type { GameView, Json, ViewEvent } from '../../engine/types';
import type { ServerMessage, GameEventEnvelope, ClientMessage } from '../../server/protocol';

const log = createLogger('useDebugMultiConnection');

/** 单个座次的连接状态 */
interface SeatConnection {
  ws: WebSocket;
  viewer: number;
  view: GameView | null;
  lastSeq: number;
  playerId: string;
}

/** 客户端发的 action(不含 baseSeq,本 hook 自动加) */
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

export function useDebugMultiConnection(
  params: UseDebugMultiConnectionParams,
): {
  views: Map<number, GameView>;
  connected: boolean;
  anyConnected: boolean;
  currentEvent: import('./useEventPlayback').QueuedEvent | null;
  sendAction: (action: ActionMsg) => void;
  reorderHand: (order: string[]) => void;
  disconnectAll: () => void;
} {
  const { roomId, playerCount, perspective, onFirstView } = params;
  const seatsRef = useRef<Map<string, SeatConnection>>(new Map());
  const [views, setViews] = useState<Map<number, GameView>>(new Map());
  const [anyConnected, setAnyConnected] = useState(false);
  const [connectedCount, setConnectedCount] = useState(0);
  const playback = useEventPlayback();

  // 动态值用 ref,避免 callback 依赖链导致重连
  const perspectiveRef = useRef(perspective);
  useEffect(() => { perspectiveRef.current = perspective; }, [perspective]);
  const playbackRef = useRef(playback);
  useEffect(() => { playbackRef.current = playback; }, [playback]);
  const onFirstViewRef = useRef(onFirstView);
  useEffect(() => { onFirstViewRef.current = onFirstView; }, [onFirstView]);

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

  /** 处理消息(稳定引用) */
  const handleMessage = useCallback((playerId: string, msg: ServerMessage) => {
    const seat = seatsRef.current.get(playerId);
    if (!seat) return;

    if (msg.type === 'initialView') {
      seat.view = msg.state;
      seat.lastSeq = msg.lastSeq;
      setViews(prev => {
        const next = new Map(prev);
        next.set(msg.viewer, structuredClone(msg.state));
        return next;
      });
      if (onFirstViewRef.current && msg.viewer === 0) {
        onFirstViewRef.current(0);
      }
    } else if (msg.type === 'events') {
      if (!seat.view) {
        log.warn('events without baseline', { viewer: seat.viewer });
        return;
      }
      const viewCopy = structuredClone(seat.view);
      const eventsToPlay: Array<{ seq: number; event: ViewEvent }> = [];
      for (const env of (msg.events as GameEventEnvelope[])) {
        if (env.viewEvent) {
          viewReducer(viewCopy, env.viewEvent);
          eventsToPlay.push({ seq: env.seq, event: env.viewEvent });
        }
      }
      if (msg.events.length > 0) {
        seat.lastSeq = msg.events[msg.events.length - 1].seq;
      }
      seat.view = viewCopy;
      setViews(prev => {
        const next = new Map(prev);
        next.set(seat.viewer, viewCopy);
        return next;
      });
      if (seat.viewer === perspectiveRef.current) {
        playbackRef.current.enqueue(eventsToPlay);
      }
    }
  }, []);

  /** 建立一个座次连接(稳定引用) */
  const connectSeat = useCallback((viewerIndex: number, targetRoomId: string) => {
    const playerId = `debug-${targetRoomId}-${viewerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ws = new WebSocket(wsUrl);
    const seat: SeatConnection = { ws, viewer: viewerIndex, view: null, lastSeq: 0, playerId };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join_debug_room', roomId: targetRoomId } as ClientMessage));
      setAnyConnected(true);
    };
    ws.onmessage = (event) => {
      try {
        handleMessage(playerId, JSON.parse(event.data as string) as ServerMessage);
      } catch (e) {
        log.warn('parse error:', e);
      }
    };
    ws.onclose = () => {
      seatsRef.current.delete(playerId);
      setConnectedCount(seatsRef.current.size);
      if (seatsRef.current.size === 0) setAnyConnected(false);
    };
    ws.onerror = () => {};

    seatsRef.current.set(playerId, seat);
    setConnectedCount(seatsRef.current.size);
  }, [wsUrl, handleMessage]);

  // roomId/playerCount 变化时建立全部连接
  useEffect(() => {
    if (!roomId || playerCount < 2) return;
    // 清旧
    for (const [, seat] of seatsRef.current) {
      try { seat.ws.close(); } catch { /* ignore */ }
    }
    seatsRef.current.clear();
    setViews(new Map());
    playbackRef.current.reset(0);

    for (let i = 0; i < playerCount; i++) {
      connectSeat(i, roomId);
    }

    return () => {
      for (const [, seat] of seatsRef.current) {
        try { seat.ws.close(); } catch { /* ignore */ }
      }
      seatsRef.current.clear();
    };
  }, [roomId, playerCount, connectSeat]);

  /** 发送 action:走 ownerId 对应的连接 */
  const sendAction = useCallback((action: ActionMsg) => {
    for (const [, seat] of seatsRef.current) {
      if (seat.viewer === action.ownerId) {
        seat.ws.send(JSON.stringify({
          type: 'action',
          action: { ...action, baseSeq: seat.lastSeq },
          baseSeq: seat.lastSeq,
        } as ClientMessage));
        return;
      }
    }
    log.warn('no connection for ownerId', { ownerId: action.ownerId });
  }, []);

  /** 整理手牌:走当前 perspective 的连接 */
  const reorderHand = useCallback((order: string[]) => {
    const p = perspectiveRef.current;
    for (const [, seat] of seatsRef.current) {
      if (seat.viewer === p) {
        seat.ws.send(JSON.stringify({ type: 'reorder_hand', order } as ClientMessage));
        return;
      }
    }
  }, []);

  /** 断开所有连接 */
  const disconnectAll = useCallback(() => {
    for (const [, seat] of seatsRef.current) {
      try { seat.ws.close(); } catch { /* ignore */ }
    }
    seatsRef.current.clear();
    setViews(new Map());
    setAnyConnected(false);
    setConnectedCount(0);
  }, []);

  return {
    views,
    connected: connectedCount >= playerCount,
    anyConnected,
    currentEvent: playback.current,
    sendAction,
    reorderHand,
    disconnectAll,
  };
}
