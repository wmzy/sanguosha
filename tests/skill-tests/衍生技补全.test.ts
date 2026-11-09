import { beforeEach, describe, expect, it } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import { indulgenceEffect } from '../../src/engine/skills/cards/乐不思蜀';
import type { Card, GameState } from '../../src/engine/types';

const rongKey = '征荣/实体荣';
const rongPrefix = '征荣/荣:';

function card(id: string, name: string, suit: Card['suit'] = '♠', type: Card['type'] = '基本牌'): Card {
  return { id, name, suit, color: suit === '♥' || suit === '♦' ? '红' : '黑', rank: '7', type };
}

function player(index: number, name: string, options: Partial<GameState['players'][number]> = {}) {
  return {
    index, name, character: name, health: 4, maxHealth: 4, alive: true,
    hand: [], equipment: {}, pendingTricks: [], skills: [], vars: {}, marks: [], tags: [],
    ...options,
  };
}

describe('清侧', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  it('移去一张真实荣并弃置目标装备牌', async () => {
    const rong = card('rong1', '杀');
    const equip = card('equip1', '诸葛连弩', '♣', '装备牌');
    await harness.setup(createGameState({
      players: [
        player(0, '毌丘俭', {
          skills: ['清侧'], vars: { [rongKey]: ['rong1', 'rong2'] },
          marks: [
            { id: `${rongPrefix}1`, scope: 0, payload: { cardId: 'rong1' } },
            { id: `${rongPrefix}2`, scope: 0, payload: { cardId: 'rong2' } },
          ],
        }),
        player(1, '目标', { hand: ['targetHand'], equipment: { 武器: 'equip1' } }),
      ],
      cardMap: { rong1: rong, rong2: card('rong2', '闪', '♥'), equip1: equip, targetHand: card('targetHand', '桃', '♥') },
      currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    }));
    const p0 = harness.player('毌丘俭');

    await p0.triggerAction('清侧', 'use', {});
    p0.expectPending('请求回应');
    await p0.respond('清侧', { target: 1 });
    await harness.waitForStable();
    p0.expectPending('请求回应');
    await p0.respond('清侧', { cardIds: ['rong2'] });
    await harness.waitForStable();
    p0.expectPending('请求回应');
    expect((harness.state.pendingSlots.get(0)?.atom as { prompt?: { handCount?: number } }).prompt?.handCount).toBe(0);
    await p0.respond('清侧', { zone: 'equipment', cardId: 'equip1' });
    await harness.waitForStable();

    expect(harness.state.players[0].marks).toHaveLength(1);
    expect(harness.state.players[0].marks[0].payload).toEqual({ cardId: 'rong1' });
    expect(harness.state.players[0].vars[rongKey]).toEqual(['rong1']);
    expect(harness.state.players[1].equipment['武器']).toBeUndefined();
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['rong2', 'equip1']));
    expect(harness.state.zones.discardPile).not.toContain('rong1');
  });

  it('场上仅有手牌时不把该角色列为清侧目标', async () => {
    await harness.setup(createGameState({
      players: [
        player(0, '毌丘俭', {
          skills: ['清侧'], vars: { [rongKey]: ['rong1'] },
          marks: [{ id: `${rongPrefix}1`, scope: 0, payload: { cardId: 'rong1' } }],
        }),
        player(1, '仅有手牌', { hand: ['targetHand'] }),
      ],
      cardMap: { rong1: card('rong1', '杀'), targetHand: card('targetHand', '桃', '♥') },
      currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    }));

    const action = harness.player('毌丘俭').availableActions().find((item) => item.skillId === '清侧' && item.actionType === 'use');
    expect(action?.activeWhen?.({ view: harness.player('毌丘俭').view, perspectiveIdx: 0 })).toBe(false);
  });
});

describe('怀柔', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  it('重铸手牌区的装备牌并摸一张', async () => {
    await harness.setup(createGameState({
      players: [player(0, '陆抗', { skills: ['怀柔'], hand: ['equip1'], equipment: { 防具: 'equipped1' } })],
      cardMap: {
        equip1: card('equip1', '诸葛连弩', '♣', '装备牌'),
        equipped1: card('equipped1', '八卦阵', '♣', '装备牌'),
        draw1: card('draw1', '闪', '♥'),
      },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    }));
    const p0 = harness.player('陆抗');

    await p0.triggerAction('怀柔', 'use', { cardIds: ['equip1'] });
    await harness.waitForStable();

    expect(harness.state.players[0].equipment['防具']).toBe('equipped1');
    expect(harness.state.players[0].hand).toContain('draw1');
    expect(harness.state.zones.discardPile).toContain('equip1');
  });

  it('也可重铸装备区的装备牌', async () => {
    await harness.setup(createGameState({
      players: [player(0, '陆抗', { skills: ['怀柔'], equipment: { 防具: 'equipped1' } })],
      cardMap: {
        equipped1: card('equipped1', '八卦阵', '♣', '装备牌'),
        draw1: card('draw1', '闪', '♥'),
      },
      zones: { deck: ['draw1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    }));

    await harness.player('陆抗').triggerAction('怀柔', 'use', { cardIds: ['equipped1'] });
    await harness.waitForStable();

    expect(harness.state.players[0].equipment['防具']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('draw1');
    expect(harness.state.zones.discardPile).toContain('equipped1');
  });
});

describe('思蜀', () => {
  let harness: SkillTestHarness;
  beforeEach(() => { harness = new SkillTestHarness(); });

  it('出牌阶段开始可选择目标并永久赋予其乐不思蜀判定反转', async () => {
    await harness.setup(createGameState({
      players: [player(0, '界刘禅', { skills: ['思蜀'] }), player(1, '目标')],
      cardMap: {}, currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    }));
    const p0 = harness.player('界刘禅');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    p0.expectPending('请求回应'); // 发动确认
    await p0.respond('思蜀', { choice: true });
    await harness.waitForStable();
    p0.expectPending('请求回应'); // 选择本局反转目标
    await p0.respond('思蜀', { target: 1 });
    await harness.waitForStable();

    expect(harness.state.players[1].tags).toContain('思蜀/反转');
    await p0.expectRejected({ skillId: '思蜀', actionType: 'use', params: { target: 0 } });
  });

  it('出牌阶段开始可以放弃，不产生反转标记', async () => {
    await harness.setup(createGameState({
      players: [player(0, '界刘禅', { skills: ['思蜀'] }), player(1, '目标')],
      cardMap: {}, currentPlayerIndex: 0, phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} },
    }));
    const p0 = harness.player('界刘禅');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await harness.waitForStable();
    p0.expectPending('请求回应');
    await p0.respond('思蜀', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[1].tags).not.toContain('思蜀/反转');
    p0.expectNoPending();
  });

  it('被思蜀标记的角色以红桃判定牌令乐不思蜀跳过出牌阶段', async () => {
    const pending = card('delayed1', '乐不思蜀', '♠', '锦囊牌');
    const judge = card('judge1', '闪', '♥');
    const state = createGameState({
      players: [
        player(0, '使用者'),
        player(1, '目标', {
          tags: ['思蜀/反转'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card: pending }],
        }),
      ],
      cardMap: { delayed1: pending, judge1: judge },
      zones: { deck: ['judge1'], discardPile: ['delayed1'], processing: [] },
      currentPlayerIndex: 1, phase: '判定', turn: { round: 1, phase: '判定', vars: {} },
    });

    await indulgenceEffect.resolve({ state, source: 0, target: 1, cardId: 'delayed1', targetIndex: 0 });

    expect(state.players[1].tags).toContain('乐不思蜀/跳过出牌');
  });

  it('被思蜀标记的角色以非红桃判定牌不跳过出牌阶段', async () => {
    const pending = card('delayed2', '乐不思蜀', '♠', '锦囊牌');
    const judge = card('judge2', '闪', '♣');
    const state = createGameState({
      players: [player(0, '使用者'), player(1, '目标', {
        tags: ['思蜀/反转'], pendingTricks: [{ name: '乐不思蜀', source: 0, card: pending }],
      })],
      cardMap: { delayed2: pending, judge2: judge },
      zones: { deck: ['judge2'], discardPile: ['delayed2'], processing: [] },
      currentPlayerIndex: 1, phase: '判定', turn: { round: 1, phase: '判定', vars: {} },
    });

    await indulgenceEffect.resolve({ state, source: 0, target: 1, cardId: 'delayed2', targetIndex: 0 });

    expect(state.players[1].tags).not.toContain('乐不思蜀/跳过出牌');
  });
});
