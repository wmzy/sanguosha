import { describe, expect, it } from 'vitest';
import { createGameState } from '../../src/engine/types';
import type { Card, PlayerState } from '../../src/engine/types';
import { buildView, registerSkillsFromState } from '../../src/engine';
import { validateCardUse } from '../../src/engine/skills/cards/validate';
import { validateTargetSelection, targetSelectionBounds, targetCandidates } from '../../src/engine/rules/target-selection';
import { getCardEffect } from '../../src/engine/skills/cards';
import { commitTurnUsage } from '../../src/engine/rules/turn-usage';
import '../../src/engine/atoms';

async function setup(used = 0) {
  const cards: Record<string, Card> = {
    slash: { id: 'slash', name: '杀', type: '基本牌', suit: '♠', color: '黑', rank: '7' },
    duel: { id: 'duel', name: '决斗', type: '锦囊牌', trickSubtype: '普通锦囊', suit: '♠', color: '黑', rank: 'A' },
  };
  const players: PlayerState[] = Array.from({ length: 4 }, (_, index) => ({ index,
    name: `P${index}`, character: index === 0 ? '界高顺' : '曹操', faction: '群',
    health: 4, maxHealth: 4, alive: true, hand: index === 0 ? ['slash', 'duel'] : [],
    skills: index === 0 ? ['界陷阵'] : [], equipment: {}, marks: [], tags: [], vars: {}, judgeZone: [], pendingTricks: [],
  }));
  const state = createGameState({ players, cardMap: cards, phase: '出牌', currentPlayerIndex: 0,
    turn: { round: 1, phase: '出牌', vars: { '陷阵/winTarget': 2, '杀/quotaUsed': used } } });
  await registerSkillsFromState(state);
  commitTurnUsage(state, 0, { key: '陷阵/winTarget', value: 2 });
  state.players[0].vars = {};
  return state;
}
describe('界陷阵：次数与额外目标仅针对拼点角色', () => {
  it('普通杀次数耗尽仍可杀赢的目标，但不能杀无关目标或夹带无关目标', async () => {
    const state = await setup(1);
    expect(validateCardUse(state, 0, { cardId: 'slash', targets: [2] }, '杀')).toBeNull();
    expect(validateCardUse(state, 0, { cardId: 'slash', targets: [1] }, '杀')).not.toBeNull();
    expect(validateCardUse(state, 0, { cardId: 'slash', targets: [1, 2] }, '杀')).not.toBeNull();
  });
  it('剩余一次杀可带一个普通目标和额外拼点目标，但不能选两个无关目标', async () => {
    const state = await setup();
    expect(validateCardUse(state, 0, { cardId: 'slash', targets: [1, 2] }, '杀')).toBeNull();
    expect(validateCardUse(state, 0, { cardId: 'slash', targets: [1, 3] }, '杀')).not.toBeNull();
  });
  it('决斗可额外指定拼点目标，前后端目标选择一致', async () => {
    const state = await setup();
    expect(validateCardUse(state, 0, { cardId: 'duel', targets: [1, 2] }, '决斗')).toBeNull();
    expect(validateCardUse(state, 0, { cardId: 'duel', targets: [1, 3] }, '决斗')).not.toBeNull();
    const view = buildView(state, 0);
    const filter = getCardEffect('决斗')!.prompt;
    if (filter.type !== 'useCardAndTarget') throw new Error('决斗应允许选牌和目标');
    expect(targetSelectionBounds(view, 0, filter.targetFilter, state.cardMap.duel).max).toBe(2);
    expect(validateTargetSelection(view, 0, filter.targetFilter, [1, 2], state.cardMap.duel)).toBe(true);
    expect(validateTargetSelection(view, 0, filter.targetFilter, [1, 3], state.cardMap.duel)).toBe(false);
  });
});

describe('落英牌的距离提示', () => {
  it('背面朝上时只放宽当前选中的落英牌，不放宽其他牌', async () => {
    const state = await setup();
    state.players[0].skills = ['界酒诗'];
    commitTurnUsage(state, 0, { key: '陷阵/winTarget', value: null });
    state.players[0].tags = ['酒诗/翻面'];
    commitTurnUsage(state, 0, { key: '酒诗/落英牌/slash', value: true });
    const view = buildView(state, 0);
    const prompt = getCardEffect('杀')!.prompt;
    if (prompt.type !== 'useCardAndTarget') throw new Error('杀应允许选择目标');
    expect(targetCandidates(view, 0, prompt.targetFilter, [], state.cardMap.slash)).toContain(2);
    expect(targetCandidates(view, 0, prompt.targetFilter, [], { ...state.cardMap.slash, id: 'normal' })).not.toContain(2);
  });
});
