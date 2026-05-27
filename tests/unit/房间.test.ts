// tests/unit/房间.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  创建房间,
  加入房间,
  离开房间,
  设置准备,
  所有人准备,
  获取房间,
  获取房间列表,
  根据玩家ID查找房间,
} from '../../server/房间';

// Mock WebSocket context
function createMockWS() {
  return {
    send: () => {},
    close: () => {},
  } as any;
}

describe('房间管理', () => {
  beforeEach(() => {
    // 清理所有房间（通过创建新房间来测试）
  });

  it('应该创建房间', () => {
    const ws = createMockWS();
    const room = 创建房间('测试房间', 4, 'host1', ws);

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
    const room = 创建房间('测试房间', 4, 'host1', hostWS);

    const result = 加入房间(room.id, 'player1', playerWS);
    expect(result).not.toBeNull();
    expect(result!.players.size).toBe(2);
    expect(result!.players.has('player1')).toBe(true);
  });

  it('不应该加入已满的房间', () => {
    const hostWS = createMockWS();
    const room = 创建房间('测试房间', 2, 'host1', hostWS);

    加入房间(room.id, 'player1', createMockWS());
    const result = 加入房间(room.id, 'player2', createMockWS());

    expect(result).toBeNull();
  });

  it('不应该加入进行中的房间', () => {
    const hostWS = createMockWS();
    const room = 创建房间('测试房间', 4, 'host1', hostWS);

    // 手动设置房间状态为进行中
    room.status = '进行中';

    const result = 加入房间(room.id, 'player1', createMockWS());
    expect(result).toBeNull();
  });

  it('应该离开房间', () => {
    const hostWS = createMockWS();
    const room = 创建房间('测试房间', 4, 'host1', hostWS);

    加入房间(room.id, 'player1', createMockWS());
    const result = 离开房间(room.id, 'player1');

    expect(result).not.toBeNull();
    expect(result!.players.size).toBe(1);
    expect(result!.players.has('player1')).toBe(false);
  });

  it('房主离开时应该转移房主', () => {
    const hostWS = createMockWS();
    const room = 创建房间('测试房间', 4, 'host1', hostWS);

    加入房间(room.id, 'player1', createMockWS());
    const result = 离开房间(room.id, 'host1');

    expect(result).not.toBeNull();
    expect(result!.hostId).toBe('player1');
  });

  it('所有人离开时应该删除房间', () => {
    const hostWS = createMockWS();
    const room = 创建房间('测试房间', 4, 'host1', hostWS);

    const result = 离开房间(room.id, 'host1');
    expect(result).toBeNull();
  });

  it('应该设置准备状态', () => {
    const hostWS = createMockWS();
    const room = 创建房间('测试房间', 4, 'host1', hostWS);

    const result = 设置准备(room.id, 'host1');
    expect(result).toBe(true);
    expect(room.readyPlayers.has('host1')).toBe(true);
  });

  it('应该检查所有人是否准备', () => {
    const hostWS = createMockWS();
    const room = 创建房间('测试房间', 4, 'host1', hostWS);

    加入房间(room.id, 'player1', createMockWS());

    // 只有一个人准备
    设置准备(room.id, 'host1');
    expect(所有人准备(room.id)).toBe(false);

    // 两人都准备
    设置准备(room.id, 'player1');
    expect(所有人准备(room.id)).toBe(true);
  });

  it('人数不足时不应该所有人准备', () => {
    const hostWS = createMockWS();
    const room = 创建房间('测试房间', 4, 'host1', hostWS);

    设置准备(room.id, 'host1');
    expect(所有人准备(room.id)).toBe(false);
  });

  it('应该获取房间', () => {
    const hostWS = createMockWS();
    const room = 创建房间('测试房间', 4, 'host1', hostWS);

    const result = 获取房间(room.id);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('测试房间');
  });

  it('应该获取房间列表', () => {
    创建房间('房间1', 4, 'host1', createMockWS());
    创建房间('房间2', 2, 'host2', createMockWS());

    const list = 获取房间列表();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('应该根据玩家ID查找房间', () => {
    const hostWS = createMockWS();
    const uniqueId = 'unique_host_' + Date.now();
    const room = 创建房间('唯一房间_' + Date.now(), 4, uniqueId, hostWS);

    const result = 根据玩家ID查找房间(uniqueId);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(room.id);
  });
});
