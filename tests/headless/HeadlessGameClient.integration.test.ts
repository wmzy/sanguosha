// tests/headless/HeadlessGameClient.integration.test.ts
// @vitest-environment node  // 必须用 Node 原生 WebSocket，避免 jsdom/undici 的 Event 冲突 bug
// 集成测试：需 vite dev server（localhost:3930）运行。无服务端时整体 skip。
// 验证 HGC 端到端：WS 连接 → createDebugRoom → 收到 initialView。
import { describe, it, expect } from 'vitest';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';

const SERVER = 'ws://localhost:3930/ws';

// 同步探测服务端（describe.skipIf 在顶层求值，不能用 beforeAll 异步设置）
let serverUp = false;
try {
  // 用 Node 同步 net 探测端口，避免顶层 await / 异步 fetch
  const net = await import('node:net');
  const socket = new net.Socket();
  serverUp = await new Promise<boolean>((resolve) => {
    socket.setTimeout(1000);
    socket.once('connect', () => {
      resolve(true);
      socket.destroy();
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.once('timeout', () => {
      resolve(false);
      socket.destroy();
    });
    socket.connect(3930, 'localhost');
  });
} catch {
  // serverUp 保持初始值 false
}

// describe.skipIf 需要同步布尔值；上面的顶层 await 已 settle。

describe.skipIf(!serverUp)('HeadlessGameClient 集成', () => {
  it('createDebugRoom 后收到 room_joined（playerId/roomId 填充）', async () => {
    const got: string[] = [];
    const hgc = new HeadlessGameClient(SERVER, {
      onView: (view) => {
        got.push(`view viewer=${view.viewer}`);
      },
      onRoomState: () => {
        got.push('room_state');
      },
      onError: (e) => {
        got.push(`error: ${e.message}`);
      },
    });
    hgc.createDebugRoom(2);

    // 等待 room_joined（最多 6s）
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && hgc.playerId === null) {
      await new Promise((r) => setTimeout(r, 50));
    }
    hgc.disconnect();

    expect(hgc.playerId).not.toBeNull();
    expect(hgc.roomId).not.toBeNull();
    expect(hgc.phase).not.toBe('connecting');
  }, 12000);

  it('phase 从 connecting 推进到 lobby', async () => {
    const hgc = new HeadlessGameClient(SERVER);
    expect(hgc.phase).toBe('connecting');
    hgc.createDebugRoom(2);
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && hgc.phase === 'connecting') {
      await new Promise((r) => setTimeout(r, 50));
    }
    const reachedLobby = hgc.phase !== 'connecting';
    hgc.disconnect();
    expect(reachedLobby).toBe(true);
  }, 10000);
});
