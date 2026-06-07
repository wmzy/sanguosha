import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('求桃 savers 顺序', () => {
  scenario('小乔濒死时 savers 从当前回合玩家开始，濒死者最后自救')
    .setup((ctx) => {
      // P1=刘禅 P2=小乔 P3=姜维 P4=颜良文丑 P5=夏侯惇
      ctx.selectCharacters('刘禅', '小乔', '姜维', '颜良文丑', '夏侯惇');
      ctx.setHealth('P2', 1); // 小乔 1 血
      ctx.setCurrentPlayer('P4'); // 颜良文丑是当前回合
      ctx.enterPlayPhase();
      ctx.ensureNoKill('P2');
      ctx.giveCard('P4', '决斗', 1);
    })
    .act('颜良文丑对小乔出决斗', (ctx) => {
      const duel = ctx.findCard('P4', '决斗');
      ctx.playCard('P4', duel!, 'P2');
    })
    .check('推进到小乔濒死', (ctx) => {
      for (const p of ['P5', 'P1', 'P2', 'P3']) ctx.respond(p);
      ctx.respond('P2'); // P2 不出杀
      const pending = ctx.state.pending;
      expect(pending?.type).toBe('濒死窗口');
      if (pending?.type === '濒死窗口') {
        // 规则：从当前回合 P4 开始，依次 P4, P5, P1, P3，濒死者 P2 最后自救
        expect(pending.savers).toEqual(['P4', 'P5', 'P1', 'P3', 'P2']);
      }
    })
    .run();
});
