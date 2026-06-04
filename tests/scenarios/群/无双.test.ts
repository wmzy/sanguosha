import { describe, expect, it } from 'vitest';
import { scenario } from '../../scenario-runner';

describe.skip('吕布 - 无双', () => {
  scenario('杀需2闪抵消：吕布杀目标，目标出1闪不够仍受伤')
    .setup(ctx => {
      ctx.selectCharacters('吕布', '刘备');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 出第1张闪（无双需2闪，还需1张）', ctx => {
      const dodgeId = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', dodgeId);
    })
    .act('P2 没有第2张闪，放弃响应', ctx => {
      ctx.respond('P2');
    })
    .check('P2 受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .run();

  scenario('杀需2闪抵消：目标出2闪完全抵消')
    .setup(ctx => {
      ctx.selectCharacters('吕布', '刘备');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪', 2);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 出第1张闪', ctx => {
      const dodgeId = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', dodgeId);
    })
    .act('P2 出第2张闪', ctx => {
      const dodgeId = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', dodgeId);
    })
    .check('P2 未受伤（2闪完全抵消）', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .check('P2 用掉2张闪', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P2']).toBe(-2);
    })
    .run();

  scenario('决斗需2杀：吕布使用决斗，目标需出2杀')
    .setup(ctx => {
      ctx.selectCharacters('吕布', '曹操');
      ctx.giveCard('P1', '决斗');
      ctx.giveCard('P2', '杀', 2);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.ensureNoKill('P1');
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用决斗', ctx => {
      const cardId = ctx.findCard('P1', '决斗')!;
      ctx.playCard('P1', cardId, 'P2');
    })
    .act('P2 不出无懈可击', ctx => {
      ctx.respond('P2');
    })
    .act('P2 出第1张杀（无双需2杀，还需1张）', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.respond('P2', killId);
    })
    .act('P2 出第2张杀', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.respond('P2', killId);
    })
    .act('P1 没有杀，受决斗伤害', ctx => {
      ctx.respond('P1');
    })
    .check('P1 受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P1']).toBe(-1);
    })
    .run();

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

  scenario('无双：目标0张闪直接受伤')
    .setup(ctx => {
      ctx.selectCharacters('吕布', '刘备');
      ctx.giveCard('P1', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 无闪可出，放弃响应', ctx => {
      ctx.respond('P2');
    })
    .check('P2 受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .run();

  scenario('决斗：对方出1杀不够，吕布赢决斗')
    .setup(ctx => {
      ctx.selectCharacters('吕布', '曹操');
      ctx.giveCard('P1', '决斗');
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.ensureNoKill('P1');
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用决斗', ctx => {
      const cardId = ctx.findCard('P1', '决斗')!;
      ctx.playCard('P1', cardId, 'P2');
    })
    .act('P2 不出无懈可击', ctx => {
      ctx.respond('P2');
    })
    .act('P2 出第1张杀（无双需2杀，还需1张）', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.respond('P2', killId);
    })
    .act('P2 没有第2张杀，受决斗伤害', ctx => {
      ctx.respond('P2');
    })
    .check('P2 受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .run();

  scenario('非吕布杀不需要多闪')
    .setup(ctx => {
      ctx.selectCharacters('刘备', '曹操');
      ctx.giveCard('P1', '杀');
      ctx.giveCard('P2', '闪', 2);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.snapshot('initial');
    })
    .act('P1 对 P2 使用杀', ctx => {
      const killId = ctx.findCard('P1', '杀')!;
      ctx.playCard('P1', killId, 'P2');
    })
    .act('P2 出1张闪即完全抵消', ctx => {
      const dodgeId = ctx.findCard('P2', '闪')!;
      ctx.respond('P2', dodgeId);
    })
    .check('P2 未受伤', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(0);
    })
    .check('P2 只用掉1张闪', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P2']).toBe(-1);
    })
    .run();
});
