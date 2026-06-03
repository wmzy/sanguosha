import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('卧龙诸葛', () => {
  describe('八阵', () => {
    scenario('无防具时，添加virtualArmor标记')
      .setup(ctx => {
        ctx.selectCharacters('卧龙诸葛', '刘备');
      })
      .act('触发turnStart事件', ctx => {
        ctx.emitEvent({ type: 'turnStart', player: 'P1' });
      })
      .check('卧龙诸葛获得virtualArmor标记', ctx => {
        expect(ctx.player('P1').tags).toContain('virtualArmor');
      })
      .run();

    scenario('有防具时，不添加virtualArmor标记')
      .setup(ctx => {
        ctx.selectCharacters('卧龙诸葛', '刘备');
        ctx.giveCard('P1', '八卦阵');
        const cardId = ctx.findCard('P1', '八卦阵')!;
        const p = ctx.player('P1');
        ctx.state = {
          ...ctx.state,
          players: {
            ...ctx.state.players,
            P1: { ...p, equipment: { ...p.equipment, armor: cardId }, hand: p.hand.filter(id => id !== cardId) },
          },
        };
      })
      .act('触发turnStart事件', ctx => {
        ctx.emitEvent({ type: 'turnStart', player: 'P1' });
      })
      .check('卧龙诸葛不获得virtualArmor标记（已有防具）', ctx => {
        expect(ctx.player('P1').tags).not.toContain('virtualArmor');
      })
      .run();
  });

  describe('火计', () => {
    scenario('火计技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('卧龙诸葛', '刘备');
        ctx.giveCard('P1', '杀'); // 红色或黑色都行，给一张牌
        ctx.enterPlayPhase();
      })
      .act('确认技能已注册（无报错即可）', ctx => {
        // 火计是主动技，通过 useSkill 触发
        // 在当前引擎中，convert 类型技能通过 playCard 路径处理
        // 此测试确认技能注册无误
      })
      .check('卧龙诸葛有火计技能触发器', ctx => {
        const triggers = ctx.state.triggers.filter(
          t => t.player === 'P1' && t.skillId === '火计',
        );
        expect(triggers.length).toBeGreaterThan(0);
      })
      .run();
  });

  describe('看破', () => {
    scenario('看破技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('卧龙诸葛', '刘备');
      })
      .act('确认技能已注册', ctx => {
        // 看破是主动技，在 trickResponse 窗口中使用
      })
      .check('卧龙诸葛有看破技能触发器', ctx => {
        const triggers = ctx.state.triggers.filter(
          t => t.player === 'P1' && t.skillId === '看破',
        );
        expect(triggers.length).toBeGreaterThan(0);
      })
      .run();
  });
});
