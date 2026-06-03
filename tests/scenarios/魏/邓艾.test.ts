import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('邓艾', () => {
  describe('屯田', () => {
    it.skip('屯田：回合外失去牌时判定攒田（需要引擎支持"回合外失去牌"事件追踪）', () => {
      // 屯田需要在回合外失去牌时触发判定
      // 需要引擎增加 cardLost 事件或类似的追踪机制
    });

    scenario('屯田技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('邓艾', '刘备');
        ctx.registerTriggers('P1');
      })
      .check('P1 拥有屯田触发器', ctx => {
        const hasTrigger = ctx.state.triggers.some(
          t => t.player === 'P1' && t.skillId === '屯田',
        );
        expect(hasTrigger).toBe(true);
      })
      .run();
  });

  describe('凿险', () => {
    it.skip('凿险：觉醒技（需要引擎支持觉醒技和体力上限修改）', () => {
      // 凿险需要：检查田数、减体力上限、获得新技能
      // 需要引擎支持 maxHealth 修改和动态技能获取
    });

    scenario('凿险技能注册检查')
      .setup(ctx => {
        ctx.selectCharacters('邓艾', '刘备');
        ctx.registerTriggers('P1');
      })
      .check('P1 拥有凿险触发器', ctx => {
        const hasTrigger = ctx.state.triggers.some(
          t => t.player === 'P1' && t.skillId === '凿险',
        );
        expect(hasTrigger).toBe(true);
      })
      .run();
  });
});
