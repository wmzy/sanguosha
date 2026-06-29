import { describe, it, expect, beforeEach } from 'vitest';
import {
  register,
  unregister,
  shutdownAll,
  getResourceCount,
  _resetForTests,
} from '../../src/server/lifecycles';

describe('server/lifecycles', () => {
  beforeEach(() => {
    _resetForTests();
  });

  it('register adds a resource to the registry', () => {
    const cleanup = () => {};
    register('test-resource', { id: 1 }, cleanup);
    expect(getResourceCount()).toBe(1);
  });

  it('unregister removes a resource and calls its cleanup', async () => {
    let cleaned = false;
    register('test-resource', { id: 1 }, () => {
      cleaned = true;
    });
    await unregister('test-resource');
    expect(getResourceCount()).toBe(0);
    expect(cleaned).toBe(true);
  });

  it('unregister is a no-op for unknown resources', async () => {
    await unregister('nonexistent');
    expect(getResourceCount()).toBe(0);
  });

  it('shutdownAll calls cleanup for all registered resources', async () => {
    const cleaned: string[] = [];
    register('a', {}, () => {
      cleaned.push('a');
    });
    register('b', {}, () => {
      cleaned.push('b');
    });
    register('c', {}, () => {
      cleaned.push('c');
    });
    await shutdownAll();
    expect(cleaned.sort()).toEqual(['a', 'b', 'c']);
    expect(getResourceCount()).toBe(0);
  });

  it('shutdownAll continues even if one cleanup throws', async () => {
    const cleaned: string[] = [];
    register('a', {}, () => {
      cleaned.push('a');
    });
    register('b', {}, () => {
      throw new Error('boom');
    });
    register('c', {}, () => {
      cleaned.push('c');
    });
    await shutdownAll();
    expect(cleaned.sort()).toEqual(['a', 'c']);
  });

  it('register with same name overrides previous', () => {
    let firstCleaned = false;
    let secondCleaned = false;
    register('dup', {}, () => {
      firstCleaned = true;
    });
    register('dup', {}, () => {
      secondCleaned = true;
    });
    expect(getResourceCount()).toBe(1);
    return shutdownAll().then(() => {
      expect(firstCleaned).toBe(false);
      expect(secondCleaned).toBe(true);
    });
  });

  it('register without cleanup just removes from registry', async () => {
    register('test-no-cleanup', { id: 1 });
    expect(getResourceCount()).toBe(1);
    await shutdownAll();
    expect(getResourceCount()).toBe(0);
  });
});
