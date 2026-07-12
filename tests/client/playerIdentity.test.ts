// @vitest-environment jsdom
// tests/client/playerIdentity.test.ts
// playerIdentity 工具单测:localStorage 读写、去空白、清除。
import { describe, it, expect, beforeEach } from 'vitest';
import { getPlayerId, hasPlayerId, setPlayerId, clearPlayerId } from '../../src/client/utils/playerIdentity';

describe('playerIdentity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未设置时 getPlayerId 返回 null,hasPlayerId 返回 false', () => {
    expect(getPlayerId()).toBeNull();
    expect(hasPlayerId()).toBe(false);
  });

  it('setPlayerId 持久化后 getPlayerId 返回该值', () => {
    setPlayerId('赵子龙');
    expect(getPlayerId()).toBe('赵子龙');
    expect(hasPlayerId()).toBe(true);
  });

  it('setPlayerId 去除首尾空白', () => {
    setPlayerId('  孔明  ');
    expect(getPlayerId()).toBe('孔明');
  });

  it('setPlayerId 空串/纯空白不写入', () => {
    setPlayerId('已设');
    setPlayerId('   ');
    expect(getPlayerId()).toBe('已设');
    setPlayerId('');
    expect(getPlayerId()).toBe('已设');
  });

  it('clearPlayerId 清除后 getPlayerId 返回 null', () => {
    setPlayerId('陆伯言');
    clearPlayerId();
    expect(getPlayerId()).toBeNull();
    expect(hasPlayerId()).toBe(false);
  });

  it('可覆盖更新已有身份', () => {
    setPlayerId('甲');
    setPlayerId('乙');
    expect(getPlayerId()).toBe('乙');
  });
});
