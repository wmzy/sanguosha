import { describe, expect } from 'vitest';
import { scenario, ScenarioContext } from '../scenario-runner';

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

describe('AOE + 奸雄', () => {
  scenario('万箭齐发：曹操受伤后奸雄获得万箭齐发')
    .setup(ctx => {
      ctx.selectCharacters('甄姬', '曹操');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      ctx.giveCard('P1', '万箭齐发');
      ctx.snapshot('initial');
    })
    .act('P1 出万箭齐发', ctx => {
      const aoeId = ctx.findCard('P1', '万箭齐发')!;
      ctx.playCard('P1', aoeId);
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
    .act('P2 不出闪受伤害', ctx => {
      expect(ctx.state.pending?.type).toBe('responseWindow');
      if (ctx.state.pending?.type === 'responseWindow') {
        expect(ctx.state.pending.window.type).toBe('aoeResponse');
        const defender = ctx.state.pending.window.defender;
        expect(defender).toBe('P2');
        ctx.respond(defender);
      }
    })
    .check('曹操应受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .check('奸雄触发：曹操获得万箭齐发', ctx => {
      const p2 = ctx.player('P2');
      const hasAoe = p2.hand.some(id => ctx.state.cardMap[id]?.name === '万箭齐发');
      expect(hasAoe).toBe(true);
    })
    .run();

  scenario('南蛮入侵：曹操受伤后奸雄获得南蛮入侵')
    .setup(ctx => {
      ctx.selectCharacters('甄姬', '曹操');
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
    .check('曹操应受到 1 点伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .check('奸雄触发：曹操获得南蛮入侵', ctx => {
      const p2 = ctx.player('P2');
      const hasCard = p2.hand.some(id => ctx.state.cardMap[id]?.name === '南蛮入侵');
      expect(hasCard).toBe(true);
    })
    .run();
});
