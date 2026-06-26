// tests/unit/room.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { WSContext } from 'hono/ws';
import {
  createRoom,
  createDebugRoom,
  joinRoom,
  leaveRoom,
  setReady,
  allReady,
  getRoom,
  getRoomList,
  findRoomByPlayerId,
  updateConfig,
} from '../../src/server/room';
import { normalizeRoomConfig, DEFAULT_ROOM_CONFIG } from '../../src/server/protocol';
import { resolveTimeoutMs } from '../../src/engine/create-engine';
import type { GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

// Mock WebSocket context
function createMockWS(): WSContext {
  return {
    send: () => {},
    close: () => {},
  } as unknown as WSContext;
}

describe('房间管理', () => {
  beforeEach(() => {
    // 清理所有房间（通过创建新房间来测试）
  });

  it('应该创建房间', () => {
    const ws = createMockWS();
    const room = createRoom('测试房间', 4, 'host1', ws);

    expect(room.id).toBeDefined();
    expect(room.name).toBe('测试房间');
    expect(room.maxPlayers).toBe(4);
    expect(room.hostId).toBe('host1');
    expect(room.status).toBe('等待中');
    expect(room.players.size).toBe(1);
    expect(room.players.has('host1')).toBe(true);
  });

  it('应该加入房间', () => {
    const hostWS = createMockWS();
    const playerWS = createMockWS();
    const room = createRoom('测试房间', 4, 'host1', hostWS);

    const result = joinRoom(room.id, 'player1', playerWS);
    expect(result).not.toBeNull();
    expect(result!.players.size).toBe(2);
    expect(result!.players.has('player1')).toBe(true);
  });

  it('不应该加入已满的房间', () => {
    const hostWS = createMockWS();
    const room = createRoom('测试房间', 2, 'host1', hostWS);

    joinRoom(room.id, 'player1', createMockWS());
    const result = joinRoom(room.id, 'player2', createMockWS());

    expect(result).toBeNull();
  });

  it('不应该加入进行中的房间', () => {
    const hostWS = createMockWS();
    const room = createRoom('测试房间', 4, 'host1', hostWS);

    // 手动设置房间状态为进行中
    room.status = '进行中';

    const result = joinRoom(room.id, 'player1', createMockWS());
    expect(result).toBeNull();
  });

  it('应该离开房间', () => {
    const hostWS = createMockWS();
    const room = createRoom('测试房间', 4, 'host1', hostWS);

    joinRoom(room.id, 'player1', createMockWS());
    const result = leaveRoom(room.id, 'player1');

    expect(result).not.toBeNull();
    expect(result!.players.size).toBe(1);
    expect(result!.players.has('player1')).toBe(false);
  });

  it('房主离开时应该转移房主', () => {
    const hostWS = createMockWS();
    const room = createRoom('测试房间', 4, 'host1', hostWS);

    joinRoom(room.id, 'player1', createMockWS());
    const result = leaveRoom(room.id, 'host1');

    expect(result).not.toBeNull();
    expect(result!.hostId).toBe('player1');
  });

  it('所有人离开时应该删除房间', () => {
    const hostWS = createMockWS();
    const room = createRoom('测试房间', 4, 'host1', hostWS);

    const result = leaveRoom(room.id, 'host1');
    expect(result).toBeNull();
  });

  it('应该设置准备状态', () => {
    const hostWS = createMockWS();
    const room = createRoom('测试房间', 4, 'host1', hostWS);

    const result = setReady(room.id, 'host1');
    expect(result).toBe(true);
    expect(room.readyPlayers.has('host1')).toBe(true);
  });

  it('应该检查所有人是否准备', () => {
    const hostWS = createMockWS();
    const room = createRoom('测试房间', 4, 'host1', hostWS);

    joinRoom(room.id, 'player1', createMockWS());

    // 只有一个人准备
    setReady(room.id, 'host1');
    expect(allReady(room.id)).toBe(false);

    // 两人都准备
    setReady(room.id, 'player1');
    expect(allReady(room.id)).toBe(true);
  });

  it('人数不足时不应该所有人准备', () => {
    const hostWS = createMockWS();
    const room = createRoom('测试房间', 4, 'host1', hostWS);

    setReady(room.id, 'host1');
    expect(allReady(room.id)).toBe(false);
  });

  it('应该获取房间', () => {
    const hostWS = createMockWS();
    const room = createRoom('测试房间', 4, 'host1', hostWS);

    const result = getRoom(room.id);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('测试房间');
  });

  it('应该获取房间列表', () => {
    createRoom('房间1', 4, 'host1', createMockWS());
    createRoom('房间2', 2, 'host2', createMockWS());

    const list = getRoomList();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('应该根据玩家ID查找房间', () => {
    const hostWS = createMockWS();
    const uniqueId = `unique_host_${Date.now()}`;
    const room = createRoom(`唯一房间_${Date.now()}`, 4, uniqueId, hostWS);

    const result = findRoomByPlayerId(uniqueId);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(room.id);
  });
});

describe('房间配置', () => {
  it('创建普通房间应携带默认 config', () => {
    const ws = createMockWS();
    const room = createRoom('测试', 4, 'host1', ws);
    expect(room.config).toBeDefined();
    expect(room.config.timeoutScale).toBe(1);
    expect(room.config.charPool).toBe('all');
    expect(room.config.handSize).toBe(4);
    expect(room.config.name).toBe('测试');
  });

  it('创建调试房间应携带默认 config', () => {
    const room = createDebugRoom('调试', 5);
    expect(room.config).toBeDefined();
    expect(room.config.timeoutScale).toBe(1);
    expect(room.config.name).toBe('调试');
  });

  it('创建房间可传入自定义 config', () => {
    const ws = createMockWS();
    const customConfig = { name: '自定义', timeoutScale: 0.6, charPool: 'standard' as const, handSize: 5 };
    const room = createRoom('x', 4, 'h', ws, customConfig);
    expect(room.config.timeoutScale).toBe(0.6);
    expect(room.config.charPool).toBe('standard');
    expect(room.config.handSize).toBe(5);
  });

  it('updateConfig 应更新配置并同步房间名', () => {
    const ws = createMockWS();
    const room = createRoom('原名', 4, 'host1', ws);
    const updated = updateConfig(room.id, { name: '新名', timeoutScale: 2, charPool: 'standard', handSize: 3 }, 'host1');
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('新名');
    expect(updated!.timeoutScale).toBe(2);
    expect(room.config.timeoutScale).toBe(2);
    expect(room.name).toBe('新名');
  });

  it('updateConfig 普通房间仅房主可调用', () => {
    const ws = createMockWS();
    const room = createRoom('测试', 4, 'host1', ws);
    // 非房主应失败
    const result = updateConfig(room.id, { name: 'x', timeoutScale: 1, charPool: 'all', handSize: 4 }, 'other');
    expect(result).toBeNull();
  });

  it('updateConfig 调试房间任意玩家可调用', () => {
    const room = createDebugRoom('调试', 4);
    const result = updateConfig(room.id, { name: '改名', timeoutScale: 1.5, charPool: 'extended', handSize: 4 }, 'anyone');
    expect(result).not.toBeNull();
    expect(result!.timeoutScale).toBe(1.5);
  });

  it('normalizeRoomConfig 应修正非法字段', () => {
    const cfg = normalizeRoomConfig({ name: '   ', timeoutScale: -1, charPool: 'invalid', handSize: 999 });
    expect(cfg.name).toBe(DEFAULT_ROOM_CONFIG.name); // 空名回退默认
    expect(cfg.timeoutScale).toBe(1); // 非法回退默认
    expect(cfg.charPool).toBe('all'); // 非法回退默认
    expect(cfg.handSize).toBe(4); // 超范围回退默认
  });

  it('normalizeRoomConfig Infinity 表示无限时', () => {
    const cfg = normalizeRoomConfig({ name: '无限', timeoutScale: Infinity, charPool: 'all', handSize: 4 });
    expect(cfg.timeoutScale).toBe(Infinity);
  });
});

describe('resolveTimeoutMs', () => {
  it('默认 timeoutScale=1 返回原值', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    expect(resolveTimeoutMs(state, 30)).toBe(30000);
  });

  it('应用 timeoutScale 倍率', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    state.config = { timeoutScale: 0.5 };
    expect(resolveTimeoutMs(state, 30)).toBe(15000);
    state.config = { timeoutScale: 2 };
    expect(resolveTimeoutMs(state, 15)).toBe(30000);
  });

  it('Infinity 返回极大值(定时器实际不触发)', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    state.config = { timeoutScale: Infinity };
    expect(resolveTimeoutMs(state, 30)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
