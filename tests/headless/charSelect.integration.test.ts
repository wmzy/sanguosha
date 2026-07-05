// tests/headless/charSelect.integration.test.ts
// @vitest-environment node
// 集成测试：验证选将 pending 的 action 枚举正确（系统规则:选将 + candidates）。
// 需 vite dev server（localhost:3930）运行，无则 skip。
import { describe, it, expect } from 'vitest';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';

const SERVER = 'ws://localhost:3930/ws';
let serverUp = false;
try {
  const net = await import('node:net');
  const socket = new net.Socket();
  serverUp = await new Promise<boolean>((resolve) => {
    socket.setTimeout(1000);
    socket.once('connect', () => {
      resolve(true);
      socket.destroy();
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      resolve(false);
      socket.destroy();
    });
    socket.connect(3930, 'localhost');
  });
} catch {
  // serverUp 保持初始值 false
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  msg = 'timeout',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(msg);
}

describe.skipIf(!serverUp)('选将流程集成', () => {
  it('选将 pending 枚举出每个候选武将的 selectChar action，且 message shape 正确', async () => {
    // 创建 2 人房
    const created = await fetch('http://localhost:3930/api/debug-room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerCount: 2 }),
    }).then((r) => r.json() as Promise<{ roomId: string }>);

    const hgc = new HeadlessGameClient(SERVER);
    const hgc1 = new HeadlessGameClient(SERVER);
    hgc.connect(created.roomId, 0);
    hgc1.connect(created.roomId, 1);
    await new Promise((r) => setTimeout(r, 500));
    hgc.sendReady();
    hgc1.sendReady();
    await new Promise((r) => setTimeout(r, 3000));
    hgc.sendStartGame();

    // 等待选将 pending 到达本座次
    await waitFor(() => !!hgc.view?.pending && hgc.needsAction(), 10000, '选将 pending 未到达');

    const actions = hgc.getAvailableActions();
    const selectActions = actions.filter((a) => a.category === 'selectChar');
    expect(selectActions.length).toBeGreaterThan(0);

    const a = selectActions[0];
    expect(a.message.skillId).toBe('系统规则');
    expect(a.message.actionType).toBe('选将');
    expect(a.message.params).toHaveProperty('character');
    expect(typeof (a.message.params as { character: unknown }).character).toBe('string');

    // view 快照里的 pending.candidates 应非空（viewProjector 投影）
    // （HGC.view 是原始 GameView，candidates 在 atom 上）
    const atom = hgc.view!.pending!.atom as { type: string; candidates?: Array<{ name: string }> };
    expect(atom.type).toBe('选将询问');
    expect(atom.candidates?.length).toBeGreaterThan(0);

    hgc.disconnect();
    hgc1.disconnect();
  }, 20000);

  it('selectCharacter 发送 系统规则:选将 并被服务端接受', async () => {
    const created = await fetch('http://localhost:3930/api/debug-room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerCount: 2 }),
    }).then((r) => r.json() as Promise<{ roomId: string }>);

    let rejected = false;
    const hgc = new HeadlessGameClient(SERVER, {
      onActionRejected: () => {
        rejected = true;
      },
    });
    const hgc1 = new HeadlessGameClient(SERVER);
    hgc.connect(created.roomId, 0);
    hgc1.connect(created.roomId, 1);
    await new Promise((r) => setTimeout(r, 500));
    hgc.sendReady();
    hgc1.sendReady();
    await new Promise((r) => setTimeout(r, 3000));
    hgc.sendStartGame();

    await waitFor(() => !!hgc.view?.pending && hgc.needsAction(), 10000, '选将 pending 未到达');

    const actions = hgc.getAvailableActions().filter((a) => a.category === 'selectChar');
    const pick = actions[0];
    // 用 selectCharacter（而非直接发 message），验证便捷方法 shape 正确
    hgc.selectCharacter((pick.message.params as { character: string }).character);

    // 短暂等待看是否被拒
    await new Promise((r) => setTimeout(r, 1500));
    expect(rejected).toBe(false);

    hgc.disconnect();
    hgc1.disconnect();
  }, 20000);
});
