import type { GameState } from '@engine/types';
import { describe, it, expect, beforeEach } from 'vitest';
import { scenario } from '../../scenario-runner';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth, withArmor } from '../../engine-helpers';
import { registerAll as registerFixtureHooks } from '../../fixtures/八卦阵';

describe('八卦阵 - judgeDodge', () => {
  scenario('装备八卦阵后受到杀，触发判定并可能免伤')
    .setup(ctx => {
      ctx.selectCharacters('曹操', '刘备');
      ctx.giveCard('P1', '八卦阵');
      ctx.setCurrentPlayer('P1');
      ctx.enterPlayPhase();
      const armorId = ctx.findCard('P1', '八卦阵')!;
      ctx.playCard('P1', armorId);
      ctx.giveCard('P2', '杀');
      ctx.setCurrentPlayer('P2');
      ctx.snapshot('equipped');
    })
    .act('P2 对 P1 使用杀', ctx => {
      const killId = ctx.findCard('P2', '杀')!;
      ctx.playCard('P2', killId, 'P1');
    })
    .act('P1 pass', ctx => {
      ctx.respond('P1');
    })
    .check('P1 判定后血量可能变化', ctx => {
      const diff = ctx.diff('equipped');
      const p1HealthChange = diff.healthChanges['P1'] ?? 0;
      expect(p1HealthChange).toBeLessThanOrEqual(0);
    })
    .check('判定红色时设置 dodged 变量且无伤害', ctx => {
      const p1 = ctx.player('P1');
      const judgeResult = p1.vars['八卦阵/dodged'];
      if (judgeResult === true) {
        const diff = ctx.diff('equipped');
        expect(diff.healthChanges['P1']).toBe(0);
      }
    })
    .run();
});

describe('八卦阵 v3', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerFixtureHooks();
  });

  it('装备八卦阵的角色受【杀】伤害时，v3 钩子兜底 cancel', () => {
    // §4.2 修：v3 hook 兜底 damage atom onBefore cancel
    // 完整判定走 useCard 钩子留 P2
    // 现阶段：v3 钩子一旦检测到 cardId.name === '杀' + 目标.armor === 'bagua'
    // → damage atom cancel
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '八卦阵'), 'P1', 4);
    // 注入 kill1 卡片到 cardMap 以便 v3 钩子能查到 name === '杀'
    const s1: GameState = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        kill1: {
          id: 'kill1',
          name: '杀',
          type: '基本牌',
          subtype: '杀',
          suit: '♠',
          rank: 'A',
          description: '',
        },
      },
    };
    const { state, logEntries: events } = applyAtoms(s1, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events).toHaveLength(0);
  });

  it('未装备八卦阵的角色受【杀】伤害，v3 钩子不生效', () => {
    const s0 = setHealth(createTestGame(), 'P1', 4);
    const s1: GameState = {
      ...s0,
      cardMap: {
        ...s0.cardMap,
        kill1: {
          id: 'kill1',
          name: '杀',
          type: '基本牌',
          subtype: '杀',
          suit: '♠',
          rank: 'A' as const,
          description: '',
        },
      },
    };
    const { state } = applyAtoms(s1, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(3);
  });
});
