import { describe, it, expect } from 'vitest';
import { InterruptStack } from '@engine/interrupt';

describe('InterruptStack', () => {
  it('should push and resolve an interrupt', async () => {
    const stack = new InterruptStack();
    const promise = stack.wait<boolean>('kill_response', { attacker: '曹操', target: '刘备' });
    stack.resolve(true);
    const result = await promise;
    expect(result).toBe(true);
  });

  it('should handle nested interrupts', async () => {
    const stack = new InterruptStack();
    const promise1 = stack.wait<boolean>('trick_response', { trick: '过河拆桥' });
    const promise2 = stack.wait<boolean>('trick_response', { trick: '无懈可击' });
    stack.resolve(false); // inner resolved first
    const result2 = await promise2;
    expect(result2).toBe(false);
    stack.resolve(true); // outer resolved
    const result1 = await promise1;
    expect(result1).toBe(true);
  });

  it('should report current interrupt', () => {
    const stack = new InterruptStack();
    expect(stack.current()).toBeUndefined();
    stack.wait<boolean>('dying', { player: '刘备' });
    expect(stack.current()?.type).toBe('dying');
  });

  it('should report empty state', () => {
    const stack = new InterruptStack();
    expect(stack.isEmpty()).toBe(true);
    stack.wait<boolean>('dying', { player: '刘备' });
    expect(stack.isEmpty()).toBe(false);
  });

  it('should handle multiple resolves in order', async () => {
    const stack = new InterruptStack();
    const p1 = stack.wait<string>('kill_response', {});
    const p2 = stack.wait<string>('dying', {});
    stack.resolve('saved');
    stack.resolve('dodged');
    expect(await p2).toBe('saved');
    expect(await p1).toBe('dodged');
  });
});
