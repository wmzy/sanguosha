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
import { viewReducer } from '../view/reducer';
import { useEventPlayback } from './useEventPlayback';
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
  connected: boolean;
  anyConnected: boolean;
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
        next.set(msg.viewer, structuredClone(msg.state));
        return next;
      });
      if (onFirstViewRef.current && msg.viewer === 0) {
        onFirstViewRef.current(0);
      }
    } else if (msg.type === 'events') {
      const seat = seatsRef.current.get(seatViewer);
      if (!seat?.view) return;
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
        next.set(msg.viewer, viewCopy);
        return next;
      });
      if (msg.viewer === perspectiveRef.current) {
        playbackRef.current.enqueue(eventsToPlay);
      }
    }
  }, []);

  // N 连接:StrictMode 安全
  useEffect(() => {
    if (!roomId || playerCount < 2) return;
    seatsRef.current.clear();
    setViews(new Map());
    playbackRef.current.reset(0);
    setConnectedCount(0);

    const cleanups: Array<() => void> = [];
    for (let i = 0; i < playerCount; i++) {
      const viewerIndex = i;
      const playerId = `debug-${roomId}-${viewerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ws = new WebSocket(wsUrl);
      const seat: SeatInfo = { ws, viewer: viewerIndex, view: null, lastSeq: 0 };
      seatsRef.current.set(viewerIndex, seat);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_debug_room', roomId } as ClientMessage));
        setConnectedCount(prev => prev + 1);
      };
      ws.onmessage = (event) => {
        try {
          handleMessage(viewerIndex, JSON.parse(event.data as string) as ServerMessage);
        } catch (e) {
          log.warn('parse error:', e);
        }
      };
      ws.onclose = () => {
        setConnectedCount(prev => Math.max(0, prev - 1));
      };
      ws.onerror = () => {};

      cleanups.push(() => { try { ws.close(); } catch { /* */ } });
    }

    return () => { for (const c of cleanups) c(); };
  }, [roomId, playerCount, wsUrl, handleMessage]);

  /** 发送 action:走 ownerId 对应的连接 */
  const sendAction = useCallback((action: ActionMsg) => {
    const seat = seatsRef.current.get(action.ownerId);
    if (!seat || seat.ws.readyState !== WebSocket.OPEN) {
      log.warn('no open connection for viewer', action.ownerId);
      return;
    }
    seat.ws.send(JSON.stringify({
      type: 'action',
      action: { ...action, baseSeq: seat.lastSeq },
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
    connected: connectedCount >= playerCount,
    anyConnected: connectedCount > 0,
    currentEvent: playback.current,
    sendAction,
    reorderHand,
    disconnectAll,
  };
}
