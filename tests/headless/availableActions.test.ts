// tests/headless/availableActions.test.ts
import { describe, it, expect } from 'vitest';
import { enumerateAvailableActions } from '../../src/client/headless/availableActions';
import type { GameView, Card } from '../../src/engine/types';
import type { SkillActionDef } from '../../src/client/skillActionRegistry';

function makeView(seat: number, phase: GameView['phase'], hand: Card[], currentPlayer = seat): GameView {
  return {
    viewer: seat, currentPlayerIndex: currentPlayer, phase,
    turn: { round: 1, phase, vars: {} },
    players: [{
      index: seat, name: 'P0', character: '刘备', health: 4, maxHealth: 4,
      alive: true, equipment: {}, skills: ['杀'], handCount: hand.length, hand, marks: [],
    }, {
      index: 1, name: 'P1', character: '曹操', health: 4, maxHealth: 4,
      alive: true, equipment: {}, skills: [], handCount: 4, marks: [],
    }],
    cardMap: Object.fromEntries(hand.map(c => [c.id, c])),
    pending: null, deadline: null, deadlineTotalMs: 0, log: [], settlementStack: [],
  };
}

const killCard: Card = { id: 'c1', name: '杀', suit: '♠', color: '黑', rank: '5', type: '基本牌' };

// 杀的 use action：useCardAndTarget，cardFilter 匹配 name==='杀'，targetFilter 选一个其他玩家
const killUseAction: SkillActionDef = {
  skillId: '杀', ownerId: 0, actionType: 'use', label: '杀',
  prompt: {
    type: 'useCardAndTarget',
    title: '杀',
    cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
    targetFilter: { min: 1, max: 1 },
  },
};

describe('enumerateAvailableActions', () => {
  it('出牌阶段枚举手牌中可出的牌，并算出合法目标', () => {
    const view = makeView(0, '出牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    const a = actions.find(x => x.category === 'play');
    expect(a).toBeDefined();
    expect(a!.message.actionType).toBe('use');
    expect(a!.message.params).toHaveProperty('cardId', 'c1');
    expect(a!.validTargets).toContain(1);
  });

  it('非出牌阶段不枚举主动出牌', () => {
    const view = makeView(0, '摸牌', [killCard]);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions.find(x => x.category === 'play')).toBeUndefined();
  });

  it('空手牌不产出牌操作', () => {
    const view = makeView(0, '出牌', []);
    const actions = enumerateAvailableActions(view, 0, [killUseAction]);
    expect(actions).toHaveLength(0);
  });
});
