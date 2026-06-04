import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';
import { getPlayer } from '@engine/state';

describe('决斗 → 小乔濒死', () => {
  scenario('小乔 1 血时被决斗 → 0 血 → 进 dyingWindow')
    .setup((ctx) => {
      ctx.selectCharacters('刘禅', '小乔', '姜维', '颜良文丑', '夏侯惇');
      ctx.setHealth('P2', 1);
      ctx.setCurrentPlayer('P4');
      ctx.enterPlayPhase();
      ctx.ensureNoKill('P2');
      ctx.giveCard('P4', '决斗', 1);
    })
    .act('颜良文丑对小乔出决斗', (ctx) => {
      const duel = ctx.findCard('P4', '决斗');
      ctx.playCard('P4', duel!, 'P2');
    })
    .check('推进 trickResponse 链', (ctx) => {
      for (const p of ['P5', 'P1', 'P2', 'P3']) ctx.respond(p);
      ctx.respond('P2');
      const xq = getPlayer(ctx.state, 'P2');
      expect({
        hp: xq.health,
        alive: xq.info.alive,
        pending: ctx.pendingType(),
      }).toEqual({ hp: 0, alive: true, pending: 'dyingWindow' });
    })
    .run();
});
