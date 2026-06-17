// LEGACY TEST: references deleted v2 modules - skipped
import { describe, it, expect, beforeEach } from 'vitest';
// import { makeServerEvent, makePlayerEvent, resetEventCounter } from '@engine/event';  // LEGACY: removed (v2 module deleted)

describe.skip('makeServerEvent', () => {
  beforeEach(() => resetEventCounter(0));

  it('has correct type and payload', () => {
    const evt = makeServerEvent('造成伤害', { target: 'P1', amount: 2 });
    expect(evt.type).toBe('造成伤害');
    expect(evt.payload).toEqual({ target: 'P1', amount: 2 });
  });

  it('has an id string', () => {
    const evt = makeServerEvent('test', {});
    expect(typeof evt.id).toBe('string');
    expect(evt.id).toMatch(/^evt-/);
  });

  it('produces unique IDs', () => {
    const evt1 = makeServerEvent('test', {});
    const evt2 = makeServerEvent('test', {});
    expect(evt1.id).not.toBe(evt2.id);
  });

  it('has a timestamp close to now', () => {
    const before = Date.now();
    const evt = makeServerEvent('test', {});
    const after = Date.now();
    expect(evt.timestamp).toBeGreaterThanOrEqual(before);
    expect(evt.timestamp).toBeLessThanOrEqual(after);
  });
});

describe.skip('makePlayerEvent', () => {
  beforeEach(() => resetEventCounter(0));

  it('has correct type and payload', () => {
    const evt = makePlayerEvent('摸牌', { player: 'P1', count: 2 });
    expect(evt.type).toBe('摸牌');
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
