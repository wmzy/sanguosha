// src/hooks/useWebSocket.ts
import { useState, useCallback, useRef, useEffect } from 'react';
import type { ServerMessage, ClientMessage } from '../../server/protocol';

export interface UseWebSocketReturn {
  connected: boolean;
  messages: ServerMessage[];
  drainMessages: () => void;
  lastMessage: ServerMessage | null;
  send: (msg: ClientMessage) => void;
  connect: () => void;
  disconnect: () => void;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

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

  const drainMessages = useCallback(() => setMessages([]), []);

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
        setMessages(prev => [...prev, message]);
      } catch {
        // parse error
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

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  return { connected, messages, drainMessages, lastMessage, send, connect, disconnect };
}
