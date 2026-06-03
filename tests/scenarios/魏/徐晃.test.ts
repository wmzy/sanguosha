import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('徐晃 - 断粮', () => {
  it.skip('断粮：将黑色基本牌当兵粮寸断使用（需要引擎支持卡牌→延时锦囊转换）', () => {
    // 断粮需要将黑色基本牌/装备牌当兵粮寸断使用
    // 需要在 validate 层增加技能卡牌转换机制
  });

  scenario('断粮技能注册检查')
    .setup(ctx => {
      ctx.selectCharacters('徐晃', '刘备');
      ctx.registerTriggers('P1');
    })
    .check('P1 拥有断粮触发器', ctx => {
      const hasTrigger = ctx.state.triggers.some(
        t => t.player === 'P1' && t.skillId === '断粮',
      );
      expect(hasTrigger).toBe(true);
    })
    .run();
});
