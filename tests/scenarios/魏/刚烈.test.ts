import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('夏侯惇 - 刚烈', () => {
  scenario('受到伤害后判定，非♥则来源受到1点伤害')
    .setup(ctx => {
      ctx.selectCharacters('夏侯惇', '刘备');
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P2');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P2 对 P1 使用杀', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.playCard('P2', killId!, 'P1');
    })
    .act('P1 不出闪', ctx => {
      ctx.respond('P1');
    })
    .check('P1 受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-1);
    })
    .check('刚烈触发：判定结果非♥时 P2 受到伤害或弃牌', ctx => {
      const diff = ctx.diff('initial');
      const p2HealthChange = diff.healthChanges['P2'] ?? 0;
      const p2HandChange = diff.handSizeChanges['P2'] ?? 0;
      const gangLieTriggered = p2HealthChange < 0 || p2HandChange < -1;
      expect(gangLieTriggered).toBe(true);
    })
    .run();
});
