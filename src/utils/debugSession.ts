// src/utils/debugSession.ts — 调试大厅 session 持久化
//
// T10 拆分：从 DebugLobby 抽出。sessionStorage 读写只在调试大厅的
// WebSocket 消息分发中用，独立成文件便于单元测试和复用。

const STORAGE_KEY = 'debug_session';

export interface DebugSession {
  roomId: string;
  playerId: string;
}

export function storeSession(roomId: string, playerId: string) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ roomId, playerId }));
}

export function loadSession(): DebugSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}
