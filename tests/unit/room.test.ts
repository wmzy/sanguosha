// tests/unit/room.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRoom,
  createDebugRoom,
  joinRoom,
  leaveRoom,
  setReady,
  unsetReady,
  allReady,
  getRoom,
  getRoomList,
  findRoomByPlayerId,
  updateConfig,
  setRoomStatus,
  setSessionChecker,
  joinAsSpectator,
  removeSpectator,
  switchRole,
  requestView,
  approveView,
  rejectView,
  revokeView,
  broadcastMessage,
  addChatMessage,
  getChatHistory,
  resetChatUsage,
} from '../../src/server/room';
import { normalizeRoomConfig, DEFAULT_ROOM_CONFIG } from '../../src/server/protocol';
import { resolveTimeoutMs } from '../../src/engine/create-engine';
import type { GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import type { ConnectionSink } from '../../src/server/connection';

// Mock connection sink
function createMockSink(): ConnectionSink {
  return {
    send: () => {},
    close: () => {},
    isAlive: true,
  };
}

describe('房间管理', () => {
  beforeEach(() => {
    // 清理所有房间（通过创建新房间来测试）
  });

  it('应该创建房间', () => {
    const sink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', sink);

    expect(room.id).toBeDefined();
    expect(room.name).toBe('测试房间');
    expect(room.maxPlayers).toBe(4);
    expect(room.hostId).toBe('host1');
    expect(room.status).toBe('等待中');
    expect(room.players.size).toBe(1);
    expect(room.players.has('host1')).toBe(true);
  });

  it('应该加入房间', () => {
    const hostSink = createMockSink();
    const playerSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);

    const result = joinRoom(room.id, 'player1', playerSink);
    expect(result).not.toBeNull();
    expect(result!.players.size).toBe(2);
    expect(result!.players.has('player1')).toBe(true);
  });

  it('不应该加入已满的房间', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 2, 'host1', hostSink);

    joinRoom(room.id, 'player1', createMockSink());
    const result = joinRoom(room.id, 'player2', createMockSink());

    expect(result).toBeNull();
  });

  it('不应该加入进行中的房间', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);

    // 手动设置房间状态为进行中
    room.status = '进行中';

    const result = joinRoom(room.id, 'player1', createMockSink());
    expect(result).toBeNull();
  });

  it('应该离开房间', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);

    joinRoom(room.id, 'player1', createMockSink());
    const result = leaveRoom(room.id, 'player1');

    expect(result).not.toBeNull();
    expect(result!.players.size).toBe(1);
    expect(result!.players.has('player1')).toBe(false);
  });

  it('房主离开时应该转移房主', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);

    joinRoom(room.id, 'player1', createMockSink());
    const result = leaveRoom(room.id, 'host1');

    expect(result).not.toBeNull();
    expect(result!.hostId).toBe('player1');
  });

  it('所有人离开时应该删除房间', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);

    const result = leaveRoom(room.id, 'host1');
    expect(result).toBeNull();
  });

  it('应该设置准备状态', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);

    const result = setReady(room.id, 'host1');
    expect(result).toBe(true);
    expect(room.readyPlayers.has('host1')).toBe(true);
  });

  it('应该检查所有人是否准备', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);

    joinRoom(room.id, 'player1', createMockSink());

    // 只有一个人准备
    setReady(room.id, 'host1');
    expect(allReady(room.id)).toBe(false);

    // 两人都准备
    setReady(room.id, 'player1');
    expect(allReady(room.id)).toBe(true);
  });

  it('人数不足时不应该所有人准备', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);

    setReady(room.id, 'host1');
    expect(allReady(room.id)).toBe(false);
  });

  it('应该取消准备状态', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);

    joinRoom(room.id, 'player1', createMockSink());
    setReady(room.id, 'host1');
    setReady(room.id, 'player1');
    expect(allReady(room.id)).toBe(true);

    // 取消准备后不再是全员就绪
    const deleted = unsetReady(room.id, 'player1');
    expect(deleted).toBe(true);
    expect(room.readyPlayers.has('player1')).toBe(false);
    expect(allReady(room.id)).toBe(false);

    // 再次取消已取消的玩家返回 false
    const again = unsetReady(room.id, 'player1');
    expect(again).toBe(false);
  });

  it('游戏进行中不应该取消准备', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);
    setReady(room.id, 'host1');

    room.status = '进行中';
    expect(unsetReady(room.id, 'host1')).toBe(false);
    expect(room.readyPlayers.has('host1')).toBe(true);
  });

  it('应该获取房间', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);

    const result = getRoom(room.id);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('测试房间');
  });

  it('应该获取房间列表', () => {
    createRoom('房间1', 4, 'host1', createMockSink());
    createRoom('房间2', 2, 'host2', createMockSink());

    const list = getRoomList();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('应该根据玩家ID查找房间', () => {
    const hostSink = createMockSink();
    const uniqueId = `unique_host_${Date.now()}`;
    const room = createRoom(`唯一房间_${Date.now()}`, 4, uniqueId, hostSink);

    const result = findRoomByPlayerId(uniqueId);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(room.id);
  });

  it('等待中的多人房间无 session 仍可被发现(多人模式加入)', () => {
    // 注册一个返回 false 的 checker(模拟无 session)
    setSessionChecker(() => false);
    const room = createRoom('多人房-待加入', 4, 'host-mp', createMockSink());

    const list = getRoomList('multiplayer');
    const found = list.find((r) => r.id === room.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe('等待中');

    // 恢复默认 checker
    setSessionChecker(null);
  });

  it('进行中的房间无 session 不应可见', () => {
    setSessionChecker(() => false);
    const room = createRoom('多人房-进行中', 4, 'host-mp2', createMockSink());
    setRoomStatus(room.id, '进行中');

    const list = getRoomList('multiplayer');
    const found = list.find((r) => r.id === room.id);
    expect(found).toBeUndefined();

    setSessionChecker(null);
  });

  it('multiplayer 过滤排除 debug 房间', () => {
    const mpRoom = createRoom('多人房', 4, 'host-mp3', createMockSink());
    createDebugRoom('调试房', 4);

    const list = getRoomList('multiplayer');
    expect(list.some((r) => r.id === mpRoom.id)).toBe(true);
    expect(list.every((r) => !r.isDebug)).toBe(true);
  });
});

describe('房间配置', () => {
  it('创建普通房间应携带默认 config', () => {
    const sink = createMockSink();
    const room = createRoom('测试', 4, 'host1', sink);
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
    const sink = createMockSink();
    const customConfig = {
      name: '自定义',
      timeoutScale: 0.6,
      charPool: 'standard' as const,
      handSize: 5,
      chat: { enabled: false, whitelistOnly: false, whitelist: [], maxPerGame: 0, maxPerMinute: 5, maxChars: 30 },
    };
    const room = createRoom('x', 4, 'h', sink, customConfig);
    expect(room.config.timeoutScale).toBe(0.6);
    expect(room.config.charPool).toBe('standard');
    expect(room.config.handSize).toBe(5);
  });

  it('updateConfig 应更新配置并同步房间名', () => {
    const sink = createMockSink();
    const room = createRoom('测试', 4, 'host1', sink);
    const updated = updateConfig(
      room.id,
      { name: '新名', timeoutScale: 2, charPool: 'standard', handSize: 3 },
      'host1',
    );
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('新名');
    expect(updated!.timeoutScale).toBe(2);
    expect(room.config.timeoutScale).toBe(2);
    expect(room.name).toBe('新名');
  });

  it('updateConfig 普通房间仅房主可调用', () => {
    const sink = createMockSink();
    const room = createRoom('测试', 4, 'host1', sink);
    // 非房主应失败
    const result = updateConfig(
      room.id,
      { name: 'x', timeoutScale: 1, charPool: 'all', handSize: 4 },
      'other',
    );
    expect(result).toBeNull();
  });

  it('updateConfig 调试房间任意玩家可调用', () => {
    const room = createDebugRoom('调试', 4);
    const result = updateConfig(
      room.id,
      { name: '改名', timeoutScale: 1.5, charPool: 'extended', handSize: 4 },
      'anyone',
    );
    expect(result).not.toBeNull();
    expect(result!.timeoutScale).toBe(1.5);
  });

  it('normalizeRoomConfig 应修正非法字段', () => {
    const cfg = normalizeRoomConfig({
      name: '   ',
      timeoutScale: -1,
      charPool: 'invalid',
      handSize: 999,
    });
    expect(cfg.name).toBe(DEFAULT_ROOM_CONFIG.name); // 空名回退默认
    expect(cfg.timeoutScale).toBe(1); // 非法回退默认
    expect(cfg.charPool).toBe('all'); // 非法回退默认
    expect(cfg.handSize).toBe(4); // 超范围回退默认
  });

  it('normalizeRoomConfig Infinity 表示无限时', () => {
    const cfg = normalizeRoomConfig({
      name: '无限',
      timeoutScale: Infinity,
      charPool: 'all',
      handSize: 4,
    });
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

  // Bug #10: 广播型 pending(如无懈可击)在 Infinity 时不死锁,使用 base timeout
  it('Infinity + isBroadcast 返回 base timeout(不死锁)', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    state.config = { timeoutScale: Infinity };
    expect(resolveTimeoutMs(state, 30, true)).toBe(30000);
  });

  it('isBroadcast=false 时 Infinity 仍返回极大值', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    state.config = { timeoutScale: Infinity };
    expect(resolveTimeoutMs(state, 30, false)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('有限 scale 下 isBroadcast 不影响结果', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    state.config = { timeoutScale: 2 };
    expect(resolveTimeoutMs(state, 15, true)).toBe(30000);
  });
});

describe('旁观者管理', () => {
  it('房间创建时应初始化旁观者字段为空 Map', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    expect(room.spectators.size).toBe(0);
    expect(room.viewGrants.size).toBe(0);
    expect(room.pendingViewRequests.size).toBe(0);
  });

  it('joinAsSpectator 应添加旁观者且不占玩家名额', () => {
    const room = createRoom('测试', 2, 'host1', createMockSink());
    const result = joinAsSpectator(room.id, 'spec1', createMockSink());
    expect(result).not.toBeNull();
    expect(result!.spectators.size).toBe(1);
    expect(result!.players.size).toBe(1); // 玩家数不变
    expect(result!.spectators.has('spec1')).toBe(true);
  });

  it('removeSpectator 应清理旁观者连接、授权和申请', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinAsSpectator(room.id, 'spec1', createMockSink());
    approveView(room.id, 'spec1', 0);
    requestView(room.id, 'spec1', 1);

    const result = removeSpectator(room.id, 'spec1');
    expect(result).not.toBeNull();
    expect(result!.spectators.has('spec1')).toBe(false);
    expect(result!.viewGrants.has('spec1')).toBe(false);
    expect(result!.pendingViewRequests.has('spec1')).toBe(false);
  });

  it('switchRole player→spectator 应在等待中成功', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());

    const result = switchRole(room.id, 'p2', 'spectator');
    expect(result.success).toBe(true);
    expect(result.room.players.has('p2')).toBe(false);
    expect(result.room.spectators.has('p2')).toBe(true);
    expect(result.room.readyPlayers.has('p2')).toBe(false);
  });

  it('switchRole spectator→player 应在等待中且未满时成功', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinAsSpectator(room.id, 'spec1', createMockSink());

    const result = switchRole(room.id, 'spec1', 'player');
    expect(result.success).toBe(true);
    expect(result.room.spectators.has('spec1')).toBe(false);
    expect(result.room.players.has('spec1')).toBe(true);
  });

  it('switchRole 进行中不允许切换', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    room.status = '进行中';

    const result = switchRole(room.id, 'p2', 'spectator');
    expect(result.success).toBe(false);
  });

  it('switchRole spectator→player 房间满时失败', () => {
    const room = createRoom('测试', 2, 'host1', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    joinAsSpectator(room.id, 'spec1', createMockSink());

    const result = switchRole(room.id, 'spec1', 'player');
    expect(result.success).toBe(false);
  });

  it('requestView 应设置待处理申请', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinAsSpectator(room.id, 'spec1', createMockSink());

    const result = requestView(room.id, 'spec1', 0);
    expect(result).not.toBeNull();
    expect(result!.pendingViewRequests.get('spec1')).toBe(0);
  });

  it('approveView 应设置授权并清除申请', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinAsSpectator(room.id, 'spec1', createMockSink());
    requestView(room.id, 'spec1', 0);

    const result = approveView(room.id, 'spec1', 0);
    expect(result).not.toBeNull();
    expect(result!.viewGrants.get('spec1')).toBe(0);
    expect(result!.pendingViewRequests.has('spec1')).toBe(false);
  });

  it('rejectView 应清除申请', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinAsSpectator(room.id, 'spec1', createMockSink());
    requestView(room.id, 'spec1', 0);

    const result = rejectView(room.id, 'spec1');
    expect(result).not.toBeNull();
    expect(result!.pendingViewRequests.has('spec1')).toBe(false);
  });

  it('revokeView 应清除授权', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinAsSpectator(room.id, 'spec1', createMockSink());
    approveView(room.id, 'spec1', 0);

    const result = revokeView(room.id, 'spec1');
    expect(result).not.toBeNull();
    expect(result!.viewGrants.has('spec1')).toBe(false);
  });

  it('findRoomByPlayerId 应能查找旁观者', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinAsSpectator(room.id, 'spec-find', createMockSink());

    const result = findRoomByPlayerId('spec-find');
    expect(result).not.toBeNull();
    expect(result!.id).toBe(room.id);
  });

  it('getRoomList 应包含旁观者数量', () => {
    setSessionChecker(() => true);
    const room = createRoom('旁观测试房', 4, 'host-spec-count', createMockSink());
    joinAsSpectator(room.id, 'spec1', createMockSink());
    joinAsSpectator(room.id, 'spec2', createMockSink());

    const list = getRoomList('multiplayer');
    const found = list.find((r) => r.id === room.id);
    expect(found).toBeDefined();
    expect(found!.spectatorCount).toBe(2);
    setSessionChecker(null);
  });

  it('getRoomList 应包含 hostId(普通房间返回房主,debug 房间返回 null)', () => {
    setSessionChecker(() => true);
    const room = createRoom('房主测试房', 4, 'zhao-zi-long', createMockSink());

    const list = getRoomList('multiplayer');
    const found = list.find((r) => r.id === room.id);
    expect(found).toBeDefined();
    expect(found!.hostId).toBe('zhao-zi-long');
    setSessionChecker(null);
  });

  it('broadcastMessage 应向玩家和旁观者都发送', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    joinAsSpectator(room.id, 'spec1', createMockSink());

    const msgs: string[] = [];
    // 替换 sink 以记录消息
    room.players.get('p2')!.send = () => msgs.push('p2');
    room.spectators.get('spec1')!.send = () => msgs.push('spec1');

    broadcastMessage(room, { type: 'game_started' });
    expect(msgs).toContain('p2');
    expect(msgs).toContain('spec1');
  });
});

// ─── 聊天功能 ───
describe('聊天功能', () => {
  function makeChatRoom(chatOverride?: Partial<{
    enabled: boolean;
    whitelistOnly: boolean;
    whitelist: string[];
    maxPerGame: number;
    maxPerMinute: number;
    maxChars: number;
  }>) {
    const room = createRoom('聊天测试', 4, 'host1', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    joinRoom(room.id, 'p3', createMockSink());
    room.config = normalizeRoomConfig({
      ...room.config,
      chat: {
        enabled: true,
        whitelistOnly: false,
        whitelist: ['我有杀', '集火他'],
        maxPerGame: 0,
        maxPerMinute: 5,
        maxChars: 30,
        ...chatOverride,
      },
    });
    return room;
  }

  it('正常发送聊天消息成功', () => {
    const room = makeChatRoom();
    const result = addChatMessage(room.id, 'host1', '大家好');
    expect(result.ok).toBe(true);
    expect(result.remaining).toBeNull(); // maxPerGame=0 表示无限
  });

  it('聊天关闭时拒绝发送', () => {
    const room = makeChatRoom({ enabled: false });
    const result = addChatMessage(room.id, 'host1', '大家好');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('聊天已关闭');
  });

  it('空消息被拒绝', () => {
    const room = makeChatRoom();
    const result = addChatMessage(room.id, 'host1', '   ');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('消息不能为空');
  });

  it('白名单模式下非白名单消息被拒绝', () => {
    const room = makeChatRoom({ whitelistOnly: true });
    const result = addChatMessage(room.id, 'host1', '随便说的话');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('只能发送白名单内的消息');
  });

  it('白名单模式下白名单消息成功', () => {
    const room = makeChatRoom({ whitelistOnly: true });
    const result = addChatMessage(room.id, 'host1', '我有杀');
    expect(result.ok).toBe(true);
  });

  it('超过字数限制被拒绝', () => {
    const room = makeChatRoom({ maxChars: 5 });
    const result = addChatMessage(room.id, 'host1', '这是一句很长很长的话');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('5');
  });

  it('每局消息上限生效', () => {
    const room = makeChatRoom({ maxPerGame: 2 });
    expect(addChatMessage(room.id, 'host1', '消息1').ok).toBe(true);
    expect(addChatMessage(room.id, 'host1', '消息2').ok).toBe(true);
    const result = addChatMessage(room.id, 'host1', '消息3');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('上限');
  });

  it('remaining 正确反映每局剩余次数', () => {
    const room = makeChatRoom({ maxPerGame: 3 });
    let r = addChatMessage(room.id, 'host1', '消息1');
    expect(r.remaining).toBe(2);
    r = addChatMessage(room.id, 'host1', '消息2');
    expect(r.remaining).toBe(1);
  });

  it('每分钟频率限制生效', () => {
    const room = makeChatRoom({ maxPerMinute: 2 });
    expect(addChatMessage(room.id, 'host1', '消息1').ok).toBe(true);
    expect(addChatMessage(room.id, 'host1', '消息2').ok).toBe(true);
    const result = addChatMessage(room.id, 'host1', '消息3');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('每分钟');
  });

  it('不同玩家独立计算频率限制', () => {
    const room = makeChatRoom({ maxPerMinute: 1 });
    expect(addChatMessage(room.id, 'host1', '消息1').ok).toBe(true);
    expect(addChatMessage(room.id, 'host1', '消息2').ok).toBe(false);
    // p2 有独立的配额
    expect(addChatMessage(room.id, 'p2', '消息1').ok).toBe(true);
  });

  it('消息记录到历史', () => {
    const room = makeChatRoom();
    addChatMessage(room.id, 'host1', '消息A');
    addChatMessage(room.id, 'p2', '消息B');
    const history = getChatHistory(room.id);
    expect(history).toHaveLength(2);
    expect(history[0].text).toBe('消息A');
    expect(history[0].seatIndex).toBe(0);
    expect(history[1].text).toBe('消息B');
    expect(history[1].seatIndex).toBe(1);
  });

  it('resetChatUsage 清除历史和用量', () => {
    const room = makeChatRoom({ maxPerGame: 3 });
    addChatMessage(room.id, 'host1', '消息1');
    addChatMessage(room.id, 'p2', '消息2');
    expect(getChatHistory(room.id)).toHaveLength(2);

    resetChatUsage(room.id);

    expect(getChatHistory(room.id)).toHaveLength(0);
    // 重置后额度恢复
    const r = addChatMessage(room.id, 'host1', '新消息');
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it('不在房间中的玩家被拒绝', () => {
    const room = makeChatRoom();
    const result = addChatMessage(room.id, 'outsider', '大家好');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('不在房间中');
  });
});
