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
    await hgc.createDebugRoom(2);
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
    await hgc.createDebugRoom(2);
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && hgc.phase === 'connecting') {
      await new Promise((r) => setTimeout(r, 50));
    }
    const reachedLobby = hgc.phase !== 'connecting';
    hgc.disconnect();
    expect(reachedLobby).toBe(true);
  }, 10000);

  // 回归：房间已开局时点「准备」必须上报错误，而不是静默吞掉（用户报告的「点击无响应」）。
  it('已开局房间 sendReady → onError 收到明确错误', async () => {
    const errors: string[] = [];
    const hgc = new HeadlessGameClient(SERVER, {
      onError: (e) => {
        errors.push(e.message);
      },
    });
    await hgc.createDebugRoom(2);
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && hgc.playerId === null) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(hgc.playerId).not.toBeNull();

    // 开局（debug 房间任意座次可触发，跳过 allReady）
    await hgc.sendStartGame();
    // 等房间进入进行中（start 同步返回后 status 已变，直接继续）

    // 已开局房间点准备：应触发 onError 而非静默
    errors.length = 0;
    await hgc.sendReady();
    await new Promise((r) => setTimeout(r, 300));
    hgc.disconnect();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('开局');
  }, 12000);
});
