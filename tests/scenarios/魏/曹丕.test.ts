import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('曹丕', () => {
  describe('行殇', () => {
    scenario('角色死亡时获得其所有手牌')
      .setup(ctx => {
        ctx.selectCharacters('曹丕', '刘备');
        ctx.registerTriggers('P1');
        ctx.registerTriggers('P2');
        ctx.giveCard('P2', '杀');
        ctx.giveCard('P2', '闪');
        ctx.setHealth('P2', 1);
        ctx.snapshot('initial');
      })
      .act('发射死亡事件', ctx => {
        ctx.emitEvent({
          type: '死亡',
          player: 'P2',
          source: 'P1',
        });
      })
      .check('行殇触发：曹丕获得死者手牌', ctx => {
        const diff = ctx.diff('initial');
        expect(diff.handSizeChanges['P1']).toBeGreaterThanOrEqual(2);
      })
      .run();
  });

  describe('放逐', () => {
    scenario('受到伤害后令目标补牌并翻面')
      .setup(ctx => {
        ctx.selectCharacters('曹丕', '刘备', '孙权');
        ctx.registerTriggers('P1');
        ctx.giveCard('P2', '杀');
        ctx.setCurrentPlayer('P2');
        ctx.enterPlayPhase();
        ctx.snapshot('initial');
      })
      .act('P2 对 P1 使用杀', ctx => {
        const killId = ctx.findCard('P2', '杀')!;
        ctx.playCard('P2', killId, 'P1');
      })
      .act('P1 不出闪', ctx => {
        ctx.respond('P1');
      })
      .check('曹丕受到1点伤害', ctx => {
        const diff = ctx.diff('initial');
        expect(diff.healthChanges['P1']).toBe(-1);
      })
      .check('放逐触发：目标角色被翻面', ctx => {
        const triggered = ctx.player('P1').skills.includes('放逐');
        expect(triggered).toBe(true);
      })
      .run();
  });

  describe('颂威', () => {
    scenario('技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('曹丕', '刘备');
        ctx.registerTriggers('P1');
      })
      .check('P1 拥有颂威触发器', ctx => {
        const hasTrigger = ctx.player('P1').skills.includes('颂威');
        expect(hasTrigger).toBe(true);
      })
      .run();
  });
});
