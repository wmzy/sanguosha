import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('孙权 - 救援', () => {
  scenario('吴势力角色用桃时孙权额外回1体力')
    .setup(ctx => {
      ctx.selectCharacters('孙权', '甘宁', '刘备');
      ctx.setHealth('P1', 2);
      ctx.snapshot('initial');
    })
    .act('模拟吴势力甘宁对孙权heal事件', ctx => {
      ctx.emitEvent({ type: '回复体力', target: 'P1', amount: 1, source: 'P2' });
    })
    .check('孙权额外回复1体力', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(1);
    })
    .run();

  scenario('非吴势力角色heal不触发救援')
    .setup(ctx => {
      ctx.selectCharacters('孙权', '甘宁', '刘备');
      ctx.setHealth('P1', 2);
      ctx.snapshot('initial');
    })
    .act('模拟蜀势力刘备对孙权heal事件', ctx => {
      ctx.emitEvent({ type: '回复体力', target: 'P1', amount: 1, source: 'P3' });
    })
    .check('孙权不额外回复', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(0);
    })
    .run();

  scenario('孙权自己heal不触发救援')
    .setup(ctx => {
      ctx.selectCharacters('孙权', '甘宁', '刘备');
      ctx.setHealth('P1', 2);
      ctx.snapshot('initial');
    })
    .act('模拟孙权对自己heal事件', ctx => {
      ctx.emitEvent({ type: '回复体力', target: 'P1', amount: 1, source: 'P1' });
    })
    .check('孙权不额外回复', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(0);
    })
    .run();
});
