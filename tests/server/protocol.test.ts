// tests/server/protocol.test.ts
// 服务端协议层覆盖率补充:normalizeRoomConfig / isValidClientMessage / serialize / deserialize
import { describe, it, expect } from 'vitest';
import {
  normalizeRoomConfig,
  isValidClientMessage,
  serialize,
  deserialize,
  DEFAULT_ROOM_CONFIG,
  type ClientMessage,
  type ServerMessage,
} from '../../src/server/protocol';

// ─── normalizeRoomConfig ────────────────────────────────────
describe('normalizeRoomConfig', () => {
  it('合法配置原样通过', () => {
    const cfg = normalizeRoomConfig({
      name: '测试房',
      timeoutScale: 2,
      charPool: 'standard',
      handSize: 6,
    });
    expect(cfg).toEqual({
      name: '测试房',
      timeoutScale: 2,
      charPool: 'standard',
      handSize: 6,
    });
  });

  it('空对象回退默认值', () => {
    const cfg = normalizeRoomConfig({});
    expect(cfg).toEqual(DEFAULT_ROOM_CONFIG);
  });

  it('null/undefined 安全回退默认值', () => {
    expect(normalizeRoomConfig(null)).toEqual(DEFAULT_ROOM_CONFIG);
    expect(normalizeRoomConfig(undefined)).toEqual(DEFAULT_ROOM_CONFIG);
  });

  it('name 超长截断到 40 字符', () => {
    const longName = 'A'.repeat(100);
    const cfg = normalizeRoomConfig({ name: longName });
    expect(cfg.name).toHaveLength(40);
  });

  it('name 空白/非字符串回退默认值', () => {
    expect(normalizeRoomConfig({ name: '   ' }).name).toBe(DEFAULT_ROOM_CONFIG.name);
    expect(normalizeRoomConfig({ name: 123 }).name).toBe(DEFAULT_ROOM_CONFIG.name);
  });

  it('timeoutScale 非正数回退默认值', () => {
    expect(normalizeRoomConfig({ timeoutScale: 0 }).timeoutScale).toBe(
      DEFAULT_ROOM_CONFIG.timeoutScale,
    );
    expect(normalizeRoomConfig({ timeoutScale: -1 }).timeoutScale).toBe(
      DEFAULT_ROOM_CONFIG.timeoutScale,
    );
    expect(normalizeRoomConfig({ timeoutScale: 'fast' }).timeoutScale).toBe(
      DEFAULT_ROOM_CONFIG.timeoutScale,
    );
  });

  it('timeoutScale 超过 1000 视为 Infinity', () => {
    expect(normalizeRoomConfig({ timeoutScale: 1001 }).timeoutScale).toBe(Infinity);
  });

  it('timeoutScale = NaN 回退默认值', () => {
    expect(normalizeRoomConfig({ timeoutScale: NaN }).timeoutScale).toBe(
      DEFAULT_ROOM_CONFIG.timeoutScale,
    );
  });

  it('charPool 非法值回退默认值', () => {
    expect(normalizeRoomConfig({ charPool: 'invalid' }).charPool).toBe(
      DEFAULT_ROOM_CONFIG.charPool,
    );
    expect(normalizeRoomConfig({ charPool: 'extended' }).charPool).toBe('extended');
  });

  it('handSize 超范围回退默认值', () => {
    expect(normalizeRoomConfig({ handSize: -1 }).handSize).toBe(DEFAULT_ROOM_CONFIG.handSize);
    expect(normalizeRoomConfig({ handSize: 21 }).handSize).toBe(DEFAULT_ROOM_CONFIG.handSize);
    expect(normalizeRoomConfig({ handSize: 'abc' }).handSize).toBe(DEFAULT_ROOM_CONFIG.handSize);
  });

  it('handSize 小数向下取整', () => {
    expect(normalizeRoomConfig({ handSize: 4.9 }).handSize).toBe(4);
  });

  it('handSize 边界值 0 和 20 合法', () => {
    expect(normalizeRoomConfig({ handSize: 0 }).handSize).toBe(0);
    expect(normalizeRoomConfig({ handSize: 20 }).handSize).toBe(20);
  });
});

// ─── isValidClientMessage ───────────────────────────────────
describe('isValidClientMessage', () => {
  it('非对象返回 false', () => {
    expect(isValidClientMessage(null)).toBe(false);
    expect(isValidClientMessage('hello')).toBe(false);
    expect(isValidClientMessage(42)).toBe(false);
    expect(isValidClientMessage(undefined)).toBe(false);
  });

  it('未知 type 返回 false', () => {
    expect(isValidClientMessage({ type: 'unknown' })).toBe(false);
  });

  it('ready/start_game/restart_game/leave_room 始终合法', () => {
    for (const type of ['ready', 'start_game', 'restart_game', 'leave_room']) {
      expect(isValidClientMessage({ type })).toBe(true);
    }
  });

  it('action 需要合法的 baseSeq + engine message', () => {
    expect(
      isValidClientMessage({
        type: 'action',
        baseSeq: 5,
        action: {
          skillId: '杀',
          actionType: 'use',
          ownerId: 0,
          params: { target: 1 },
          baseSeq: 5,
        },
      }),
    ).toBe(true);
  });

  it('action 缺少 baseSeq 非法', () => {
    expect(
      isValidClientMessage({
        type: 'action',
        action: { skillId: '杀', actionType: 'use', ownerId: 0, params: {}, baseSeq: 0 },
      }),
    ).toBe(false);
  });

  it('action 的 engine message 缺字段非法', () => {
    expect(
      isValidClientMessage({
        type: 'action',
        baseSeq: 0,
        action: { skillId: '杀', actionType: 'use' },
      }),
    ).toBe(false);
  });

  it('action 的 engine message ownerId 非数字非法', () => {
    expect(
      isValidClientMessage({
        type: 'action',
        baseSeq: 0,
        action: { skillId: '杀', actionType: 'use', ownerId: '0', params: {}, baseSeq: 0 },
      }),
    ).toBe(false);
  });

  it('reorder_hand 需要字符串数组', () => {
    expect(isValidClientMessage({ type: 'reorder_hand', order: ['a', 'b'] })).toBe(true);
    expect(isValidClientMessage({ type: 'reorder_hand', order: ['a', 1] })).toBe(false);
    expect(isValidClientMessage({ type: 'reorder_hand', order: 'abc' })).toBe(false);
    expect(isValidClientMessage({ type: 'reorder_hand' })).toBe(false);
  });

  it('set_player_id 需要非空字符串', () => {
    expect(isValidClientMessage({ type: 'set_player_id', playerId: 'p1' })).toBe(true);
    expect(isValidClientMessage({ type: 'set_player_id', playerId: '' })).toBe(false);
    expect(isValidClientMessage({ type: 'set_player_id' })).toBe(false);
  });

  it('join_room / join_debug_room 需要 roomId', () => {
    expect(isValidClientMessage({ type: 'join_room', roomId: 'r1' })).toBe(true);
    expect(isValidClientMessage({ type: 'join_room' })).toBe(false);
    expect(isValidClientMessage({ type: 'join_debug_room', roomId: 'r1' })).toBe(true);
    expect(isValidClientMessage({ type: 'join_debug_room' })).toBe(false);
  });

  it('reconnect 需要 playerId', () => {
    expect(isValidClientMessage({ type: 'reconnect', playerId: 'p1' })).toBe(true);
    expect(isValidClientMessage({ type: 'reconnect' })).toBe(false);
  });

  it('create_room 需要 name + maxPlayers', () => {
    expect(isValidClientMessage({ type: 'create_room', name: '房', maxPlayers: 4 })).toBe(true);
    expect(isValidClientMessage({ type: 'create_room', name: '房' })).toBe(false);
    expect(isValidClientMessage({ type: 'create_room', maxPlayers: 4 })).toBe(false);
  });

  it('create_debug_room config 可选', () => {
    expect(isValidClientMessage({ type: 'create_debug_room' })).toBe(true);
    expect(isValidClientMessage({ type: 'create_debug_room', config: {} })).toBe(true);
    expect(isValidClientMessage({ type: 'create_debug_room', playerCount: 2 })).toBe(true);
    expect(isValidClientMessage({ type: 'create_debug_room', config: 'bad' })).toBe(false);
  });

  it('update_room_config 需要非空 config 对象', () => {
    expect(isValidClientMessage({ type: 'update_room_config', config: {} })).toBe(true);
    expect(isValidClientMessage({ type: 'update_room_config', config: null })).toBe(false);
    expect(isValidClientMessage({ type: 'update_room_config' })).toBe(false);
  });
});

// ─── serialize / deserialize ────────────────────────────────
describe('serialize / deserialize', () => {
  it('serialize 返回合法 JSON 字符串', () => {
    const msg: ServerMessage = { type: 'error', message: '测试错误' };
    const s = serialize(msg);
    expect(typeof s).toBe('string');
    expect(JSON.parse(s)).toEqual(msg);
  });

  it('deserialize 合法消息返回原对象', () => {
    const raw = JSON.stringify({ type: 'ready' });
    const msg = deserialize(raw);
    expect(msg).toEqual({ type: 'ready' });
  });

  it('deserialize 非法 type 返回 null', () => {
    expect(deserialize(JSON.stringify({ type: 'hacked' }))).toBeNull();
  });

  it('deserialize 破损 JSON 返回 null', () => {
    expect(deserialize('{ broken json')).toBeNull();
  });

  it('deserialize null 输入安全处理', () => {
    expect(deserialize('null')).toBeNull();
  });

  it('deserialize 非对象 JSON 返回 null', () => {
    expect(deserialize('"just a string"')).toBeNull();
    expect(deserialize('42')).toBeNull();
  });

  it('round-trip:复杂 action 消息', () => {
    const msg: ClientMessage = {
      type: 'action',
      baseSeq: 10,
      action: {
        skillId: '顺手牵羊',
        actionType: 'use',
        ownerId: 0,
        params: { target: 1 },
        baseSeq: 10,
      },
    };
    const s = JSON.stringify(msg);
    const result = deserialize(s);
    expect(result).toEqual(msg);
  });

  it('round-trip:create_room 消息', () => {
    const msg: ClientMessage = {
      type: 'create_room',
      name: '我的房间',
      maxPlayers: 8,
    };
    const result = deserialize(JSON.stringify(msg));
    expect(result).toEqual(msg);
  });
});
