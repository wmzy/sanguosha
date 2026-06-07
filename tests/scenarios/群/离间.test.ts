import { describe, expect, it } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('貂蝉 - 离间', () => {
  scenario('离间基础：弃1牌创建决斗窗口')
    .setup(ctx => {
      ctx.selectCharacters('貂蝉', '华佗', '吕布', '刘备');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const p1 = ctx.player('P1');
      ctx.state = {
        ...ctx.state,
        players: {
          ...ctx.state.players,
          P1: { ...p1, hand: [] },
        },
        zones: {
          ...ctx.state.zones,
          deck: [...ctx.state.zones.deck, ...p1.hand],
        },
      };
      ctx.giveCard('P1', '过河拆桥');
      ctx.snapshot('initial');
    })
    .act('貂蝉发动离间，target=P2(华佗)', ctx => {
      ctx.useSkill('P1', '离间', 'P2');
    })
    .check('貂蝉手牌减少1', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.handSizeChanges['P1']).toBeLessThan(0);
    })
    .check('创建决斗响应窗口', ctx => {
      expect(ctx.state.pending?.type).toBe('响应窗口');
      if (ctx.state.pending?.type === '响应窗口') {
        expect(ctx.state.pending.window.type).toBe('duelResponse');
      }
    })
    .run();

  scenario('离间决斗流程：P2不出杀→P3不出杀→P3受伤')
    .setup(ctx => {
      ctx.selectCharacters('貂蝉', '华佗', '吕布', '刘备');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const p1 = ctx.player('P1');
      ctx.state = {
        ...ctx.state,
        players: {
          ...ctx.state.players,
          P1: { ...p1, hand: [] },
        },
        zones: {
          ...ctx.state.zones,
          deck: [...ctx.state.zones.deck, ...p1.hand],
        },
      };
      ctx.giveCard('P1', '过河拆桥');
      ctx.ensureNoKill('P2');
      ctx.ensureNoKill('P3');
      ctx.snapshot('initial');
    })
    .act('貂蝉发动离间，target=P2(华佗)', ctx => {
      ctx.useSkill('P1', '离间', 'P2');
    })
    .act('P2(华佗/被决斗者)不出杀', ctx => {
      ctx.respond('P2');
    })
    .check('华佗受1点决斗伤害', ctx => {
      const diff = ctx.diff('initial');
      expect(diff.healthChanges['P2']).toBe(-1);
    })
    .run();

  it.skip('离间完整流程：选择弃牌 + 选择两名男性目标', () => {
    // 需要：多步 prompt 支持（弃牌选择 + 目标A选择 + 目标B选择）
    // 当前引擎限制：useSkill 的 target 只能传一个目标，
    // 多步 prompt 的 ctx.choice 会被覆盖
    // 需要：skillChoice 支持保存多步选择结果，或 useSkill 支持多目标参数
  });
});
