/**
 * tests/v2/event.test.ts — 事件工厂函数
 */
import { describe, it, expect } from 'vitest';
import { genId, makeServerEvent, makePlayerEvent } from '@engine/v2/event';

describe('genId', () => {
  it('returns a string', () => {
    expect(typeof genId()).toBe('string');
  });

  it('returns unique IDs on successive calls', () => {
    const id1 = genId();
    const id2 = genId();
    expect(id1).not.toBe(id2);
  });

  it('follows the evt_ prefix pattern', () => {
    const id = genId();
    expect(id).toMatch(/^evt_/);
  });
});

describe('makeServerEvent', () => {
  it('has correct type and payload', () => {
    const evt = makeServerEvent('damage', { target: 'P1', amount: 2 });
    expect(evt.type).toBe('damage');
    expect(evt.payload).toEqual({ target: 'P1', amount: 2 });
  });

  it('has an id string', () => {
    const evt = makeServerEvent('test', {});
    expect(typeof evt.id).toBe('string');
    expect(evt.id).toMatch(/^evt_/);
  });

  it('has a timestamp close to now', () => {
    const before = Date.now();
    const evt = makeServerEvent('test', {});
    const after = Date.now();
    expect(evt.timestamp).toBeGreaterThanOrEqual(before);
    expect(evt.timestamp).toBeLessThanOrEqual(after);
  });
});

describe('makePlayerEvent', () => {
  it('has correct type and payload', () => {
    const evt = makePlayerEvent('draw', { player: 'P1', count: 2 });
    expect(evt.type).toBe('draw');
    expect(evt.payload).toEqual({ player: 'P1', count: 2 });
  });

  it('has an id string', () => {
    const evt = makePlayerEvent('test', {});
    expect(typeof evt.id).toBe('string');
  });

  it('has a timestamp', () => {
    const evt = makePlayerEvent('test', {});
    expect(typeof evt.timestamp).toBe('number');
  });
});
