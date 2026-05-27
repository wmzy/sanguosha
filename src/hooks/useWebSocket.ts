// src/hooks/useWebSocket.ts
import { useState, useCallback, useRef, useEffect } from 'react';
import type { ServerMessage, ClientMessage } from '../../server/协议';

export interface UseWebSocketReturn {
  connected: boolean;
  lastMessage: ServerMessage | null;
  send: (msg: ClientMessage) => void;
  connect: () => void;
  disconnect: () => void;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
      console.log('WebSocket 已连接');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as ServerMessage;
        setLastMessage(message);
      } catch (e) {
        console.error('解析消息失败:', e);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      console.log('WebSocket 已断开');

      // 自动重连
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('尝试重新连接...');
        connect();
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket 错误:', error);
    };

    wsRef.current = ws;
  }, [url]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.error('WebSocket 未连接');
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return { connected, lastMessage, send, connect, disconnect };
}
