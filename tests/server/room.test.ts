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
  buildRoomState,
  getPlayerSeat,
  moveSeat,
  requestSeatSwap,
  respondSeatSwap,
  kickPlayer,
  ensureSeatOnReconnect,
  SEAT_SWAP_TIMEOUT_MS,
} from '../../src/server/room';
import { normalizeRoomConfig, DEFAULT_ROOM_CONFIG } from '../../src/server/protocol';
import { resolveTimeoutMs } from '../../src/engine/core/timeout';
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

  // 回归(2026-08-24):游戏结束后(已结束,等房主「再来一局」)返回大厅的玩家
  // 此前无法重新加入房间(只能旁观)。修复:已结束状态允许加入空座。
  it('可以加入已结束房间的空座', () => {
    const hostSink = createMockSink();
    const room = createRoom('测试房间', 4, 'host1', hostSink);
    room.status = '已结束';

    const result = joinRoom(room.id, 'player1', createMockSink());
    expect(result).not.toBeNull();
    expect(result!.players.has('player1')).toBe(true);
    expect(result!.seats).toContain('player1');
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
    expect(room.config.timeoutSec).toBe(30);
    expect(room.config.charPool).toBe('all');
    expect(room.config.handSize).toBe(4);
    expect(room.config.name).toBe('测试');
  });

  it('创建调试房间应携带默认 config', () => {
    const room = createDebugRoom('调试', 5);
    expect(room.config).toBeDefined();
    expect(room.config.timeoutSec).toBe(30);
    expect(room.config.name).toBe('调试');
  });

  it('创建房间可传入自定义 config', () => {
    const sink = createMockSink();
    const customConfig = {
      name: '自定义',
      timeoutSec: 15,
      charPool: 'standard' as const,
      handSize: 5,
      gameMode: '身份局' as const,
      chat: { enabled: false, whitelistOnly: false, whitelist: [], maxPerGame: 0, maxPerMinute: 5, maxChars: 30 },
    };
    const room = createRoom('x', 4, 'h', sink, customConfig);
    expect(room.config.timeoutSec).toBe(15);
    expect(room.config.charPool).toBe('standard');
    expect(room.config.handSize).toBe(5);
  });

  it('updateConfig 应更新配置并同步房间名', () => {
    const sink = createMockSink();
    const room = createRoom('测试', 4, 'host1', sink);
    const updated = updateConfig(
      room.id,
      { name: '新名', timeoutSec: 60, charPool: 'standard', handSize: 3 },
      'host1',
    );
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('新名');
    expect(updated!.timeoutSec).toBe(60);
    expect(room.config.timeoutSec).toBe(60);
    expect(room.name).toBe('新名');
  });

  it('updateConfig 普通房间仅房主可调用', () => {
    const sink = createMockSink();
    const room = createRoom('测试', 4, 'host1', sink);
    // 非房主应失败
    const result = updateConfig(
      room.id,
      { name: 'x', timeoutSec: 30, charPool: 'all', handSize: 4 },
      'other',
    );
    expect(result).toBeNull();
  });

  it('updateConfig 调试房间任意玩家可调用', () => {
    const room = createDebugRoom('调试', 4);
    const result = updateConfig(
      room.id,
      { name: '改名', timeoutSec: 45, charPool: 'extended', handSize: 4 },
      'anyone',
    );
    expect(result).not.toBeNull();
    expect(result!.timeoutSec).toBe(45);
  });

  it('normalizeRoomConfig 应修正非法字段', () => {
    const cfg = normalizeRoomConfig({
      name: '   ',
      timeoutSec: -1,
      charPool: 'invalid',
      handSize: 999,
    });
    expect(cfg.name).toBe(DEFAULT_ROOM_CONFIG.name); // 空名回退默认
    expect(cfg.timeoutSec).toBe(30); // 非法回退默认
    expect(cfg.charPool).toBe('all'); // 非法回退默认
    expect(cfg.handSize).toBe(4); // 超范围回退默认
  });

  it('updateConfig 配置变更后重置准备状态', () => {
    const sink = createMockSink();
    const room = createRoom('测试', 4, 'host1', sink);
    joinRoom(room.id, 'p2', createMockSink());
    setReady(room.id, 'host1');
    setReady(room.id, 'p2');
    expect(room.readyPlayers.size).toBe(2);

    updateConfig(
      room.id,
      { name: '改名', timeoutSec: 2, charPool: 'all', handSize: 4 },
      'host1',
    );
    expect(room.readyPlayers.size).toBe(0);
  });

  it('updateConfig 支持修改 maxPlayers', () => {
    const sink = createMockSink();
    const room = createRoom('测试', 4, 'host1', sink);
    updateConfig(
      room.id,
      { name: '测试', timeoutSec: 30, charPool: 'all', handSize: 4 },
      'host1',
      6,
    );
    expect(room.maxPlayers).toBe(6);
  });

  it('updateConfig maxPlayers 不得小于当前在线人数', () => {
    const sink = createMockSink();
    const room = createRoom('测试', 4, 'host1', sink);
    joinRoom(room.id, 'p2', createMockSink());
    joinRoom(room.id, 'p3', createMockSink());
    // 当前 3 人在线，改为 2 应失败
    const result = updateConfig(
      room.id,
      { name: '测试', timeoutSec: 30, charPool: 'all', handSize: 4 },
      'host1',
      2,
    );
    expect(result).toBeNull();
    expect(room.maxPlayers).toBe(4); // 保持不变
  });

  it('updateConfig maxPlayers clamp 到 2-8', () => {
    const sink = createMockSink();
    const room = createRoom('测试', 4, 'host1', sink);
    updateConfig(
      room.id,
      { name: '测试', timeoutSec: 30, charPool: 'all', handSize: 4 },
      'host1',
      1,
    );
    expect(room.maxPlayers).toBe(2); // 下限

    updateConfig(
      room.id,
      { name: '测试', timeoutSec: 30, charPool: 'all', handSize: 4 },
      'host1',
      99,
    );
    expect(room.maxPlayers).toBe(8); // 上限
  });
});

describe('resolveTimeoutMs', () => {
  it('未配置 timeoutSec 时回退 atom baseSeconds', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    expect(resolveTimeoutMs(state, 30)).toBe(30000);
    expect(resolveTimeoutMs(state, 15)).toBe(15000);
  });

  it('配置绝对秒数直接生效', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    state.config = { timeoutSec: 10 };
    expect(resolveTimeoutMs(state, 30)).toBe(10000); // baseSeconds 被覆盖
    state.config = { timeoutSec: 60 };
    expect(resolveTimeoutMs(state, 15)).toBe(60000);
  });

  it('timeoutSec=0 返回 24 小时(无限,定时器实际不触发)', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    state.config = { timeoutSec: 0 };
    expect(resolveTimeoutMs(state, 30)).toBe(86_400_000);
  });

  // Bug #10: 广播型 pending(如无懈可击)在无限时不死锁,使用 base timeout
  it('timeoutSec=0 + isBroadcast 返回 base timeout(不死锁)', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    state.config = { timeoutSec: 0 };
    expect(resolveTimeoutMs(state, 30, true)).toBe(30000);
  });

  it('isBroadcast=false 时无限仍返回 24 小时', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    state.config = { timeoutSec: 0 };
    expect(resolveTimeoutMs(state, 30, false)).toBe(86_400_000);
  });

  it('有限秒数下 isBroadcast 不影响结果', () => {
    const state: GameState = createGameState({ players: [], cardMap: {} });
    state.config = { timeoutSec: 20 };
    expect(resolveTimeoutMs(state, 15, true)).toBe(20000);
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

  // 回归(2026-08-24):游戏结束后旁观者点击空座位应能直接入座,
  // 无需等房主点「再来一局」(此前报「切换失败」)。
  it('switchRole spectator→player 已结束状态允许入空座', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinAsSpectator(room.id, 'spec1', createMockSink());
    room.status = '已结束';

    const result = switchRole(room.id, 'spec1', 'player');
    expect(result.success).toBe(true);
    expect(result.room.players.has('spec1')).toBe(true);
    expect(result.room.seats).toContain('spec1');
  });

  it('switchRole player→spectator 已结束状态允许转旁观', () => {
    const room = createRoom('测试', 4, 'host1', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    room.status = '已结束';

    const result = switchRole(room.id, 'p2', 'spectator');
    expect(result.success).toBe(true);
    expect(result.room.spectators.has('p2')).toBe(true);
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

  it('旁观者重连覆盖后,旧连接断开不应删除新注册(修复刷新后"加入游戏失败")', () => {
    // 场景:旁观者刷新页面 → 新 joinAsSpectator 覆盖 spectators[id]=sink2 →
    // 旧 sink1 的 onAbort 延迟触发 → 若无 sink 守卫,removeSpectator 会删掉 sink2 →
    // switchRole(spectator→player) 找不到该旁观者 → "加入游戏失败"。
    // sse.ts 旁观分支 onAbort 已加守卫 `if (room.spectators.get(id) !== sink) return`,
    // 此测试验证该守卫依赖的 joinAsSpectator 覆盖语义。
    const room = createRoom('测试', 4, 'host1', createMockSink());
    const sink1 = createMockSink();
    const sink2 = createMockSink();

    // 首次旁观
    joinAsSpectator(room.id, 'spec1', sink1);
    expect(room.spectators.get('spec1')).toBe(sink1);

    // 刷新重连:新 sink 覆盖(joinAsSpectator 直接 set,不拒绝已存在)
    joinAsSpectator(room.id, 'spec1', sink2);
    expect(room.spectators.get('spec1')).toBe(sink2);

    // 模拟旧 sink1 onAbort 的守卫逻辑(sse.ts):旧 sink 不再是当前 sink → 跳过删除
    if (room.spectators.get('spec1') === sink1) {
      removeSpectator(room.id, 'spec1');
    }
    expect(room.spectators.has('spec1')).toBe(true);
    expect(room.spectators.get('spec1')).toBe(sink2);

    // 后续 switchRole(spectator→player) 能找到 spec1 → 加入成功
    const result = switchRole(room.id, 'spec1', 'player');
    expect(result.success).toBe(true);
  });

  // ── 身份互斥（修复"旁观切换到空座位显示座位已满"）──
  // 根因：joinRoom/joinAsSpectator/switchRole 不清理对方身份，导致同一 playerId
  // 同时存在于 players 和 spectators，引发容量误判和 UI 身份歧义。
  it('joinRoom 清理残留旁观身份：刷新前是旁观者，joinRoom 后不再同时存在两边', () => {
    const room = createRoom('测试', 4, 'host', createMockSink());
    // wmzy 先以旁观者身份进入
    joinAsSpectator(room.id, 'wmzy', createMockSink());
    expect(room.spectators.has('wmzy')).toBe(true);

    // 刷新后 joinRoom（autoJoin）——应清理 spectator 身份
    joinRoom(room.id, 'wmzy', createMockSink());

    // 身份互斥：只在 players/seats，不在 spectators
    expect(room.players.has('wmzy')).toBe(true);
    expect(room.spectators.has('wmzy')).toBe(false);
    expect(room.seats.includes('wmzy')).toBe(true);
  });

  it('joinAsSpectator 清理残留玩家身份：刷新前是玩家，降级旁观后释放座位', () => {
    const room = createRoom('测试', 4, 'host', createMockSink());
    joinRoom(room.id, 'wmzy', createMockSink());
    expect(room.seats.includes('wmzy')).toBe(true);

    // autoJoin 失败降级旁观——应释放 wmzy 的座位
    joinAsSpectator(room.id, 'wmzy', createMockSink());

    expect(room.spectators.has('wmzy')).toBe(true);
    expect(room.players.has('wmzy')).toBe(false);
    expect(room.seats.includes('wmzy')).toBe(false);
  });

  it('switchRole spectator→player 用 seats 占用数判满（非 players.size）', () => {
    // 满员房间，wmzy 切旁观释放座位后，seats 有空位但 players 可能含幽灵
    const room = createRoom('测试', 2, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    // wmzy 无法加入（满员），改为旁观
    joinAsSpectator(room.id, 'wmzy', createMockSink());

    // p2 切旁观 → 释放座位，seats 有空位
    switchRole(room.id, 'p2', 'spectator');
    expect(room.seats.filter((s) => s !== null).length).toBe(1); // 只剩 host

    // wmzy 切玩家 → 应成功（seats 有空位），即使 players.size 因幽灵偏高也不影响
    const result = switchRole(room.id, 'wmzy', 'player');
    expect(result.success).toBe(true);
    expect(room.seats.includes('wmzy')).toBe(true);
  });

  it('switchRole 后身份严格互斥（player→spectator 不残留 players）', () => {
    const room = createRoom('测试', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    setReady(room.id, 'p2');

    switchRole(room.id, 'p2', 'spectator');

    expect(room.players.has('p2')).toBe(false);
    expect(room.readyPlayers.has('p2')).toBe(false);
    expect(room.seats.includes('p2')).toBe(false);
    expect(room.spectators.has('p2')).toBe(true);
  });

  it('容量判断与客户端一致：seats 占用数 >= maxPlayers 时拒绝加入', () => {
    const room = createRoom('测试', 2, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    // 模拟幽灵：p2 断线 players 删除但 seats 残留
    room.players.delete('p2');

    // 新玩家加入：seats 全占（occupiedSeatCount=2）→ 拒绝
    // （旧逻辑用 players.size=1 会错误允许，导致与客户端 playerCount=2 不一致）
    const result = joinRoom(room.id, 'p3', createMockSink());
    expect(result).toBeNull();
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

  it('getRoomList 应包含 playerIds(基于 seats,SSE 断线后仍保留)', () => {
    setSessionChecker(() => true);
    const room = createRoom('玩家列表房', 4, 'host-pids', createMockSink());
    joinRoom(room.id, 'guest1', createMockSink());
    joinRoom(room.id, 'guest2', createMockSink());

    const list = getRoomList('multiplayer');
    const found = list.find((r) => r.id === room.id);
    expect(found).toBeDefined();
    expect(found!.playerIds).toEqual(expect.arrayContaining(['host-pids', 'guest1', 'guest2']));
    expect(found!.playerIds).toHaveLength(3);

    // 模拟 SSE 断线:room.players 清除但 seats 保留
    room.players.clear();
    const list2 = getRoomList('multiplayer');
    const found2 = list2.find((r) => r.id === room.id);
    expect(found2).toBeDefined();
    // 断线后 playerIds 仍包含所有玩家(用于 lobby 判断"已在房间中")
    expect(found2!.playerIds).toEqual(expect.arrayContaining(['host-pids', 'guest1', 'guest2']));
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
    // 聊天仅在游戏中可用(makeChatRoom 模拟游戏进行中的房间)
    setRoomStatus(room.id, '进行中');
    return room;
  }

  it('正常发送聊天消息成功', () => {
    const room = makeChatRoom();
    const result = addChatMessage(room.id, 'host1', '大家好');
    expect(result.ok).toBe(true);
    expect(result.remaining).toBeNull(); // maxPerGame=0 表示无限
  });

  it('非游戏中(大厅/结算)拒绝聊天', () => {
    const room = makeChatRoom();
    setRoomStatus(room.id, '等待中');
    expect(addChatMessage(room.id, 'host1', '大家好')).toMatchObject({
      ok: false,
      error: '聊天仅在游戏中可用',
    });
    setRoomStatus(room.id, '已结束');
    expect(addChatMessage(room.id, 'host1', '大家好')).toMatchObject({
      ok: false,
      error: '聊天仅在游戏中可用',
    });
    // 游戏中恢复正常
    setRoomStatus(room.id, '进行中');
    expect(addChatMessage(room.id, 'host1', '大家好').ok).toBe(true);
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

describe('房间类型行为', () => {
  it('创建普通房间默认为 quick 类型', () => {
    const room = createRoom('快速房', 4, 'host', createMockSink());
    expect(room.roomType).toBe('quick');
  });

  it('创建普通房间可指定 normal 类型', () => {
    const room = createRoom('普通房', 4, 'host', createMockSink(), undefined, 'normal');
    expect(room.roomType).toBe('normal');
  });

  it('快速房间: 所有人离开 + 无游戏 → 自动销毁', () => {
    const room = createRoom('快速房', 4, 'host', createMockSink());
    const result = leaveRoom(room.id, 'host');
    expect(result).toBeNull();
    expect(getRoom(room.id)).toBeNull();
  });

  it('快速房间: 所有人离开 + 游戏进行中 → 不销毁', () => {
    const room = createRoom('快速房', 4, 'host', createMockSink());
    room.status = '进行中';
    const result = leaveRoom(room.id, 'host');
    expect(result).not.toBeNull();
    expect(getRoom(room.id)).not.toBeNull();
  });

  it('快速房间: 房主离开 → 自动选新房主', () => {
    const room = createRoom('快速房', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    const result = leaveRoom(room.id, 'host');
    expect(result).not.toBeNull();
    expect(result!.hostId).toBe('p2');
  });

  it('普通房间: 所有人离开 → 不销毁', () => {
    const room = createRoom('普通房', 4, 'host', createMockSink(), undefined, 'normal');
    const result = leaveRoom(room.id, 'host');
    expect(result).not.toBeNull();
    expect(getRoom(room.id)).not.toBeNull();
  });

  it('普通房间: 房主离开 → 不自动换主', () => {
    const room = createRoom('普通房', 4, 'host', createMockSink(), undefined, 'normal');
    joinRoom(room.id, 'p2', createMockSink());
    const result = leaveRoom(room.id, 'host');
    expect(result).not.toBeNull();
    expect(result!.hostId).toBe('host'); // 房主保持不变
    expect(result!.players.has('host')).toBe(false);
  });

  it('普通房间: 游戏进行中所有人离开 → 不销毁', () => {
    const room = createRoom('普通房', 4, 'host', createMockSink(), undefined, 'normal');
    joinRoom(room.id, 'p2', createMockSink());
    room.status = '进行中';
    leaveRoom(room.id, 'p2');
    const result = leaveRoom(room.id, 'host');
    expect(result).not.toBeNull();
    expect(getRoom(room.id)).not.toBeNull();
  });

  it('RoomInfo 包含 roomType 字段', () => {
    createRoom('快速房', 4, 'qhost', createMockSink());
    createRoom('普通房', 4, 'nhost', createMockSink(), undefined, 'normal');

    const list = getRoomList();
    const quickRoom = list.find((r) => r.hostId === 'qhost');
    const normalRoom = list.find((r) => r.hostId === 'nhost');
    expect(quickRoom?.roomType).toBe('quick');
    expect(normalRoom?.roomType).toBe('normal');
  });
});

// ─── 座位管理 ───
describe('座位管理', () => {
  it('createRoom 初始化 seats，host 在座次 0', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    expect(room.seats).toEqual(['host', null, null, null]);
  });

  it('createDebugRoom 初始化全空 seats', () => {
    const room = createDebugRoom('调试', 4);
    expect(room.seats).toEqual([null, null, null, null]);
  });

  it('joinRoom 分配首个空座位', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    expect(room.seats).toEqual(['host', 'p2', null, null]);
    joinRoom(room.id, 'p3', createMockSink());
    expect(room.seats).toEqual(['host', 'p2', 'p3', null]);
  });

  it('leaveRoom 清除座位', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    leaveRoom(room.id, 'p2');
    expect(room.seats).toEqual(['host', null, null, null]);
  });

  it('buildRoomState 从 seats 派生 playerIds（保持座位顺序）', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    // 移动 host 到座次 3
    moveSeat(room.id, 'host', 3);
    const state = buildRoomState(room);
    expect(state.type).toBe('room_state');
    expect((state as { seats: (string | null)[] }).seats).toEqual([null, 'p2', null, 'host']);
    // playerIds 过滤 null，保持 seats 顺序
    expect((state as { playerIds: string[] }).playerIds).toEqual(['p2', 'host']);
  });

  it('getPlayerSeat 返回正确座次', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    expect(getPlayerSeat(room, 'host')).toBe(0);
    expect(getPlayerSeat(room, 'p2')).toBe(1);
    expect(getPlayerSeat(room, 'nonexistent')).toBe(-1);
  });

  it('moveSeat 移动到空座位', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());

    const result = moveSeat(room.id, 'host', 2);
    expect(result).not.toBeNull();
    expect(room.seats).toEqual([null, 'p2', 'host', null]);
  });

  it('moveSeat 拒绝移动到已占座位', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());

    const result = moveSeat(room.id, 'host', 1);
    expect(result).toBeNull();
    expect(room.seats).toEqual(['host', 'p2', null, null]);
  });

  it('moveSeat 拒绝游戏中移动', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    room.status = '进行中';

    const result = moveSeat(room.id, 'host', 2);
    expect(result).toBeNull();
  });

  it('moveSeat 不在房间中的玩家被拒绝', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    const result = moveSeat(room.id, 'outsider', 2);
    expect(result).toBeNull();
  });

  it('updateConfig 扩展 seats 数组', () => {
    const room = createRoom('房间', 2, 'host', createMockSink());
    updateConfig(room.id, normalizeRoomConfig(DEFAULT_ROOM_CONFIG), 'host', 4);
    expect(room.seats).toEqual(['host', null, null, null]);
  });

  it('updateConfig 收缩 seats 数组（尾部空座位）', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    updateConfig(room.id, normalizeRoomConfig(DEFAULT_ROOM_CONFIG), 'host', 2);
    expect(room.seats).toEqual(['host', null]);
  });

  it('updateConfig 拒绝收缩被占用的座位', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    joinRoom(room.id, 'p3', createMockSink());
    // 座位 2 有 p3, 尝试收缩到 2 个座位
    const result = updateConfig(room.id, normalizeRoomConfig(DEFAULT_ROOM_CONFIG), 'host', 2);
    expect(result).toBeNull();
  });
});

// ─── 座位交换流程 ───
describe('座位交换流程', () => {
  it('requestSeatSwap 创建交换请求并返回目标玩家', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());

    const result = requestSeatSwap(room.id, 'host', 1);
    expect(result).not.toBeNull();
    expect(result!.targetPlayerId).toBe('p2');
    expect(result!.requesterSeat).toBe(0);
    expect(result!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('requestSeatSwap 拒绝空座位', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());

    const result = requestSeatSwap(room.id, 'host', 2);
    expect(result).toBeNull();
  });

  it('requestSeatSwap 拒绝自己的座位', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());

    const result = requestSeatSwap(room.id, 'host', 0);
    expect(result).toBeNull();
  });

  it('respondSeatSwap accept=true 执行交换', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());

    requestSeatSwap(room.id, 'host', 1);
    const result = respondSeatSwap(room.id, 'p2', 'host', true);

    expect(result).not.toBeNull();
    expect(result!.swapped).toBe(true);
    expect(room.seats).toEqual(['p2', 'host', null, null]);
  });

  it('respondSeatSwap accept=false 不交换', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());

    requestSeatSwap(room.id, 'host', 1);
    const result = respondSeatSwap(room.id, 'p2', 'host', false);

    expect(result).not.toBeNull();
    expect(result!.swapped).toBe(false);
    expect(room.seats).toEqual(['host', 'p2', null, null]);
    // 交换请求已清理
    expect(room.pendingSeatSwaps.size).toBe(0);
  });

  it('respondSeatSwap 非目标玩家响应被拒绝', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    joinRoom(room.id, 'p3', createMockSink());

    requestSeatSwap(room.id, 'host', 1); // 目标是 p2
    const result = respondSeatSwap(room.id, 'p3', 'host', true);

    expect(result).toBeNull();
    expect(room.pendingSeatSwaps.size).toBe(1); // 请求仍有效
  });

  it('respondSeatSwap 无效 requesterId 被拒绝', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());

    requestSeatSwap(room.id, 'host', 1);
    const result = respondSeatSwap(room.id, 'p2', 'nonexistent', true);
    expect(result).toBeNull();
  });

  it('重复 requestSeatSwap 覆盖旧请求', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    joinRoom(room.id, 'p3', createMockSink());

    requestSeatSwap(room.id, 'host', 1);
    expect(room.pendingSeatSwaps.size).toBe(1);

    requestSeatSwap(room.id, 'host', 2);
    expect(room.pendingSeatSwaps.size).toBe(1);
    const pending = room.pendingSeatSwaps.get('host');
    expect(pending?.targetSeat).toBe(2);
  });

  it('SEAT_SWAP_TIMEOUT_MS 为 15 秒', () => {
    expect(SEAT_SWAP_TIMEOUT_MS).toBe(15_000);
  });
});

// ─── 座位残留与重连 ───
describe('座位残留与重连', () => {
  it('joinRoom: 玩家已在 seats 中（SSE 断开残留）时复用座位，不重复入座', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    // p2 移动到座位 2
    moveSeat(room.id, 'p2', 2);
    expect(room.seats).toEqual(['host', null, 'p2', null]);

    // 模拟 SSE 断开: players 中删除 p2，但 seats 残留
    room.players.delete('p2');
    expect(room.seats).toEqual(['host', null, 'p2', null]);

    // p2 重新 joinRoom
    const result = joinRoom(room.id, 'p2', createMockSink());
    expect(result).not.toBeNull();
    // 复用了座位 2，没有分配新座位
    expect(room.seats).toEqual(['host', null, 'p2', null]);
    expect(room.seats.filter((s) => s === 'p2').length).toBe(1);
  });

  it('joinRoom: 玩家不在 seats 中时正常分配首个空座位', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    // host 在座位 0，座位 1 空
    const result = joinRoom(room.id, 'p2', createMockSink());
    expect(result).not.toBeNull();
    expect(room.seats).toEqual(['host', 'p2', null, null]);
  });

  it('joinRoom: seats 残留算占用（与客户端 playerCount 一致），断线残留期间拒绝新玩家', () => {
    const room = createRoom('房间', 2, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    expect(room.seats).toEqual(['host', 'p2']);
    expect(room.players.size).toBe(2);

    // p2 断线（players 删除，seats 残留）——模拟 SSE onAbort 尚未触发 leaveRoom 的窗口
    room.players.delete('p2');

    // p3 尝试加入 → 被拒：seats 全占（host + p2 残留），occupiedSeatCount=2 >= maxPlayers=2。
    // 这与客户端 playerCount（=seats 非空数）判断一致，避免"UI 显示满员但服务端允许加入"的歧义。
    const result = joinRoom(room.id, 'p3', createMockSink());
    expect(result).toBeNull();

    // p2 重连 → 复用残留座位 1（seats.indexOf('p2') >= 0），不重复入座
    const p2result = joinRoom(room.id, 'p2', createMockSink());
    expect(p2result).not.toBeNull();
    expect(room.seats).toEqual(['host', 'p2']);
    expect(room.players.size).toBe(2);
  });
});

// ─── 踢出玩家 ───
describe('踢出玩家', () => {
  it('房主踢出占座玩家：移除 players/seats 并返回其 sink', () => {
    const hostSink = createMockSink();
    const p2Sink = createMockSink();
    const room = createRoom('房间', 4, 'host', hostSink);
    joinRoom(room.id, 'p2', p2Sink);
    expect(room.seats).toEqual(['host', 'p2', null, null]);

    const result = kickPlayer(room.id, 'host', 'p2');

    expect(result).not.toBeNull();
    expect(result!.kickedSink).toBe(p2Sink);
    expect(result!.room.players.has('p2')).toBe(false);
    expect(result!.room.seats).toEqual(['host', null, null, null]);
    // 房主仍在
    expect(result!.room.hostId).toBe('host');
  });

  it('踢出玩家时清除其准备状态', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    setReady(room.id, 'p2');
    expect(room.readyPlayers.has('p2')).toBe(true);

    kickPlayer(room.id, 'host', 'p2');

    expect(room.readyPlayers.has('p2')).toBe(false);
  });

  it('房主踢出旁观者：移除 spectators/viewGrants/pendingViewRequests', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    const specSink = createMockSink();
    joinAsSpectator(room.id, 'spec1', specSink);
    approveView(room.id, 'spec1', 0);
    expect(room.spectators.has('spec1')).toBe(true);
    expect(room.viewGrants.has('spec1')).toBe(true);

    const result = kickPlayer(room.id, 'host', 'spec1');

    expect(result).not.toBeNull();
    expect(result!.kickedSink).toBe(specSink);
    expect(room.spectators.has('spec1')).toBe(false);
    expect(room.viewGrants.has('spec1')).toBe(false);
    expect(room.pendingViewRequests.has('spec1')).toBe(false);
  });

  it('踢出玩家时取消其待处理的座位交换请求', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    joinRoom(room.id, 'p3', createMockSink());
    // p3 请求与 host 交换（p3 发起）
    requestSeatSwap(room.id, 'p3', 0);
    expect(room.pendingSeatSwaps.has('p3')).toBe(true);

    kickPlayer(room.id, 'host', 'p3');

    expect(room.pendingSeatSwaps.has('p3')).toBe(false);
    expect(room.seats.filter((s) => s === 'p3').length).toBe(0);
  });

  it('踢出玩家不转移房主、不销毁房间', () => {
    const room = createRoom('快速房', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());

    const result = kickPlayer(room.id, 'host', 'p2');

    expect(result).not.toBeNull();
    expect(result!.room.hostId).toBe('host');
    // 房间仍在列表中（未被销毁）
    expect(getRoom(room.id)).not.toBeNull();
  });

  it('非房主不能踢人', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());

    const result = kickPlayer(room.id, 'p2', 'host');

    expect(result).toBeNull();
    expect(room.players.has('host')).toBe(true);
  });

  it('房主不能踢自己', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());

    const result = kickPlayer(room.id, 'host', 'host');

    expect(result).toBeNull();
    expect(room.players.has('host')).toBe(true);
  });

  it('游戏进行中不能踢人', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    room.status = '进行中';

    const result = kickPlayer(room.id, 'host', 'p2');

    expect(result).toBeNull();
    expect(room.players.has('p2')).toBe(true);
  });

  it('踢出不在房间中的目标返回 null', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());

    const result = kickPlayer(room.id, 'host', 'ghost');

    expect(result).toBeNull();
  });

  it('调试房间（无房主）不允许踢人', () => {
    const room = createDebugRoom('调试', 4);
    joinRoom(room.id, 'p1', createMockSink());

    const result = kickPlayer(room.id, 'p1', 'p2');

    expect(result).toBeNull();
  });

  it('房间不存在时返回 null', () => {
    const result = kickPlayer('NOPE', 'host', 'p2');
    expect(result).toBeNull();
  });
});

// ─── SSE 重连补座次（根治幽灵连接）───
describe('ensureSeatOnReconnect', () => {
  it('等待中非调试,玩家不在 seats 且有空座 → 补到首个空座,返回 true', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    // 模拟重启后状态:host 在 players 但 seats 全空
    room.seats = Array(4).fill(null);
    expect(ensureSeatOnReconnect(room, 'host')).toBe(true);
    expect(room.seats[0]).toBe('host');
  });

  it('玩家已在 seats → 不补,返回 false', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    // createRoom 已把 host 放入 seats[0]
    expect(ensureSeatOnReconnect(room, 'host')).toBe(false);
  });

  it('无空座(seats 满) → 不补,返回 false', () => {
    const room = createRoom('房间', 2, 'host', createMockSink());
    joinRoom(room.id, 'p2', createMockSink());
    // seats 已满,p3 是无座幽灵
    expect(ensureSeatOnReconnect(room, 'p3')).toBe(false);
  });

  it('游戏进行中 → 不补,返回 false', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    room.seats = Array(4).fill(null);
    room.status = '进行中';
    expect(ensureSeatOnReconnect(room, 'host')).toBe(false);
  });

  it('调试房间 → 不补,返回 false', () => {
    const room = createDebugRoom('调试', 4);
    room.seats = Array(4).fill(null);
    expect(ensureSeatOnReconnect(room, 'p1')).toBe(false);
  });

  it('补到首个空座(中间有空位)', () => {
    const room = createRoom('房间', 4, 'host', createMockSink());
    room.seats = ['host', null, 'p3', null];
    expect(ensureSeatOnReconnect(room, 'p2')).toBe(true);
    expect(room.seats).toEqual(['host', 'p2', 'p3', null]);
  });
});
