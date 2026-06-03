import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('夏侯渊 - 神速', () => {
  it.skip('神速：跳过判定和摸牌阶段，视为使用杀（需要引擎支持"视为使用杀"基础设施）', () => {
    // 神速涉及：选择1-2项、跳过阶段、视为使用无距离限制杀、选择目标
    // 当前引擎不支持"视为使用杀"的技能→牌转换机制
    // 需要后续在 engine 层增加 virtualKill / skillCardPlay 基础设施后实现
  });

  scenario('神速技能注册检查')
    .setup(ctx => {
      ctx.selectCharacters('夏侯渊', '刘备');
      ctx.registerTriggers('P1');
    })
    .check('P1 拥有神速触发器', ctx => {
      const hasTrigger = ctx.state.triggers.some(
        t => t.player === 'P1' && t.skillId === '神速',
      );
      expect(hasTrigger).toBe(true);
    })
    .run();
});
