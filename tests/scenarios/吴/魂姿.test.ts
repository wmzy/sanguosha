import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('孙策 - 魂姿', () => {
  scenario('体力为1时觉醒获得英姿和英魂')
    .setup(ctx => {
      ctx.selectCharacters('孙策', '刘备');
      ctx.setHealth('P1', 1);
    })
    .act('触发准备阶段', ctx => {
      ctx.emitEvent({ type: '阶段开始', phase: '准备', player: 'P1' });
    })
    .check('魂姿已觉醒标记', ctx => {
      expect(ctx.player('P1').vars['魂姿/awakened']).toBe(true);
    })
    .check('体力上限减少1', ctx => {
      expect(ctx.player('P1').maxHealth).toBe(3);
    })
    .check('获得英姿触发器', ctx => {
      const has英姿 = ctx.state.triggers.some(
        t => t.player === 'P1' && t.skillId === '英姿',
      );
      expect(has英姿).toBe(true);
    })
    .check('获得英魂触发器', ctx => {
      const has英魂 = ctx.state.triggers.some(
        t => t.player === 'P1' && t.skillId === '英魂',
      );
      expect(has英魂).toBe(true);
    })
    .run();

  scenario('体力大于1时魂姿不触发')
    .setup(ctx => {
      ctx.selectCharacters('孙策', '刘备');
      ctx.setHealth('P1', 2);
    })
    .act('触发准备阶段', ctx => {
      ctx.emitEvent({ type: '阶段开始', phase: '准备', player: 'P1' });
    })
    .check('魂姿未触发', ctx => {
      expect(ctx.player('P1').vars['魂姿/awakened']).toBeUndefined();
    })
    .check('体力上限不变', ctx => {
      expect(ctx.player('P1').maxHealth).toBe(4);
    })
    .run();

  scenario('已觉醒后不再触发')
    .setup(ctx => {
      ctx.selectCharacters('孙策', '刘备');
      ctx.setHealth('P1', 1);
      const p = ctx.player('P1');
      ctx.state = {
        ...ctx.state,
        players: {
          ...ctx.state.players,
          P1: { ...p, vars: { ...p.vars, '魂姿/awakened': true } },
        },
      };
    })
    .act('再次触发准备阶段', ctx => {
      ctx.emitEvent({ type: '阶段开始', phase: '准备', player: 'P1' });
    })
    .check('体力上限不再减少', ctx => {
      expect(ctx.player('P1').maxHealth).toBe(4);
    })
    .check('不重复添加技能触发器', ctx => {
      const yingziCount = ctx.state.triggers.filter(
        t => t.player === 'P1' && t.skillId === '英姿',
      ).length;
      expect(yingziCount).toBe(0);
    })
    .run();

  scenario('技能注册检查')
    .setup(ctx => {
      ctx.selectCharacters('孙策', '刘备');
      ctx.registerTriggers('P1');
    })
    .check('P1 拥有魂姿触发器', ctx => {
      const hasTrigger = ctx.state.triggers.some(
        t => t.player === 'P1' && t.skillId === '魂姿',
      );
      expect(hasTrigger).toBe(true);
    })
    .run();
});
