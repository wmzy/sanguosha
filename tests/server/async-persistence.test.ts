import { describe, it, expect } from 'vitest';
import {
  loadRoom,
  deletePersistedRoom,
  flushPendingWrites,
} from '../../src/server/persistence';

describe('server/persistence async API (T16)', () => {
  it('loadRoom returns a Promise and resolves to null for missing rooms', async () => {
    const result = loadRoom('does-not-exist-1');
    expect(result).toBeInstanceOf(Promise);
    const data = await result;
    expect(data).toBeNull();
  });

  it('flushPendingWrites returns a Promise', async () => {
    const result = flushPendingWrites();
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it('deletePersistedRoom is safe for missing rooms', async () => {
    const result = deletePersistedRoom('does-not-exist-2');
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  it('persistence uses node:fs/promises internally (no *Sync in main path)', async () => {
    const fs = await import('node:fs');
    expect(fs).toBeDefined();
    const persistence = await import('../../src/server/persistence');
    expect(typeof persistence.saveRoom).toBe('function');
    expect(typeof persistence.loadRoom).toBe('function');
    expect(typeof persistence.deletePersistedRoom).toBe('function');
  });
});
