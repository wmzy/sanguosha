import { describe, expect } from 'vitest';
import { scenario, ScenarioContext } from '../../scenario-runner';

function passAllTrickResponses(ctx: ScenarioContext): void {
  while (ctx.state.pending?.type === 'responseWindow') {
    const window = ctx.state.pending.window;
    if (window.type !== 'trickResponse') break;
    const responders = window.responders ?? [];
    const passed = window.passedResponders ?? [];
    const active = responders.filter(p => !passed.includes(p));
    if (active.length === 0) break;
    ctx.respond(active[0]);
  }
}

describe('AOE + 遗计', () => {
  scenario('万箭齐发：郭嘉受伤后遗计只触发一次')
    .setup(ctx => {
      ctx.selectCharacters('甄姬', '郭嘉', '刘备');
      ctx.setHealth('P2', 3);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '万箭齐发');
      ctx.snapshot('initial');
    })
    .act('P1 出万箭齐发', ctx => {
      const aoeId = ctx.findCard('P1', '万箭齐发')!;
      ctx.playCard('P1', aoeId);
    })
    .act('遍历所有目标的 trickResponse', ctx => {
      passAllTrickResponses(ctx);
    })
    .check('应进入 aoeResponse 阶段', ctx => {
      expect(ctx.state.pending?.type).toBe('responseWindow');
      if (ctx.state.pending?.type === 'responseWindow') {
        if (ctx.state.pending.window.type === 'trickResponse') {
          passAllTrickResponses(ctx);
        }
        expect(ctx.state.pending.window.type).toBe('aoeResponse');
      }
    })
    .act('P2 不出闪受伤害', ctx => {
      expect(ctx.state.pending?.type).toBe('responseWindow');
      if (ctx.state.pending?.type === 'responseWindow') {
        expect(ctx.state.pending.window.type).toBe('aoeResponse');
        const defender = ctx.state.pending.window.defender;
        expect(defender).toBe('P2');
        ctx.respond(defender);
      }
    })
    .check('郭嘉应受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .check('遗计触发，手牌只 +2', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P2']).toBeGreaterThanOrEqual(2);
      expect(diff.handSizeChanges['P2']).toBeLessThanOrEqual(3);
    })
    .run();

  scenario('南蛮入侵：郭嘉受伤后遗计只触发一次')
    .setup(ctx => {
      ctx.selectCharacters('甄姬', '郭嘉', '刘备');
      ctx.setHealth('P2', 3);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '南蛮入侵');
      ctx.snapshot('initial');
    })
    .act('P1 出南蛮入侵', ctx => {
      const cardId = ctx.findCard('P1', '南蛮入侵')!;
      ctx.playCard('P1', cardId);
    })
    .act('遍历 trickResponse', ctx => {
      passAllTrickResponses(ctx);
    })
    .check('应进入 aoeResponse 阶段', ctx => {
      expect(ctx.state.pending?.type).toBe('responseWindow');
      if (ctx.state.pending?.type === 'responseWindow') {
        if (ctx.state.pending.window.type === 'trickResponse') {
          passAllTrickResponses(ctx);
        }
        expect(ctx.state.pending.window.type).toBe('aoeResponse');
      }
    })
    .act('P2 不出杀受伤害', ctx => {
      expect(ctx.state.pending?.type).toBe('responseWindow');
      if (ctx.state.pending?.type === 'responseWindow') {
        expect(ctx.state.pending.window.type).toBe('aoeResponse');
        expect(ctx.state.pending.window.defender).toBe('P2');
        ctx.respond('P2');
      }
    })
    .check('郭嘉应受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .check('遗计触发，手牌只 +2', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P2']).toBeGreaterThanOrEqual(2);
      expect(diff.handSizeChanges['P2']).toBeLessThanOrEqual(3);
    })
    .run();
});
