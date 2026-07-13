// tests/ai-mcp/lobby.test.ts
// 大厅编排单测：建房/加入/房主等待开局/非房主等待/超时。
import { describe, it, expect, vi } from 'vitest';
import { joinAndStartRoom } from '../../src/ai-mcp/lobby';
import type { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import type { ClientPhase } from '../../src/client/headless/types';
import type { RoomState } from '../../src/client/headless/types';

const fullReady2p: RoomState = {
  readyPlayers: ['p-host', 'p2'],
  playerIds: ['p-host', 'p2'],
  hostId: 'p-host',
  maxPlayers: 2,
  config: { name: '测试', timeoutScale: 1, charPool: 'all', handSize: 4, chat: { enabled: true, whitelistOnly: false, whitelist: [], maxPerGame: 0, maxPerMinute: 5, maxChars: 30 } },
  spectatorIds: [],
  viewGrants: {},
  pendingViewRequests: {},
};

/**
 * 可编程 fake HGC：内部状态随事件推进。
 *   - createRoom/joinRoom 后：_joined=true（playerId 已就绪）
 *   - sendReady 后：roomState 变为全员就绪（模拟服务端广播）
 *   - sendStartGame 后：phase→playing（模拟开局）
 * 这样 lobby 的同步轮询 getter 能自然推进，无需手动控时。
 */
function makeFakeHgc(opts: {
  playerId: string;
  roomId: string;
  isHost: boolean;
}): HeadlessGameClient {
  const state = {
    _joined: false,
    _ready: false,
    _started: false,
    _playerId: opts.playerId,
    _roomId: opts.roomId,
    _roomState: null as RoomState | null,
  };
  const host = opts.isHost ? opts.playerId : 'someone-else';
  return {
    get playerId() {
      return state._joined ? state._playerId : null;
    },
    get roomId() {
      return state._roomId;
    },
    get roomState() {
      return state._roomState;
    },
    get phase() {
      return (state._started ? 'playing' : 'lobby') as ClientPhase;
    },
    createRoom: vi.fn(() => {
      state._joined = true;
    }),
    joinRoom: vi.fn(() => {
      state._joined = true;
    }),
    sendReady: vi.fn(() => {
      state._ready = true;
      // 模拟服务端广播全员就绪
      state._roomState = { ...fullReady2p, hostId: host };
      // 非房主:模拟远程房主随后开局(异步推进 phase→playing)
      if (!opts.isHost) {
        setTimeout(() => {
          state._started = true;
        }, 20);
      }
    }),
    sendStartGame: vi.fn(() => {
      state._started = true;
    }),
    disconnect: vi.fn(),
  } as unknown as HeadlessGameClient;
}

describe('joinAndStartRoom', () => {
  it('create 模式：建房→准备→房主开局→playing', async () => {
    const hgc = makeFakeHgc({ playerId: 'p-host', roomId: 'ROOM1', isHost: true });
    const res = await joinAndStartRoom(hgc, {
      mode: 'create',
      name: '测试',
      maxPlayers: 2,
      readyTimeoutMs: 1000,
    });

    expect(hgc.createRoom).toHaveBeenCalledWith('测试', 2, undefined, undefined);
    expect(hgc.sendReady).toHaveBeenCalled();
    expect(hgc.sendStartGame).toHaveBeenCalled();
    expect(res.isHost).toBe(true);
    expect(res.roomId).toBe('ROOM1');
    expect(res.playerId).toBe('p-host');
    expect(res.phase).toBe('playing');
  });

  it('join 模式：加入→准备→非房主等待开局', async () => {
    const hgc = makeFakeHgc({ playerId: 'p2', roomId: 'ROOM2', isHost: false });
    const res = await joinAndStartRoom(hgc, {
      mode: 'join',
      roomId: 'ROOM2',
      playerId: 'p2',
      readyTimeoutMs: 1000,
    });

    expect(hgc.joinRoom).toHaveBeenCalledWith('ROOM2', 'p2');
    expect(hgc.sendReady).toHaveBeenCalled();
    // 非房主不发 start（fake 的 sendStartGame 仍会被调以推进 phase 到 playing，
    // 但 lobby 里 isHost=false 时不调用 hgc.sendStartGame）
    expect(hgc.sendStartGame).not.toHaveBeenCalled();
    expect(res.isHost).toBe(false);
    expect(res.phase).toBe('playing');
  });

  it('join 模式缺 roomId 抛错', async () => {
    const hgc = makeFakeHgc({ playerId: 'p', roomId: 'R', isHost: false });
    await expect(
      joinAndStartRoom(hgc, { mode: 'join', readyTimeoutMs: 100 } as never),
    ).rejects.toThrow('roomId');
  });

  it('等待全员就绪超时：phase 返回 lobby，不抛错', async () => {
    const hgc = makeFakeHgc({ playerId: 'p-host', roomId: 'ROOM3', isHost: true });
    // 覆盖 sendReady：不设置 roomState（永远未就绪）
    (hgc as unknown as { sendReady: ReturnType<typeof vi.fn> }).sendReady = vi.fn(() => {});
    const res = await joinAndStartRoom(hgc, { mode: 'create', readyTimeoutMs: 120 });

    expect(res.phase).toBe('lobby');
    expect(hgc.sendStartGame).not.toHaveBeenCalled();
  });

  it('create 模式默认房间名（不传 name 时自动生成非空名）', async () => {
    const hgc = makeFakeHgc({ playerId: 'p-host', roomId: 'ROOM4', isHost: true });
    await joinAndStartRoom(hgc, { mode: 'create', readyTimeoutMs: 1000 });
    const args = (hgc.createRoom as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof args[0]).toBe('string');
    expect(args[0].length).toBeGreaterThan(0);
  });
}, 20000);
