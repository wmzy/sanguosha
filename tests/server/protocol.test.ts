// tests/server/protocol.test.ts
// 服务端协议层覆盖率补充:normalizeRoomConfig / serialize
import { describe, it, expect } from 'vitest';
import {
  normalizeRoomConfig,
  serialize,
  DEFAULT_ROOM_CONFIG,
  type ServerMessage,
} from '../../src/server/protocol';

// ─── normalizeRoomConfig ────────────────────────────────────
describe('normalizeRoomConfig', () => {
  it('合法配置原样通过', () => {
    const cfg = normalizeRoomConfig({
      name: '测试房',
      timeoutSec: 60,
      charPool: 'standard',
      handSize: 6,
    });
    expect(cfg.name).toBe('测试房');
    expect(cfg.timeoutSec).toBe(60);
    expect(cfg.charPool).toBe('standard');
    expect(cfg.handSize).toBe(6);
    expect(cfg.chat).toBeDefined();
    expect(cfg.chat.enabled).toBe(true);
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

  it('timeoutSec 负数/非数字回退默认值,0=无限(合法)', () => {
    expect(normalizeRoomConfig({ timeoutSec: 0 }).timeoutSec).toBe(0);
    expect(normalizeRoomConfig({ timeoutSec: -1 }).timeoutSec).toBe(
      DEFAULT_ROOM_CONFIG.timeoutSec,
    );
    expect(normalizeRoomConfig({ timeoutSec: 'fast' }).timeoutSec).toBe(
      DEFAULT_ROOM_CONFIG.timeoutSec,
    );
  });

  it('timeoutSec 小数被 floor 取整', () => {
    expect(normalizeRoomConfig({ timeoutSec: 15.7 }).timeoutSec).toBe(15);
  });

  it('timeoutSec = Infinity 回退默认值(非有限数)', () => {
    expect(normalizeRoomConfig({ timeoutSec: Infinity }).timeoutSec).toBe(
      DEFAULT_ROOM_CONFIG.timeoutSec,
    );
  });

  it('timeoutSec = NaN 回退默认值', () => {
    expect(normalizeRoomConfig({ timeoutSec: NaN }).timeoutSec).toBe(
      DEFAULT_ROOM_CONFIG.timeoutSec,
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

// ─── serialize ──────────────────────────────────────────────
describe('serialize', () => {
  it('serialize 返回合法 JSON 字符串', () => {
    const msg: ServerMessage = { type: 'error', message: '测试错误' };
    const s = serialize(msg);
    expect(typeof s).toBe('string');
    expect(JSON.parse(s)).toEqual(msg);
  });
});
