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

function passAoeResponse(ctx: ScenarioContext, expectedDefender: string): void {
  expect(ctx.state.pending?.type).toBe('responseWindow');
  if (ctx.state.pending?.type === 'responseWindow') {
    expect(ctx.state.pending.window.type).toBe('aoeResponse');
    expect(ctx.state.pending.window.defender).toBe(expectedDefender);
    ctx.respond(expectedDefender);
  }
}

describe('AOE 多技能并发', () => {
  scenario('万箭齐发：郭嘉遗计 + 曹操奸雄同时触发')
    .setup(ctx => {
      ctx.selectCharacters('甄姬', '郭嘉', '曹操');
      ctx.setHealth('P2', 3);
      ctx.setHealth('P3', 3);
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '万箭齐发');
      ctx.snapshot('initial');
    })
    .act('P1 出万箭齐发', ctx => {
      const aoeId = ctx.findCard('P1', '万箭齐发')!;
      ctx.playCard('P1', aoeId);
    })
    .act('遍历所有 trickResponse', ctx => {
      passAllTrickResponses(ctx);
    })
    .act('P2（郭嘉）不出闪受伤害', ctx => {
      passAoeResponse(ctx, 'P2');
    })
    .check('郭嘉应受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .act('遗计分配提示：选择不分配', ctx => {
      if (ctx.state.pending?.type === 'skillPrompt') {
        ctx.engineAction({ type: 'skillChoice', player: 'P2', choice: false });
      }
    })
    .act('遗计分配提示：选择不分配', ctx => {
      if (ctx.state.pending?.type === 'skillPrompt') {
        ctx.engineAction({ type: 'skillChoice', player: 'P2', choice: false });
      }
    })
    .check('遗计触发：郭嘉手牌 +2', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P2']).toBeGreaterThanOrEqual(2);
      expect(diff.handSizeChanges['P2']).toBeLessThanOrEqual(3);
    })
    .run();
});
