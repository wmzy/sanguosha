// tests/ai-mcp/lobby.test.ts
// 大厅编排单测：生产路径 joinAndReady(建/加入+准备) 与 createLobbyAdvancer(房主开局推进)。
import { describe, it, expect, vi } from 'vitest';
import { joinAndReady, createLobbyAdvancer } from '../../src/ai-mcp/lobby';
import type { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import type { ClientPhase } from '../../src/client/headless/types';
import type { RoomState } from '../../src/client/headless/types';
import type { RoomConfig } from '../../src/server/protocol';

const fullReady2p: RoomState = {
  readyPlayers: ['p-host', 'p2'],
  playerIds: ['p-host', 'p2'],
  hostId: 'p-host',
  maxPlayers: 2,
  config: { name: '测试', timeoutSec: 30, charPool: 'all', handSize: 4, chat: { enabled: true, whitelistOnly: false, whitelist: [], maxPerGame: 0, maxPerMinute: 5, maxChars: 30 }, gameMode: '身份局' },
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

describe('joinAndReady', () => {
  it('create 模式：建房→准备→返回房主身份', async () => {
    const hgc = makeFakeHgc({ playerId: 'p-host', roomId: 'ROOM1', isHost: true });
    const res = await joinAndReady(hgc, {
      mode: 'create',
      name: '测试',
      maxPlayers: 2,
    });

    expect(hgc.createRoom).toHaveBeenCalledWith('测试', 2, undefined, undefined);
    expect(hgc.sendReady).toHaveBeenCalledTimes(1);
    // joinAndReady 不等开局(分阶段编排:先 ready 返回,把房间码分享给他人)
    expect(hgc.sendStartGame).not.toHaveBeenCalled();
    expect(res).toEqual({ roomId: 'ROOM1', playerId: 'p-host', isHost: true });
  });

  it('join 模式：入房→准备→返回非房主身份', async () => {
    const hgc = makeFakeHgc({ playerId: 'p2', roomId: 'ROOM2', isHost: false });
    const res = await joinAndReady(hgc, {
      mode: 'join',
      roomId: 'ROOM2',
      playerId: 'p2',
    });

    expect(hgc.joinRoom).toHaveBeenCalledWith('ROOM2', 'p2');
    expect(hgc.sendReady).toHaveBeenCalledTimes(1);
    expect(hgc.sendStartGame).not.toHaveBeenCalled();
    expect(res).toEqual({ roomId: 'ROOM2', playerId: 'p2', isHost: false });
  });

  it('join 模式缺 roomId 抛错', async () => {
    const hgc = makeFakeHgc({ playerId: 'p', roomId: 'R', isHost: false });
    await expect(
      joinAndReady(hgc, { mode: 'join' } as never),
    ).rejects.toThrow('roomId');
  });

  it('create 模式默认房间名（不传 name 时自动生成非空名）', async () => {
    const hgc = makeFakeHgc({ playerId: 'p-host', roomId: 'ROOM4', isHost: true });
    await joinAndReady(hgc, { mode: 'create' });
    const args = (hgc.createRoom as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof args[0]).toBe('string');
    expect(args[0].length).toBeGreaterThan(0);
  });
});

/** 通用房间配置样本(makeAdvancerHgc 等测试夹具共用)。 */
const BASE_CONFIG: RoomConfig = {
  name: '测试房',
  timeoutSec: 30,
  charPool: 'all',
  handSize: 4,
  gameMode: '身份局',
  chat: { enabled: true, whitelistOnly: false, whitelist: [], maxPerGame: 0, maxPerMinute: 5, maxChars: 30 },
};

/** 专测 createLobbyAdvancer 的 fake HGC：可控 phase/playerId/hostId/ready。 */
function makeAdvancerHgc(opts: {
  phase: ClientPhase;
  playerId: string;
  hostId: string;
  ready: boolean;
}): { hgc: HeadlessGameClient; sendStartGame: ReturnType<typeof vi.fn> } {
  const players = ['p-a', 'p-b'];
  if (!players.includes(opts.playerId)) players[0] = opts.playerId;
  const sendStartGame = vi.fn(async () => {});
  return {
    hgc: {
      get phase() {
        return opts.phase;
      },
      get playerId() {
        return opts.playerId;
      },
      get roomState() {
        return {
          readyPlayers: opts.ready ? players : [opts.hostId],
          playerIds: players,
          hostId: opts.hostId,
          maxPlayers: 2,
          config: BASE_CONFIG,
          spectatorIds: [],
          viewGrants: {},
          pendingViewRequests: {},
        } as RoomState;
      },
      sendStartGame,
    } as unknown as HeadlessGameClient,
    sendStartGame,
  };
}

describe('createLobbyAdvancer', () => {
  it('房主 + 全员就绪：调用一次发 startGame', () => {
    const { hgc, sendStartGame } = makeAdvancerHgc({
      phase: 'lobby',
      playerId: 'p-host',
      hostId: 'p-host',
      ready: true,
    });
    createLobbyAdvancer(hgc)();
    expect(sendStartGame).toHaveBeenCalledTimes(1);
  });

  it('幂等：多次调用只发一次 startGame（避免 phase 切换前重复发送）', () => {
    const { hgc, sendStartGame } = makeAdvancerHgc({
      phase: 'lobby',
      playerId: 'p-host',
      hostId: 'p-host',
      ready: true,
    });
    const advance = createLobbyAdvancer(hgc);
    advance();
    advance();
    advance();
    expect(sendStartGame).toHaveBeenCalledTimes(1);
  });

  it('非房主 + 全员就绪：不发 startGame', () => {
    const { hgc, sendStartGame } = makeAdvancerHgc({
      phase: 'lobby',
      playerId: 'p-guest',
      hostId: 'p-host',
      ready: true,
    });
    createLobbyAdvancer(hgc)();
    expect(sendStartGame).not.toHaveBeenCalled();
  });

  it('未全员就绪：不发 startGame', () => {
    const { hgc, sendStartGame } = makeAdvancerHgc({
      phase: 'lobby',
      playerId: 'p-host',
      hostId: 'p-host',
      ready: false,
    });
    createLobbyAdvancer(hgc)();
    expect(sendStartGame).not.toHaveBeenCalled();
  });


  it('minPlayers 未到齐：即便当前已加入者全部就绪也不开局', () => {
    const { hgc, sendStartGame } = makeAdvancerHgc({
      phase: 'lobby',
      playerId: 'p-host',
      hostId: 'p-host',
      ready: true,
    });
    createLobbyAdvancer(hgc, { minPlayers: 5 })();
    expect(sendStartGame).not.toHaveBeenCalled();
  });

  it('minPlayers 到齐且全员就绪：开局', () => {
    const sendStartGame = vi.fn(async () => {});
    let size = 2;
    const hgc = {
      get phase() {
        return 'lobby' as ClientPhase;
      },
      get playerId() {
        return 'p-host';
      },
      get roomState() {
        const playerIds = Array.from({ length: size }, (_, i) => `p${i}`);
        return {
          readyPlayers: [...playerIds],
          playerIds,
          hostId: 'p-host',
          maxPlayers: 5,
          config: BASE_CONFIG,
          spectatorIds: [],
          viewGrants: {},
          pendingViewRequests: {},
        } as RoomState;
      },
      sendStartGame,
    } as unknown as HeadlessGameClient;
    const advance = createLobbyAdvancer(hgc, { minPlayers: 5 });
    advance();
    expect(sendStartGame).not.toHaveBeenCalled();
    size = 5;
    advance();
    expect(sendStartGame).toHaveBeenCalledTimes(1);
  });

  it('已进入 playing：不发 startGame', () => {
    const { hgc, sendStartGame } = makeAdvancerHgc({
      phase: 'playing',
      playerId: 'p-host',
      hostId: 'p-host',
      ready: true,
    });
    createLobbyAdvancer(hgc)();
    expect(sendStartGame).not.toHaveBeenCalled();
  });
});
