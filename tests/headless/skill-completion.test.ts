import { beforeEach, describe, expect, it } from 'vitest';
import { createGameState } from '../../src/engine/types';
import type { Card, PlayerState, Faction } from '../../src/engine/types';
import { buildView, dispatch, registerSkillsFromState } from '../../src/engine';
import { clearRegistry, registerSkillActions } from '../../src/client/skillActionRegistry';
import { HeadlessGameClient } from '../../src/client/headless/HeadlessGameClient';
import { createObservation } from '../../src/arena/observation';
import { resolveDecision } from '../../src/arena/decision';
import { resolveDistributeCardIds, isActiveAction } from '../../src/client/utils/gameViewHelpers';
import '../../src/engine/atoms';

const dodge: Card = { id: 'dodge', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
function player(index: number, skills: string[], faction: Faction = '群'): PlayerState {
  return { index, name: `P${index}`, character: index === 0 ? '张角' : '于吉', faction,
    health: 3, maxHealth: 3, alive: true, hand: index === 1 ? [dodge.id] : [],
    equipment: {}, skills, vars: {}, marks: [], tags: [], pendingTricks: [], judgeZone: [] };
}

describe('补全普通技能的AI操作入口', () => {
  beforeEach(clearRegistry);
  for (const skill of ['黄天', '界黄天']) {
    it(`${skill}：群角色从真实注册表发现交牌动作并被引擎接受`, async () => {
      const state = createGameState({ players: [player(0, [skill]), player(1, []), player(2, [], '魏')],
        cardMap: { [dodge.id]: dodge }, currentPlayerIndex: 1,
        phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} } });
      await registerSkillsFromState(state);
      for (const p of state.players) await registerSkillActions(p.index, p.skills);
      const client = new HeadlessGameClient('http://unused');
      Object.assign(client, { _view: buildView(state, 1), _seatIndex: 1 });
      const action = client.getAvailableActions().find((a) => a.message.skillId === skill);
      expect(action).toBeDefined();
      const result = await dispatch(state, { ...action!.message, baseSeq: state.seq });
      expect(result.accepted).toBe(true);
      await result.settle;
      expect(state.players[0].hand).toContain(dodge.id);
      state.currentPlayerIndex = 2;
      Object.assign(client, { _view: buildView(state, 2), _seatIndex: 2 });
      expect(client.getAvailableActions().some((a) => a.message.skillId === skill)).toBe(false);
    });
  }
  it('反间：目标可明确选择四种花色', async () => {
    const state = createGameState({ players: [player(0, ['反间']), player(1, [])], cardMap: { dodge } });
    await registerSkillsFromState(state);
    await registerSkillActions(0, ['反间']);
    const view = buildView(state, 1);
    view.pending = { target: 1, isBlocking: true, deadline: 0,
      atom: { type: '请求回应', requestType: '反间/选花色', target: 1 },
      prompt: { type: 'chooseSuit', title: '反间：请选择花色' },
    } as NonNullable<typeof view.pending>;
    const client = new HeadlessGameClient('http://unused');
    Object.assign(client, { _view: view, _seatIndex: 1 });
    expect(client.getAvailableActions().filter((a) => a.message.skillId === '反间')
      .map((a) => a.message.params.suit).sort()).toEqual(['♠', '♥', '♣', '♦'].sort());
  });
  it('落英式0..N选择允许AI明确选择零张', () => {
    const state = createGameState({ players: [player(0, []), player(1, [])], cardMap: { dodge } });
    const view = buildView(state, 0);
    view.pending = { target: 0, isBlocking: true, deadline: 0,
      atom: { type: '请求回应', requestType: '界落英/choose', target: 0 },
      prompt: { type: 'distribute', mode: 'select', title: '选择任意张', cardIds: ['dodge'], minTotal: 0, maxTotal: 1 },
    } as NonNullable<typeof view.pending>;
    const client = new HeadlessGameClient('http://unused');
    Object.assign(client, { _view: view, _seatIndex: 0 });
    const observation = createObservation(view, state.seq, client.getAvailableActions());
    const action = observation.actions.find((candidate) => candidate.category === 'distribute')!;
    expect(action.selection?.minTotal).toBe(0);
    expect(resolveDecision(observation, { actionId: action.actionId, params: { cardIds: [] } }).params.cardIds).toEqual([]);
  });
  it('怀柔式分配候选仅包含手牌和装备区的装备牌', () => {
    const weapon: Card = { ...dodge, id: 'weapon', name: '诸葛连弩', type: '装备牌', subtype: '武器' };
    const armor: Card = { ...weapon, id: 'armor', name: '仁王盾', subtype: '防具' };
    const prompt = { type: 'distribute' as const, title: '怀柔', source: 'handAndEquip' as const,
      filter: (card: Card) => card.type === '装备牌' };
    expect(resolveDistributeCardIds(prompt, [dodge, weapon], { 防具: armor.id }, { dodge, weapon, armor }))
      .toEqual(['weapon', 'armor']);
  });
  it('一体力缠怨时AI不推荐武将技能，仍可正常使用基本牌', () => {
    const state = createGameState({ players: [player(0, ['仁德', '缠怨'])], cardMap: {}, phase: '出牌' });
    state.players[0].health = 1;
    const ctx = { view: buildView(state, 0), perspectiveIdx: 0 };
    const action = { ownerId: 0, actionType: 'use', label: '技能', prompt: { type: 'confirm' as const, title: '技能' } };
    expect(isActiveAction({ ...action, skillId: '仁德' }, ctx)).toBe(false);
    expect(isActiveAction({ ...action, skillId: '杀' }, ctx)).toBe(true);
  });
  it('火攻和顺手牵羊不把无牌角色列为可选目标', async () => {
    const fire: Card = { ...dodge, id: 'fire', name: '火攻', type: '锦囊牌' };
    const snatch: Card = { ...fire, id: 'snatch', name: '顺手牵羊' };
    const players = [player(0, ['使用牌']), player(1, []), player(2, [])];
    players[0].hand = ['fire', 'snatch']; players[1].hand = []; players[2].hand = ['dodge'];
    const state = createGameState({ players, cardMap: { dodge, fire, snatch }, phase: '出牌' });
    await registerSkillsFromState(state);
    await registerSkillActions(0, ['使用牌']);
    const client = new HeadlessGameClient('http://unused');
    Object.assign(client, { _view: buildView(state, 0), _seatIndex: 0 });
    for (const skillId of ['火攻', '顺手牵羊']) {
      const action = client.getAvailableActions().find((candidate) => candidate.message.skillId === skillId)!;
      expect(action.validTargets).toContain(2);
      expect(action.validTargets).not.toContain(1);
    }
  });
});
