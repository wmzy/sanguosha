import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('董卓 - 崩坏', () => {
  scenario('回合结束时体力非最少则减1体力')
    .setup(ctx => {
      ctx.selectCharacters('董卓', '曹操');
      ctx.setHealth('P1', 8);
      ctx.setHealth('P2', 4);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('直接发射 turnEnd 事件触发崩坏', ctx => {
      ctx.emitEvent({ type: '回合结束', player: 'P1' });
    })
    .check('崩坏触发：创建选择 prompt', ctx => {
      expect(ctx.state.pending).not.toBeNull();
      expect(ctx.state.pending?.type).toBe('技能选择');
    })
    .run();

  scenario('体力已为最少时不触发崩坏')
    .setup(ctx => {
      ctx.selectCharacters('董卓', '曹操');
      ctx.setHealth('P1', 1);
      ctx.setHealth('P2', 4);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('结束回合（体力已为最少）', ctx => {
      ctx.emitEvent({ type: '回合结束', player: 'P1' });
    })
    .check('崩坏不触发：体力不变', ctx => {
      expect(ctx.player('P1').health).toBe(1);
    })
    .run();
});

describe('董卓 - 肉林', () => {
  it.skip('肉林：对女性角色使用杀需两张闪（需要无双类似的杀响应机制扩展）', () => {
    // 肉林需要杀响应流程支持双闪机制，与吕布无双类似但条件不同
    // 需要响应流程的扩展支持，暂时跳过
  });
});

describe('董卓 - 酒池', () => {
  it.skip('酒池：黑桃手牌当酒使用（需要酒牌系统支持）', () => {
    // 酒牌尚未在基本牌系统中定义，暂时跳过
  });
});

describe('董卓 - 暴虐', () => {
  it.skip('暴虐：主公技，其他群雄造成伤害后判定（需要主公身份+伤害事件监听）', () => {
    // 暴虐需要主公身份判定 + 监听其他群雄的伤害事件，暂时跳过
  });
});
