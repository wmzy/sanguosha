import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('黄忠', () => {
  describe('烈弓', () => {
    scenario('目标体力值≥自己时，添加cannotDodge标记')
      .setup(ctx => {
        ctx.selectCharacters('黄忠', '刘备');
        ctx.giveCard('P1', '杀');
        ctx.enterPlayPhase();
      })
      .act('黄忠使用杀指定刘备（两者体力都是4）', ctx => {
        const killId = ctx.findCard('P1', '杀')!;
        ctx.emitEvent({
          type: 'cardPlayed',
          player: 'P1',
          cardId: killId,
          target: 'P2',
        });
      })
      .check('刘备获得cannotDodge标记', ctx => {
        expect(ctx.player('P2').tags).toContain('cannotDodge');
      })
      .run();

    scenario('目标手牌数≥自己时，添加cannotDodge标记')
      .setup(ctx => {
        ctx.selectCharacters('黄忠', '刘备');
        ctx.giveCard('P1', '杀');
        ctx.giveCard('P2', '闪');
        ctx.giveCard('P2', '闪');
        ctx.setHealth('P2', 2);
        ctx.enterPlayPhase();
      })
      .act('黄忠使用杀（P2体力少但手牌多）', ctx => {
        const killId = ctx.findCard('P1', '杀')!;
        ctx.emitEvent({
          type: 'cardPlayed',
          player: 'P1',
          cardId: killId,
          target: 'P2',
        });
      })
      .check('P2获得cannotDodge标记（手牌数条件满足）', ctx => {
        expect(ctx.player('P2').tags).toContain('cannotDodge');
      })
      .run();

    scenario('条件不满足时不添加标记')
      .setup(ctx => {
        ctx.selectCharacters('黄忠', '刘备');
        ctx.giveCard('P1', '杀');
        ctx.setHealth('P2', 2);
        ctx.enterPlayPhase();
      })
      .act('黄忠使用杀（P2体力和手牌都少于P1）', ctx => {
        const killId = ctx.findCard('P1', '杀')!;
        ctx.emitEvent({
          type: 'cardPlayed',
          player: 'P1',
          cardId: killId,
          target: 'P2',
        });
      })
      .check('P2无cannotDodge标记', ctx => {
        expect(ctx.player('P2').tags).not.toContain('cannotDodge');
      })
      .run();
  });
});
