import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('周瑜 - 英姿', () => {
  scenario('摸牌阶段额外摸一张牌（通过 auto-advance 引擎路径）')
    .setup(ctx => {
      ctx.selectCharacters('周瑜', '刘备');
      ctx.snapshot('initial');
    })
    .act('触发阶段自动推进', ctx => {
      // 起始 phase='准备', 通过一个无副作用 action 触发 advanceToInteractivePhase
      ctx.engineAction({ type: 'toggleAutoSkipWuxie' });
    })
    .check('推进到出牌阶段', ctx => {
      expect(ctx.state.phase).toBe('出牌');
    })
    .check('英姿触发：摸牌阶段摸了 3 张（2 基础 + 1 英姿）', ctx => {
      // 初始手牌 4，摸牌阶段摸 3 张 = 7
      // 但周瑜 health=3，如果手牌上限不够... 初始 health=3, hand=4
      // 但 auto-advance 不会触发 endTurn，所以只在当前回合内
      expect(ctx.handSize('P1')).toBe(7);
    })
    .run();

  scenario('没有英姿时摸牌阶段只摸 2 张')
    .setup(ctx => {
      ctx.selectCharacters('刘备', '周瑜');
      ctx.snapshot('initial');
    })
    .act('触发阶段自动推进', ctx => {
      ctx.engineAction({ type: 'toggleAutoSkipWuxie' });
    })
    .check('刘备没有英姿，只摸 2 张', ctx => {
      // 初始手牌 4 + 2 = 6
      expect(ctx.handSize('P1')).toBe(6);
    })
    .run();
});
