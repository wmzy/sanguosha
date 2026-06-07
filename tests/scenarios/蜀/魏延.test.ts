import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('魏延', () => {
  describe('狂骨', () => {
    scenario('对距离1以内的角色造成伤害时回复1点体力')
      .setup(ctx => {
        ctx.selectCharacters('魏延', '刘备');
        ctx.setHealth('P1', 2);
        ctx.snapshot('initial');
      })
      .act('魏延对P2造成伤害（距离1）', ctx => {
        ctx.emitEvent({
          type: '造成伤害',
          source: 'P1',
          target: 'P2',
          amount: 1,
        });
      })
      .check('魏延回复1点体力', ctx => {
        expect(ctx.player('P1').health).toBe(3);
      })
      .run();

    scenario('不是自己造成的伤害不触发')
      .setup(ctx => {
        ctx.selectCharacters('魏延', '刘备');
        ctx.setHealth('P1', 2);
        ctx.snapshot('initial');
      })
      .act('P2对P3造成伤害（不是魏延造成的）', ctx => {
        ctx.emitEvent({
          type: '造成伤害',
          source: 'P2',
          target: 'P1',
          amount: 1,
        });
      })
      .check('魏延不回复体力', ctx => {
        expect(ctx.player('P1').health).toBe(2);
      })
      .run();
  });
});
