import { describe, expect, it } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('吕布 - 无双', () => {
  it.skip('杀需2闪抵消：吕布杀目标，目标出1闪不够仍受伤', () => {
    // 需要：修改 killResponse 窗口支持 requiredFlashCount
    // 当前引擎限制：杀响应只接受1张闪，不支持多牌响应
    // 需要：PendingResponseWindow 增加 requiredCount 字段
    // 需要：resolveKillResponse 支持部分闪避（出1闪继续要第2闪）
    // 需要：computeResponseWindowActions 和 validateResponseWindow 处理多牌
  });

  it.skip('杀需2闪抵消：目标出2闪完全抵消', () => {
    // 同上，需要多牌响应基础设施
  });

  it.skip('决斗需2杀：吕布参与决斗时对方需出2杀', () => {
    // 需要：修改 duelResponse 窗口支持 requiredKillCount
    // 当前引擎限制：决斗响应只接受1张杀
    // 需要：resolveDuelResponse 支持多轮出杀
  });

  scenario('无双标记已正确注册（passive modifier）')
    .setup(ctx => {
      ctx.selectCharacters('吕布', '刘备');
      ctx.registerTriggers('P1');
      const p1 = ctx.player('P1');
      const hasWushuang = ctx.state.triggers.some(
        t => t.skillId === '无双' && t.player === 'P1',
      );
      expect(hasWushuang).toBe(true);
    })
    .run();
});
