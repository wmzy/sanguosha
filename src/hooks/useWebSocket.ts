// src/hooks/useWebSocket.ts
import { useState, useCallback, useRef, useEffect } from 'react';
import type { ServerMessage, ClientMessage } from '../../server/protocol';
import { createLogger } from '../utils/logger';

const log = createLogger('useWebSocket');

export interface UseWebSocketReturn {
  connected: boolean;
  send: (msg: ClientMessage) => void;
  onMessage: (callback: (msg: ServerMessage) => void) => () => void;
  connect: () => void;
  disconnect: () => void;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const subscribersRef = useRef<Set<(msg: ServerMessage) => void>>(new Set());

  const cleanup = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    cleanup();
    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (mountedRef.current) setConnected(true);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const message = JSON.parse(event.data as string) as ServerMessage;
        for (const cb of subscribersRef.current) {
          cb(message);
        }
      } catch (e) {
        log.warn('failed to parse message:', e);
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;
      reconnectRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, 3000);
    };

    ws.onerror = () => {};

    wsRef.current = ws;
  }, [url, cleanup]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const onMessage = useCallback((callback: (msg: ServerMessage) => void) => {
    subscribersRef.current.add(callback);
    return () => {
      subscribersRef.current.delete(callback);
    };
  }, []);

  const disconnect = useCallback(() => {
    cleanup();
    setConnected(false);
  }, [cleanup]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect]);

  return { connected, send, onMessage, connect, disconnect };
}
